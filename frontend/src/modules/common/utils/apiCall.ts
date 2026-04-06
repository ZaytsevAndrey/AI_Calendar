import axios from 'api/axios';
import { store } from 'store';

import { refreshToken } from 'modules/auth/actions/refreshToken';
import { logout, clientLogout } from 'modules/auth/actions/logoutActions';

import hasApiErrorCode from './hasApiErrorCode';

import {
    INVALID_JWT,
    EMPTY_JWT,
    INVALID_SESSION,
    INVALID_REFRESH_TOKEN,
} from 'modules/common/constants/apiErrorCodes';

export default async function apiCall(config: any) {
    try {
        return await axios(config);
    } catch (error: any) {
        if (
            error?.response?.status === 401 ||
            error?.response?.data?.statusCode === 401
        ) {
            store.dispatch<any>(clientLogout(true));
            throw error;
        }
        if (!error?.response?.data) {
            throw error;
        }

        if (hasApiErrorCode(error, [INVALID_SESSION, INVALID_REFRESH_TOKEN])) {
            store.dispatch<any>(logout(true));
            throw error;
        }

        if (hasApiErrorCode(error, [INVALID_JWT, EMPTY_JWT])) {
            try {
                await store.dispatch<any>(refreshToken());
                return axios(config);
            } catch (e) {
                store.dispatch<any>(logout(true));
                throw e;
            }
        }

        throw error;
    }
}
