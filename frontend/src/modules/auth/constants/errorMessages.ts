import {
    WRONG_PASSWORD_ERROR,
    USER_NOT_FOUND_ERROR,
    INVALID_TOKEN_ERROR,
    USER_ALREADY_EXISTS_ERROR,
    INVALID_EMAIL_FORMAT_ERROR,
    INVALID_JWT,
    EMPTY_JWT,
    INVALID_SESSION,
    INVALID_REFRESH_TOKEN,
    INVALID_CREDENTIALS,
} from './errorCodes';

export const errorMessages = {
    [WRONG_PASSWORD_ERROR]: 'Incorrect password. Please try again.',
    [USER_NOT_FOUND_ERROR]: 'User not found. Check your input.',
    [INVALID_TOKEN_ERROR]: 'Invalid token. Please log in again.',
    [USER_ALREADY_EXISTS_ERROR]: 'A user with this email already exists.',
    [INVALID_EMAIL_FORMAT_ERROR]: 'Invalid email format. Check your input.',
    [INVALID_JWT]: 'Invalid access token. Please log in again.',
    [EMPTY_JWT]: 'Access token is missing. Please log in again.',
    [INVALID_SESSION]: 'Session is invalid. Please log in again.',
    [INVALID_REFRESH_TOKEN]: 'Refresh token is invalid. Please log in again.',
    [INVALID_CREDENTIALS]: 'Incorrect email or password. Please check your credentials.',
}; 