import {
  formatHmFromIso,
  initialCandidateIndex,
  minToPx,
  msToMinOfDay,
  nearestCandidateIndex,
  placeableCandidateIndex,
  pxToMin,
  resolvePlaceableStartIso,
  snapMsToStep,
  startFitsInFreeGap,
  SLOT_PX_PER_HOUR,
  SLOT_STEP_MIN,
} from './slotPickMath';

describe('slotPickMath', () => {
  const dayStart = Date.parse('2026-04-21T09:00:00.000Z');
  const dayEnd = Date.parse('2026-04-21T17:00:00.000Z');
  const candidates = [
    Date.parse('2026-04-21T09:00:00.000Z'),
    Date.parse('2026-04-21T10:00:00.000Z'),
    Date.parse('2026-04-21T14:00:00.000Z'),
  ];

  it('maps minutes to pixels at 72px/hour', () => {
    expect(minToPx(60)).toBe(SLOT_PX_PER_HOUR);
    expect(pxToMin(SLOT_PX_PER_HOUR)).toBe(60);
    expect(msToMinOfDay(dayStart + 30 * 60_000, dayStart)).toBe(30);
  });

  it('picks nearest candidate', () => {
    expect(
      nearestCandidateIndex(
        candidates,
        Date.parse('2026-04-21T10:07:00.000Z'),
      ),
    ).toBe(1);
  });

  it('initial index prefers at-or-after preferred', () => {
    expect(
      initialCandidateIndex(
        candidates,
        dayStart,
        dayEnd,
        Date.parse('2026-04-21T13:30:00.000Z'),
      ),
    ).toBe(2);
  });

  it('formats HM in a zone', () => {
    expect(
      formatHmFromIso('2026-04-21T12:30:00.000Z', 'UTC'),
    ).toBe('12:30');
  });

  it('exposes 15-minute step constant', () => {
    expect(SLOT_STEP_MIN).toBe(15);
  });

  it('snaps to the 15-minute grid', () => {
    expect(
      snapMsToStep(Date.parse('2026-04-21T10:07:00.000Z'), dayStart),
    ).toBe(Date.parse('2026-04-21T10:00:00.000Z'));
    expect(
      snapMsToStep(Date.parse('2026-04-21T10:08:00.000Z'), dayStart),
    ).toBe(Date.parse('2026-04-21T10:15:00.000Z'));
  });

  it('placeableCandidateIndex requires a near-exact candidate hit', () => {
    expect(
      placeableCandidateIndex(
        candidates,
        Date.parse('2026-04-21T12:00:00.000Z'),
      ),
    ).toBe(-1);
    expect(
      placeableCandidateIndex(
        candidates,
        Date.parse('2026-04-21T10:00:00.000Z'),
      ),
    ).toBe(1);
    expect(
      placeableCandidateIndex(
        candidates,
        Date.parse('2026-04-21T10:03:00.000Z'),
      ),
    ).toBe(-1);
  });

  it('startFitsInFreeGap checks duration fits inside a free band', () => {
    const free = [
      {
        start: Date.parse('2026-04-21T09:00:00.000Z'),
        end: Date.parse('2026-04-21T11:00:00.000Z'),
      },
    ];
    expect(
      startFitsInFreeGap(Date.parse('2026-04-21T10:00:00.000Z'), 30, free),
    ).toBe(true);
    expect(
      startFitsInFreeGap(Date.parse('2026-04-21T10:45:00.000Z'), 30, free),
    ).toBe(false);
  });

  it('resolvePlaceableStartIso prefers candidates, then free-gap fits', () => {
    const free = [
      {
        start: Date.parse('2026-04-21T09:00:00.000Z'),
        end: Date.parse('2026-04-21T11:00:00.000Z'),
      },
    ];
    const candidatesIso = [
      '2026-04-21T09:00:00.000Z',
      '2026-04-21T10:00:00.000Z',
      '2026-04-21T14:00:00.000Z',
    ];
    const candidatesMs = candidatesIso.map((iso) => Date.parse(iso));
    expect(
      resolvePlaceableStartIso(
        Date.parse('2026-04-21T10:00:00.000Z'),
        30,
        candidatesIso,
        candidatesMs,
        free,
      ),
    ).toBe('2026-04-21T10:00:00.000Z');
    // Listed candidate even if outside free bands (API is source of truth)
    expect(
      resolvePlaceableStartIso(
        Date.parse('2026-04-21T14:00:00.000Z'),
        30,
        candidatesIso,
        candidatesMs,
        free,
      ),
    ).toBe('2026-04-21T14:00:00.000Z');
    // On-grid inside free, even if not listed as a candidate
    expect(
      resolvePlaceableStartIso(
        Date.parse('2026-04-21T09:30:00.000Z'),
        30,
        candidatesIso,
        candidatesMs,
        free,
      ),
    ).toBe('2026-04-21T09:30:00.000Z');
    // Outside free and not a candidate
    expect(
      resolvePlaceableStartIso(
        Date.parse('2026-04-21T12:00:00.000Z'),
        30,
        candidatesIso,
        candidatesMs,
        free,
      ),
    ).toBeNull();
  });

  it('uses a taller hour scale for readable 30-min blocks', () => {
    expect(SLOT_PX_PER_HOUR).toBeGreaterThanOrEqual(144);
    expect(minToPx(30)).toBeGreaterThanOrEqual(64);
  });
});
