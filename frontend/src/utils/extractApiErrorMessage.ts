/** RTK unwrap / axios-style errors from `customBaseQuery`. */
import i18n from 'i18n';

export function extractApiErrorMessage(err: unknown): string {
    const e = err as {
        data?: { message?: string | string[]; code?: string };
        response?: { data?: { message?: string | string[]; code?: string } };
        message?: string;
        code?: string;
    };
    const code = e?.data?.code ?? e?.response?.data?.code ?? e?.code;
    if (typeof code === 'string' && code.trim()) {
        const key = `errors.${code}`;
        const translated = i18n.t(key);
        if (translated !== key) return translated;
    }
    const raw = e?.data?.message ?? e?.response?.data?.message;
    if (Array.isArray(raw)) return raw.join('; ');
    if (typeof raw === 'string') return raw;
    if (typeof e?.message === 'string') return e.message;
    return i18n.t('errors.GENERIC');
}
