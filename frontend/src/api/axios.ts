import axios from 'axios';
import i18n from 'i18n';
import {
  bindSessionRefreshClient,
  retryAfterUnauthorized,
} from 'modules/auth/sessionRefresh';

const instance = axios.create({
  baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001',
});

bindSessionRefreshClient(instance as never);

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  config.headers = config.headers || {};
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers['Accept-Language'] = i18n.language;
  return config;
});

instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (
      error.response?.status === 500 &&
      error.response?.data?.message === 'Internal server error'
    ) {
      const errorString = error.toString();
      console.log('Original error string:', errorString);

      const apiErrorMatch = errorString.match(/ApiError: ([A-Z_]+)/);
      const usernameFieldMatch = errorString.match(/username: ['"]([^'"]+)['"]/);

      const reconstructedError = {
        ...error.response.data,
        original_message: error.response.data.message,
      };

      if (apiErrorMatch?.[1]) {
        reconstructedError.code = apiErrorMatch[1];
      }
      if (usernameFieldMatch?.[1]) {
        reconstructedError.fields = {
          ...reconstructedError.fields,
          username: usernameFieldMatch[1],
        };
      }

      error.response.data = reconstructedError;
      console.log('Reconstructed error response:', reconstructedError);
    }

    const retried = await retryAfterUnauthorized(error);
    if (retried) return retried;

    return Promise.reject(error);
  },
);

export default instance;
