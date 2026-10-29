import { VOICE_READ_TOOL_NAMES } from '../../voice-agent.tools';
import type { ReadRequestV1 } from '../contracts/types';
import type { ReadRecord } from '../evidence/evidence';

const ALLOWED = new Set<string>(VOICE_READ_TOOL_NAMES);

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
    const produced: ReadRecord[] = [];
    for (const request of requests) {
      if (this.callsThisRound >= this.limits.maxCallsPerRound) {
        produced.push(this.fail(request, 'tool_limit'));
        continue;
      }
      this.callsThisRound += 1;
      if (!ALLOWED.has(request.name)) {
        produced.push(this.fail(request, 'unknown_tool'));
        continue;
      }
      try {
        const value = await this.execute(request.name, request.args);
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
        produced.push(record);
      } catch (err) {
        const record = this.fail(request, err instanceof Error && err.message === 'timeout' ? 'timeout' : 'tool_error');
        produced.push(record);
      }
    }
    return produced;
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
