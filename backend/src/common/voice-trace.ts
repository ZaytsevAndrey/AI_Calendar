import { AsyncLocalStorage } from 'async_hooks';

export type VoiceStepKind = 'llm' | 'other';

export type VoiceStep = {
  kind: VoiceStepKind;
  name: string;
  /** Provider and model, empty for local work such as a database read. */
  via: string;
  ms: number;
  ok: boolean;
};

const storage = new AsyncLocalStorage<VoiceTrace>();
const traceKey = Symbol.for('voice.trace');

export class VoiceTrace {
  readonly steps: VoiceStep[] = [];
}

type TracedRequest = { [traceKey]?: VoiceTrace };

export function bindVoiceTrace(request: object): VoiceTrace {
  const host = request as TracedRequest;
  const existing = host[traceKey];
  if (existing) return existing;
  const trace = new VoiceTrace();
  host[traceKey] = trace;
  return trace;
}

export function readVoiceTrace(request: object): VoiceTrace | undefined {
  return (request as TracedRequest)[traceKey];
}

/** Run `fn` so nested model and database calls land on this request's trace. */
export function runWithVoiceTrace<T>(trace: VoiceTrace, fn: () => T): T {
  return storage.run(trace, fn);
}

function clipToken(value: string): string {
  return value.replace(/[|\r\n]/g, ' ').trim().slice(0, 80);
}

/**
 * Time one step of the current voice request.
 * Outside a request (tests, eval) this only runs `fn`.
 * `failed` marks a result that came back without throwing, such as a provider hop.
 */
export async function traceStep<T>(
  kind: VoiceStepKind,
  name: string,
  via: string,
  fn: () => Promise<T>,
  failed?: (value: T) => boolean,
): Promise<T> {
  const trace = storage.getStore();
  const start = Date.now();
  try {
    const value = await fn();
    trace?.steps.push({
      kind,
      name: clipToken(name) || 'step',
      via: clipToken(via),
      ms: Math.max(0, Date.now() - start),
      ok: !failed?.(value),
    });
    return value;
  } catch (err) {
    trace?.steps.push({
      kind,
      name: clipToken(name) || 'step',
      via: clipToken(via),
      ms: Math.max(0, Date.now() - start),
      ok: false,
    });
    throw err;
  }
}

function sumMs(steps: VoiceStep[]): number {
  return steps.reduce((total, step) => total + step.ms, 0);
}

/**
 * One line for a finished /voice call: wall time, how many model calls,
 * how many other steps, the unaccounted gap, then each step in order.
 * Null for every other route.
 */
export function formatVoiceTrace(input: {
  method: string;
  url: string;
  statusCode: number;
  totalMs: number;
  steps: VoiceStep[];
}): string | null {
  const path = (input.url || '').split('?')[0];
  if (!/^\/voice(?:\/|$)/.test(path)) return null;
  const total = Math.max(0, Math.round(input.totalMs));
  const llm = input.steps.filter((step) => step.kind === 'llm');
  const other = input.steps.filter((step) => step.kind === 'other');
  const gap = total - sumMs(input.steps);
  const head =
    `voice.trace ${input.method} ${path} ${input.statusCode} ${total}ms` +
    ` | llm ${llm.length}x ${sumMs(llm)}ms` +
    ` | other ${other.length}x ${sumMs(other)}ms` +
    ` | gap ${gap}ms`;
  if (!input.steps.length) return head;
  const detail = input.steps
    .map((step) => {
      const via = step.via ? ` ${step.via}` : '';
      const flag = step.ok ? '' : ' fail';
      return `${step.kind} ${step.name}${via} ${step.ms}ms${flag}`;
    })
    .join(' | ');
  return `${head} | ${detail}`;
}
