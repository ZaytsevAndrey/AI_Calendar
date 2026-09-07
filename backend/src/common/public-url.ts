/** Normalize an origin/base URL from env (Render hostnames may omit the scheme). */
export function toAbsoluteUrl(value: string | undefined, fallback: string): string {
  const fallbackClean = fallback.replace(/\/$/, '');
  const raw = (value || '').trim().replace(/\/$/, '');
  if (!raw) {
    return fallbackClean;
  }
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

export function getFrontendBaseUrl(): string {
  return toAbsoluteUrl(process.env.FRONTEND_URL, 'http://localhost:3000');
}
