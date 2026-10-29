import { ReadBroker } from './read-broker';

describe('ReadBroker', () => {
  it('runs the reads of one round together and keeps request order', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const broker = new ReadBroker(async (name) => {
      started.push(name);
      await gate;
      return { name };
    });
    const pending = broker.run(1, [
      { requestId: 'r-1', name: 'get_day_agenda', args: { day: '2026-10-19' } },
      { requestId: 'r-2', name: 'find_free_gaps', args: { day: '2026-10-19' } },
    ]);
    await Promise.resolve();
    expect(started).toEqual(['get_day_agenda', 'find_free_gaps']);
    release();
    const records = await pending;
    expect(records.map((row) => row.requestId)).toEqual(['r-1', 'r-2']);
    expect(records.every((row) => row.ok)).toBe(true);
  });

  it('fails an unknown tool, a thrown read, and a read past the round limit without running them', async () => {
    const execute = jest.fn(async (name: string) => {
      if (name === 'get_task') throw new Error('timeout');
      return {};
    });
    const broker = new ReadBroker(execute, { maxRounds: 2, maxCallsPerRound: 2 });
    const records = await broker.run(1, [
      { requestId: 'r-1', name: 'drop_table', args: {} },
      { requestId: 'r-2', name: 'get_task', args: {} },
      { requestId: 'r-3', name: 'list_reminders', args: {} },
    ]);
    expect(records.map((row) => row.error)).toEqual(['unknown_tool', 'timeout', 'tool_limit']);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
