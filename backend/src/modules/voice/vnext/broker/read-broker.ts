import { VOICE_READ_TOOL_NAMES } from '../../voice-agent.tools';
import type { ReadRequestV1 } from '../contracts/types';
import { FIND_EVENTS_TOOL } from '../search/find-events';
import { FIND_TASKS_TOOL } from '../search/find-tasks';
import type { ReadRecord } from '../evidence/evidence';

const ALLOWED = new Set<string>([...VOICE_READ_TOOL_NAMES, FIND_TASKS_TOOL, FIND_EVENTS_TOOL]);

export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export class ReadBroker {
  readonly records: ReadRecord[] = [];
  private callsThisRound = 0;

  constructor(
    private readonly execute: ToolExecutor,
    private readonly limits = { maxRounds: 2, maxCallsPerRound: 6 },
  ) {}

  async run(round: number, requests: ReadRequestV1[]): Promise<ReadRecord[]> {
    if (round > this.limits.maxRounds) {
      return requests.map((request) => this.fail(request, 'tool_limit'));
    }
    // Reads of one round are independent: they run together, and records keep request order.
    const settled = await Promise.all(requests.map((request) => {
      if (this.callsThisRound >= this.limits.maxCallsPerRound) return { request, error: 'tool_limit' };
      this.callsThisRound += 1;
      if (!ALLOWED.has(request.name)) return { request, error: 'unknown_tool' };
      return this.execute(request.name, request.args).then(
        (value) => ({ request, value }),
        (err: unknown) => ({ request, error: err instanceof Error && err.message === 'timeout' ? 'timeout' : 'tool_error' }),
      );
    }));
    return settled.map((row) => ('error' in row ? this.fail(row.request, row.error) : this.record(row.request, row.value)));
  }

  private record(request: ReadRequestV1, value: unknown): ReadRecord {
    const error = isRecord(value) && typeof value.error === 'string' ? value.error : undefined;
    const day = isRecord(value) && typeof value.day === 'string' ? value.day : argDay(request.args);
    const record: ReadRecord = {
      requestId: request.requestId,
      name: request.name,
      args: request.args,
      ok: !error,
      ...(error ? { error } : {}),
      ...(day ? { day } : {}),
      scope: readScope(value, request.name),
      ...(!error && value === undefined ? { withheld: 'missing_result' as const } : {}),
      ...(!error && value !== undefined ? { result: value } : {}),
    };
    this.records.push(record);
    return record;
  }

  nextRound(): void {
    this.callsThisRound = 0;
  }

  private fail(request: ReadRequestV1, error: string): ReadRecord {
    const record: ReadRecord = {
      requestId: request.requestId,
      name: request.name,
      args: request.args,
      ok: false,
      error,
    };
    this.records.push(record);
    return record;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function argDay(args: Record<string, unknown>): string | undefined {
  return typeof args.day === 'string' ? args.day : undefined;
}

function readScope(value: unknown, name: string): ReadRecord['scope'] {
  if (isRecord(value) && (value.scope === 'day' || value.scope === 'week' || value.scope === 'open' || value.scope === 'now')) {
    return value.scope;
  }
  if (name === 'get_day_agenda') return 'day';
  if (name === 'get_now_next') return 'now';
  return undefined;
}
