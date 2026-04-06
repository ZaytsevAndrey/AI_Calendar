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
    [WRONG_PASSWORD_ERROR]: 'Неправильний пароль. Будь ласка, спробуйте ще раз.',
    [USER_NOT_FOUND_ERROR]: 'Користувача не знайдено. Перевірте введені дані.',
    [INVALID_TOKEN_ERROR]: 'Невалідний токен. Будь ласка, увійдіть знову.',
    [USER_ALREADY_EXISTS_ERROR]: 'Користувач з таким email вже існує.',
    [INVALID_EMAIL_FORMAT_ERROR]: 'Невалідний формат email. Перевірте введені дані.',
    [INVALID_JWT]: 'Невалідний токен доступу. Будь ласка, увійдіть знову.',
    [EMPTY_JWT]: 'Токен доступу відсутній. Будь ласка, увійдіть знову.',
    [INVALID_SESSION]: 'Сесія недійсна. Будь ласка, увійдіть знову.',
    [INVALID_REFRESH_TOKEN]: 'Токен оновлення недійсний. Будь ласка, увійдіть знову.',
    [INVALID_CREDENTIALS]: 'Неправильний логін або пароль. Будь ласка, перевірте дані.',
}; 