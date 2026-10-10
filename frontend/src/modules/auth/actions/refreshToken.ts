import { Dispatch } from 'redux';

import { ensureFreshSession } from '../sessionRefresh';

/** Manual refresh (tests / explicit callers). Interceptor uses ensureFreshSession directly. */
export const refreshToken = () => async (_dispatch: Dispatch) => {
  await ensureFreshSession();
};
