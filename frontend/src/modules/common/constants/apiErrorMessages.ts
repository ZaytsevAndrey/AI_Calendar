import {
    INVALID_JWT,
    EMPTY_JWT,
    INVALID_SESSION,
    INVALID_REFRESH_TOKEN,
    INVALID_EMAIL,
    EMPTY_EMAIL,
    UNKNOWN_EMAIL,
    PASSWORD_TOO_SHORT,
    PASSWORDS_DO_NOT_MATCH,
    PASSWORD_WAS_PREVIOUSLY_USED,
    INVALID_VERIFICATION_CODE,
    VERIFICATION_CODE_EXPIRED,
    EMAIL_ALREADY_TAKEN,
} from './apiErrorCodes';

export const apiErrorMessages: Record<string, string> = {
    [INVALID_JWT]: 'Invalid token',
    [EMPTY_JWT]: 'Token is missing',
    [INVALID_SESSION]: 'Session is invalid',
    [INVALID_REFRESH_TOKEN]: 'Refresh token is invalid',

    [INVALID_EMAIL]: 'Invalid email format',
    [EMPTY_EMAIL]: 'Email cannot be empty',
    [UNKNOWN_EMAIL]: 'No user found with this email',

    [PASSWORD_TOO_SHORT]: 'Password is too short',
    [PASSWORDS_DO_NOT_MATCH]: 'Passwords do not match',
    [PASSWORD_WAS_PREVIOUSLY_USED]: 'This password was used before',

    [INVALID_VERIFICATION_CODE]: 'Verification code is invalid',
    [VERIFICATION_CODE_EXPIRED]: 'Verification code has expired',

    [EMAIL_ALREADY_TAKEN]: 'This email is already registered',
};

export function getApiErrorMessage(code: string): string {
    return apiErrorMessages[code] || 'An unknown error occurred';
}

export default apiErrorMessages;
