const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

export type FixedSlotDraft = {
  date: string;
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

/** Date comes from the start, then the end. Clocks stay independent of that date. */
export function fixedSlotDraft(start?: string, end?: string): FixedSlotDraft {
  const from = splitDateTimeLocal(start);
  const to = splitDateTimeLocal(end);
  return {
    date: from.ymd || to.ymd,
    start: from.hm,
    end: to.hm,
  };
}

/** A clock is written only together with a civil day, as `YYYY-MM-DDTHH:mm`. */
export function fixedSlotFields(date: string, start: string, end: string): FixedSlotFields {
  return {
    scheduledStartTime: date && start ? `${date}T${start}` : '',
    scheduledEndTime: date && end ? `${date}T${end}` : '',
  };
}
