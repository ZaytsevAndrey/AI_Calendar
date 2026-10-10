import axios from 'api/axios';

/** All callers share the axios 401 → refresh → retry interceptor. */
export default async function apiCall(config: any) {
  return axios(config);
}
