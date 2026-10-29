import { occurrenceStartIsoForYmd } from './occurrenceStart';

describe('occurrenceStartIsoForYmd', () => {
  it('returns noon on the civil day in the zone', () => {
    expect(occurrenceStartIsoForYmd('2026-04-21', 'UTC')).toBe(
      '2026-04-21T12:00:00+00:00',
    );
  });
});
