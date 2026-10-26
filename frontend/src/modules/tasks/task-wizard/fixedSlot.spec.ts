import { fixedSlotDraft, fixedSlotFields } from './fixedSlot';

describe('fixedSlot', () => {
  it('reads one civil day and both clocks from a stored slot', () => {
    expect(fixedSlotDraft('2026-10-25T09:00', '2026-10-25T10:30')).toEqual({
      date: '2026-10-25',
      start: '09:00',
      end: '10:30',
    });
  });

  it('keeps the start date when a stored end falls on the next day', () => {
    expect(fixedSlotDraft('2026-10-25T22:00', '2026-10-26T01:00')).toEqual({
      date: '2026-10-25',
      start: '22:00',
      end: '01:00',
    });
  });

  it('writes both clocks onto the chosen day', () => {
    expect(fixedSlotFields('2026-10-25', '09:00', '10:30')).toEqual({
      scheduledStartTime: '2026-10-25T09:00',
      scheduledEndTime: '2026-10-25T10:30',
    });
  });

  it('does not store a clock until the day is chosen', () => {
    expect(fixedSlotFields('', '09:00', '10:30')).toEqual({
      scheduledStartTime: '',
      scheduledEndTime: '',
    });
  });

  it('stores a start without an end once the day exists', () => {
    expect(fixedSlotFields('2026-10-25', '09:00', '')).toEqual({
      scheduledStartTime: '2026-10-25T09:00',
      scheduledEndTime: '',
    });
  });
});
