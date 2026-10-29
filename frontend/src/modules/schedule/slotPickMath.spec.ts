import {
  adjacentCandidateMs,
  clampFocusMs,
  initialFocusMs,
  suggestedStarts,
  formatHmFromIso,
  initialCandidateIndex,
  minToPx,
  msToMinOfDay,
  nearestCandidateIndex,
  placeableCandidateIndex,
  preferredMsOnDay,
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

  it('suggests distinct starts nearest the old clock', () => {
    const at = (hm: string) => Date.parse(`2026-04-21T${hm}:00.000Z`);
    const free = ['09:00', '09:15', '09:30', '13:00', '13:15', '17:30', '18:00'].map(at);
    expect(suggestedStarts(free, at('17:45'), 30)).toEqual([
      at('13:15'),
      at('17:30'),
      at('18:00'),
    ]);
    expect(suggestedStarts(free, null, 60, 2)).toEqual([at('09:00'), at('13:00')]);
    expect(suggestedStarts([], at('10:00'), 30)).toEqual([]);
  });

  it('opens on the best candidate, else the first free gap', () => {
    expect(initialFocusMs(candidates, [], dayStart, dayEnd, null, dayStart)).toBe(
      candidates[0],
    );
    const gap = {
      start: Date.parse('2026-04-21T11:05:00.000Z'),
      end: Date.parse('2026-04-21T11:20:00.000Z'),
    };
    expect(initialFocusMs([], [gap], dayStart, dayEnd, null, dayStart)).toBe(
      Date.parse('2026-04-21T11:00:00.000Z'),
    );
  });

  it('steps between free starts and clamps to the day', () => {
    expect(adjacentCandidateMs(candidates, candidates[1], 1)).toBe(candidates[2]);
    expect(adjacentCandidateMs(candidates, candidates[1], -1)).toBe(candidates[0]);
    expect(adjacentCandidateMs(candidates, candidates[2], 1)).toBeNull();
    expect(clampFocusMs(dayEnd, dayStart, dayEnd, 30)).toBe(dayEnd - 30 * 60_000);
    expect(clampFocusMs(dayStart - 1, dayStart, dayEnd, 30)).toBe(dayStart);
  });

  it("moves the preferred clock onto another day", () => {
    const ms = preferredMsOnDay("2026-04-21T18:00:00.000Z", "2026-04-24", "UTC");
    expect(ms).toBe(Date.parse("2026-04-24T18:00:00.000Z"));
    expect(preferredMsOnDay(null, "2026-04-24", "UTC")).toBeNull();
  });

  it("initial index keeps the old clock on a later day", () => {
    const later = [
      Date.parse("2026-04-24T09:00:00.000Z"),
      Date.parse("2026-04-24T18:00:00.000Z"),
    ];
    const preferred = preferredMsOnDay("2026-04-21T18:00:00.000Z", "2026-04-24", "UTC");
    expect(
      initialCandidateIndex(
        later,
        Date.parse("2026-04-24T07:00:00.000Z"),
        Date.parse("2026-04-24T22:00:00.000Z"),
        preferred,
        Date.parse("2026-04-21T08:00:00.000Z"),
      ),
    ).toBe(1);
  });
});
