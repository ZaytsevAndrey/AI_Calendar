import axios from 'axios';

const instance = axios.create({ baseURL: process.env.REACT_APP_API_BASE_URL || 'http://localhost:3001' });

instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Add response interceptor to handle API errors
instance.interceptors.response.use(
    (response) => response,
    (error) => {
        // If the error contains a structured error from NestJS but with a 500 status
        if (error.response?.status === 500 && error.response?.data?.message === 'Internal server error') {
            // Extract real error details from the error stack if possible
            const errorString = error.toString();
            console.log('Original error string:', errorString);
            
            // Look for common API error patterns in the stack trace
            const apiErrorMatch = errorString.match(/ApiError: ([A-Z_]+)/);
            
            // Extract fields directly with specific regexes for username field
            const usernameFieldMatch = errorString.match(/username: ['"]([^'"]+)['"]/);
            
            const reconstructedError = {
                ...error.response.data,
                original_message: error.response.data.message
            };
            
            // Extract error code
            if (apiErrorMatch && apiErrorMatch[1]) {
                reconstructedError.code = apiErrorMatch[1];
            }
            
            // Extract username field specifically
            if (usernameFieldMatch && usernameFieldMatch[1]) {
                reconstructedError.fields = {
                    ...reconstructedError.fields,
                    username: usernameFieldMatch[1]
                };
            }
            
            // Update the error response data
            error.response.data = reconstructedError;
            
            console.log('Reconstructed error response:', error.response.data);
        }
        
        return Promise.reject(error);
    }
);

export default instance;
