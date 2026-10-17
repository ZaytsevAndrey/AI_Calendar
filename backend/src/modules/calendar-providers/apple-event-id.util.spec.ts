import {
  decodeAppleObjectId,
  encodeAppleObjectId,
} from './apple-event-id.util';

describe('apple-event-id.util', () => {
  const url =
    'https://caldav.icloud.com/18070852993/calendars/A7FDB1B2/aae2.ics';

  it('round-trips CalDAV object URLs through opaque ids', () => {
    const id = encodeAppleObjectId(url);
    expect(id).not.toContain('/');
    expect(id).not.toContain(':');
    expect(decodeAppleObjectId(id)).toBe(url);
  });

  it('accepts legacy raw URLs', () => {
    expect(decodeAppleObjectId(url)).toBe(url);
  });

  it('produces ids longer than Fastify default maxParamLength for real iCloud URLs', () => {
    const longUrl =
      'https://caldav.icloud.com/18070852993/calendars/A7FDB1B2-C3D4-E5F6-A7B8-C9D0E1F2A3B4/event-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.ics';
    const id = encodeAppleObjectId(longUrl);
    // Fastify default is 100; production sets maxParamLength to 2048 for these.
    expect(id.length).toBeGreaterThan(100);
    expect(id.length).toBeLessThan(2048);
    expect(decodeAppleObjectId(id)).toBe(longUrl);
  });
});
