const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

export type FixedSlotDraft = {
  startDate: string;
  endDate: string;
  start: string;
  end: string;
};

export type FixedSlotFields = {
  scheduledStartTime: string;
  scheduledEndTime: string;
};

export function splitDateTimeLocal(value?: string): { ymd: string; hm: string } {
  const match = DATE_TIME.exec(value?.trim() ?? '');
  if (!match) return { ymd: '', hm: '' };
  return { ymd: match[1], hm: match[2] };
}

/** Start clock stays on the first day, end clock on the last. */
export function fixedSlotDraft(start?: string, end?: string): FixedSlotDraft {
  const from = splitDateTimeLocal(start);
  const to = splitDateTimeLocal(end);
  return {
    startDate: from.ymd,
    endDate: to.ymd || from.ymd,
    start: from.hm,
    end: to.hm,
  };
}

/** A clock is written only together with its civil day, as `YYYY-MM-DDTHH:mm`. */
export function fixedSlotFields(draft: FixedSlotDraft): FixedSlotFields {
  const endDate = draft.endDate || draft.startDate;
  return {
    scheduledStartTime: draft.startDate && draft.start ? `${draft.startDate}T${draft.start}` : '',
    scheduledEndTime: endDate && draft.end ? `${endDate}T${draft.end}` : '',
  };
}
