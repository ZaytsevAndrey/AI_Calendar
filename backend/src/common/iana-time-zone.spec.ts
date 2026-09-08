import { isValidIanaTimeZone, resolveIanaTimeZone } from './iana-time-zone';

describe('resolveIanaTimeZone', () => {
  it('falls back to UTC when empty or invalid', () => {
    expect(resolveIanaTimeZone(null)).toBe('UTC');
    expect(resolveIanaTimeZone('')).toBe('UTC');
    expect(resolveIanaTimeZone('Not/AZone')).toBe('UTC');
  });

  it('keeps a valid IANA zone', () => {
    expect(resolveIanaTimeZone('Asia/Nicosia')).toBe('Asia/Nicosia');
  });
});

describe('isValidIanaTimeZone', () => {
  it('accepts IANA names and rejects garbage', () => {
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Nicosia')).toBe(true);
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
  });
});
