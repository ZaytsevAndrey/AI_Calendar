export type TextSegment = { type: 'text'; value: string } | { type: 'link'; url: string };

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? full;
  });
}

/** Plain note: tags become line breaks, entities become characters. */
export function stripHtml(value: string): string {
  const withBreaks = value
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeHtmlEntities(withBreaks).replace(/\n{3,}/g, '\n\n').trim();
}

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

export function linkify(value: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of value.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    const raw = match[0];
    const url = raw.replace(/[),.;:!?]+$/, '');
    if (start > last) segments.push({ type: 'text', value: value.slice(last, start) });
    segments.push({ type: 'link', url });
    const trailing = raw.slice(url.length);
    if (trailing) segments.push({ type: 'text', value: trailing });
    last = start + raw.length;
  }
  if (last < value.length) segments.push({ type: 'text', value: value.slice(last) });
  return segments.length ? segments : [{ type: 'text', value }];
}

const ALLOWED = new Set([
  'a',
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'blockquote',
  'div',
  'span',
]);

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Keep a small set of formatting tags. Links must be http(s) or mailto and open in a new tab.
 * Drops scripts, handlers, and unknown tags.
 */
export function sanitizeEventHtml(html: string): string {
  const withoutBlocks = html
    .replace(/<\s*(script|style|iframe|object|embed|form)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|form)[^>]*\/?\s*>/gi, '');
  return withoutBlocks.replace(/<\/?([a-z0-9]+)(\s[^>]*)?\s*\/?>/gi, (full, tag: string, attrs: string = '') => {
    const name = tag.toLowerCase();
    if (!ALLOWED.has(name)) return '';
    if (full.startsWith('</')) return `</${name}>`;
    if (name === 'br') return '<br>';
    if (name !== 'a') return `<${name}>`;
    const href = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const url = decodeHtmlEntities(href?.[2] || href?.[3] || href?.[4] || '').trim();
    if (!/^https?:\/\//i.test(url) && !/^mailto:/i.test(url)) return '';
    return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">`;
  });
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
