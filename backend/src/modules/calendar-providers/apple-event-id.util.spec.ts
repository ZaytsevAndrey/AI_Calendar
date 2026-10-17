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
});
