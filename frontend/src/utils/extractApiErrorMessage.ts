/** RTK unwrap / axios-style errors from `customBaseQuery`. */
export function extractApiErrorMessage(err: unknown): string {
    const e = err as {
        data?: { message?: string | string[] };
        response?: { data?: { message?: string | string[] } };
        message?: string;
    };
    const raw = e?.data?.message ?? e?.response?.data?.message;
    if (Array.isArray(raw)) return raw.join('; ');
    if (typeof raw === 'string') return raw;
    if (typeof e?.message === 'string') return e.message;
    return 'Something went wrong. Please try again.';
}
