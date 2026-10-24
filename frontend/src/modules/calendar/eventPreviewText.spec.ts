import { linkify, sanitizeEventHtml, stripHtml } from './eventPreviewText';

describe('eventPreviewText', () => {
  it('strips tags and keeps the words', () => {
    expect(stripHtml('<p>Hello <strong>there</strong></p><p>Next</p>')).toBe('Hello there\nNext');
  });

  it('linkifies http addresses and leaves the rest as text', () => {
    const segments = linkify('Map: https://maps.example.com/home.');
    expect(segments).toEqual([
      { type: 'text', value: 'Map: ' },
      { type: 'link', url: 'https://maps.example.com/home' },
      { type: 'text', value: '.' },
    ]);
  });

  it('keeps a safe link and drops a script', () => {
    const html = sanitizeEventHtml(
      '<p>See <a href="https://example.com/notes">notes</a></p><script>alert(1)</script>',
    );
    expect(html).toContain('href="https://example.com/notes"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('script');
    expect(html).not.toContain('alert');
  });

  it('drops javascript links', () => {
    expect(sanitizeEventHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript');
  });
});
