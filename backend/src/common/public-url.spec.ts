import { getFrontendBaseUrl, toAbsoluteUrl } from './public-url';

describe('toAbsoluteUrl', () => {
  it('uses fallback when value is empty', () => {
    expect(toAbsoluteUrl(undefined, 'http://localhost:3000')).toBe(
      'http://localhost:3000',
    );
    expect(toAbsoluteUrl('  ', 'http://localhost:3000/')).toBe(
      'http://localhost:3000',
    );
  });

  it('keeps http(s) URLs and strips a trailing slash', () => {
    expect(toAbsoluteUrl('https://app.example.com/', 'http://localhost:3000')).toBe(
      'https://app.example.com',
    );
  });

  it('prefixes https for bare hostnames (Render fromService host)', () => {
    expect(toAbsoluteUrl('ai-calendar-web.onrender.com', 'http://localhost:3000')).toBe(
      'https://ai-calendar-web.onrender.com',
    );
  });
});

describe('getFrontendBaseUrl', () => {
  const original = process.env.FRONTEND_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FRONTEND_URL;
    } else {
      process.env.FRONTEND_URL = original;
    }
  });

  it('defaults to local frontend', () => {
    delete process.env.FRONTEND_URL;
    expect(getFrontendBaseUrl()).toBe('http://localhost:3000');
  });
});
