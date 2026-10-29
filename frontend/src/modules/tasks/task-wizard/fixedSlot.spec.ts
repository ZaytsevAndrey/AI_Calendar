import { fixedSlotDraft, fixedSlotFields } from './fixedSlot';

describe('fixedSlot', () => {
  it('reads one civil day and both clocks from a stored slot', () => {
    expect(fixedSlotDraft('2026-10-25T09:00', '2026-10-25T10:30')).toEqual({
      startDate: '2026-10-25',
      endDate: '2026-10-25',
      start: '09:00',
      end: '10:30',
    });
  });

  it('keeps a stored end that falls on a later day', () => {
    expect(fixedSlotDraft('2026-10-25T22:00', '2026-10-26T01:00')).toEqual({
      startDate: '2026-10-25',
      endDate: '2026-10-26',
      start: '22:00',
      end: '01:00',
    });
  });

  it('writes the start clock on the first day and the end clock on the last', () => {
    expect(
      fixedSlotFields({
        startDate: '2026-10-25',
        endDate: '2026-10-27',
        start: '09:00',
        end: '18:00',
      }),
    ).toEqual({
      scheduledStartTime: '2026-10-25T09:00',
      scheduledEndTime: '2026-10-27T18:00',
    });
  });

  it('does not store a clock until its day is chosen', () => {
    expect(fixedSlotFields({ startDate: '', endDate: '', start: '09:00', end: '10:30' })).toEqual({
      scheduledStartTime: '',
      scheduledEndTime: '',
    });
  });

  it('stores a start without an end once the first day exists', () => {
    expect(
      fixedSlotFields({ startDate: '2026-10-25', endDate: '2026-10-25', start: '09:00', end: '' }),
    ).toEqual({
      scheduledStartTime: '2026-10-25T09:00',
      scheduledEndTime: '',
    });
  });
});
