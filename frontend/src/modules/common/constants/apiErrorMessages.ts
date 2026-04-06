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
    [INVALID_JWT]: 'Недійсний токен',
    [EMPTY_JWT]: 'Відсутній токен',
    [INVALID_SESSION]: 'Сесія недійсна',
    [INVALID_REFRESH_TOKEN]: 'Токен оновлення недійсний',

    [INVALID_EMAIL]: 'Невірний формат email',
    [EMPTY_EMAIL]: 'Email не може бути порожнім',
    [UNKNOWN_EMAIL]: 'Користувач із цим email не знайдений',

    [PASSWORD_TOO_SHORT]: 'Пароль занадто короткий',
    [PASSWORDS_DO_NOT_MATCH]: 'Паролі не співпадають',
    [PASSWORD_WAS_PREVIOUSLY_USED]: 'Цей пароль вже використовувався раніше',

    [INVALID_VERIFICATION_CODE]: 'Код підтвердження недійсний',
    [VERIFICATION_CODE_EXPIRED]: 'Термін дії коду підтвердження вичерпано',

    [EMAIL_ALREADY_TAKEN]: 'Цей email вже зареєстрований',
};

export function getApiErrorMessage(code: string): string {
    return apiErrorMessages[code] || 'Сталася невідома помилка';
}

export default apiErrorMessages;
