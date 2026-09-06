import createAsyncAction from 'modules/common/utils/createAsyncAction';
import createAction from './index';

export const LOGIN = createAsyncAction(createAction('LOGIN'));
export const REFRESH_TOKEN_ASYNC = createAsyncAction(createAction('REFRESH_TOKEN'));
export const LOGOUT = createAction('LOGOUT'); 