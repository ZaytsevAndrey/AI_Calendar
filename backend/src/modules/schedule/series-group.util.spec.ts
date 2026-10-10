import {
  breaksSeriesMembership,
  groupYmdsByClockHm,
  pickMajorityClockSlot,
  pickPrimaryClockHm,
  weekDaysFromYmds,
} from './series-group.util';

describe('series-group.util', () => {
  describe('breaksSeriesMembership', () => {
    it('allows time, phase, and inbox state patches', () => {
      expect(
        breaksSeriesMembership({
          scheduledStartTime: '2026-04-20T10:00:00.000Z',
          scheduledEndTime: '2026-04-20T10:30:00.000Z',
          phaseIds: ['p1'],
          estimatedTimeInMinutes: 30,
          scheduleState: 'resolved',
        }),
      ).toBe(false);
    });

    it('breaks on name or other meta', () => {
      expect(breaksSeriesMembership({ name: 'Renamed' })).toBe(true);
      expect(
        breaksSeriesMembership({
          scheduledStartTime: '2026-04-20T10:00:00.000Z',
          description: 'x',
        }),
      ).toBe(true);
      expect(breaksSeriesMembership({ deadline: '2026-05-01T00:00:00.000Z' })).toBe(
        true,
      );
    });
  });

  describe('groupYmdsByClockHm + pickPrimaryClockHm', () => {
    it('groups by clock and picks the largest group', () => {
      const byHm = groupYmdsByClockHm([
        { ymd: '2026-04-20', hm: '10:00' },
        { ymd: '2026-04-21', hm: '10:00' },
        { ymd: '2026-04-22', hm: '11:00' },
        { ymd: '2026-04-23', hm: '10:00' },
        { ymd: '2026-04-24', hm: '10:00' },
      ]);
      expect([...byHm.get('10:00')!]).toEqual([
        '2026-04-20',
        '2026-04-21',
        '2026-04-23',
        '2026-04-24',
      ]);
      expect(byHm.get('11:00')).toEqual(['2026-04-22']);
      expect(pickPrimaryClockHm(byHm, '10:00')).toBe('10:00');
    });

    it('on a tie prefers preferredHm', () => {
      const byHm = groupYmdsByClockHm([
        { ymd: '2026-04-20', hm: '09:00' },
        { ymd: '2026-04-21', hm: '11:00' },
      ]);
      expect(pickPrimaryClockHm(byHm, '11:00')).toBe('11:00');
    });
  });

  describe('weekDaysFromYmds', () => {
    it('returns sorted weekday indexes', () => {
      // 2026-04-20 Mon … 2026-04-22 Wed
      expect(
        weekDaysFromYmds(['2026-04-20', '2026-04-22', '2026-04-20']),
      ).toEqual([1, 3]);
    });
  });

  describe('pickMajorityClockSlot', () => {
    it('ignores a single skewed earliest day and anchors on majority HM', () => {
      const skewed = {
        scheduledStartTime: new Date('2026-10-12T06:30:00.000Z'), // 09:30 Nicosia
        scheduledEndTime: new Date('2026-10-12T07:00:00.000Z'),
      };
      const majorityA = {
        scheduledStartTime: new Date('2026-10-17T07:00:00.000Z'), // 10:00
        scheduledEndTime: new Date('2026-10-17T07:30:00.000Z'),
      };
      const majorityB = {
        scheduledStartTime: new Date('2026-10-19T07:00:00.000Z'),
        scheduledEndTime: new Date('2026-10-19T07:30:00.000Z'),
      };
      const pick = pickMajorityClockSlot(
        [skewed, majorityA, majorityB],
        'Asia/Nicosia',
        '10:00',
      );
      expect(pick).toBe(majorityA);
    });
  });
});
