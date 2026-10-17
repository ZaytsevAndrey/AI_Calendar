import { selectDueReminders } from './reminder-due.util';

const DAY = '2026-09-22';

function due(overrides: Partial<Parameters<typeof selectDueReminders>[0]> = {}) {
  return selectDueReminders({
    nowMs: Date.parse(`${DAY}T07:00:00.000Z`),
    blocks: [],
    alreadySent: new Set(),
    ...overrides,
  });
}

describe('selectDueReminders', () => {
  it('notifies a timed block that starts within 30 minutes', () => {
    const startMs = Date.parse(`${DAY}T10:00:00.000Z`);
    const items = due({
      nowMs: startMs - 20 * 60_000,
      blocks: [{ key: 'event:1', title: 'Deep work', startMs }],
    });
    expect(items).toEqual([
      {
        dedupeKey: `block:event:1:${startMs}`,
        title: 'Starting in 20 min',
        body: 'Deep work',
        url: '/',
      },
    ]);
  });

  it('localizes push titles when language is uk', () => {
    const startMs = Date.parse(`${DAY}T10:00:00.000Z`);
    const items = due({
      nowMs: startMs - 20 * 60_000,
      language: 'uk',
      blocks: [{ key: 'event:1', title: 'Deep work', startMs }],
    });
    expect(items[0]?.title).toBe('Починається за 20 хв');
  });

  it('skips a block that already started or is more than 30 minutes away', () => {
    const startMs = Date.parse(`${DAY}T10:00:00.000Z`);
    const block = { key: 'event:1', title: 'Deep work', startMs };
    expect(due({ nowMs: startMs + 1_000, blocks: [block] })).toEqual([]);
    expect(due({ nowMs: startMs - 31 * 60_000, blocks: [block] })).toEqual([]);
  });

  it('does not send a block that was already delivered', () => {
    const startMs = Date.parse(`${DAY}T10:00:00.000Z`);
    const items = due({
      nowMs: startMs - 10 * 60_000,
      blocks: [{ key: 'event:1', title: 'Deep work', startMs }],
      alreadySent: new Set([`block:event:1:${startMs}`]),
    });
    expect(items).toEqual([]);
  });
});
