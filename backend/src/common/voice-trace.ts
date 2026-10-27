import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { redactSecrets } from './voice-file-logger';

export type VoiceStepKind = 'llm' | 'other';

export type VoiceComponent =
  | 'planner'
  | 'tool'
  | 'router'
  | 'specialist'
  | 'normalizer'
  | 'orchestrator';

/** What the orchestrator did with one planner segment. Separate from validation. */
export type VoiceSegmentOutcome = 'accepted' | 'clarify' | 'refused' | 'dropped';

/** Fields a step may carry. `traceId` stays on the trace, not on each step. */
export type VoiceStepNote = {
  component?: VoiceComponent;
  segment?: number;
  tokens?: number;
  /** Planner decision type. Not a segment result and not a validation flag. */
  decision?: string;
  errorCode?: string;
  reason?: string;
  /** Set when the reply was checked. Absent when this step has no validation. */
  valid?: boolean;
  /** Segment disposition. Absent on model calls and tool calls. */
  outcome?: VoiceSegmentOutcome;
};

export type VoiceStep = VoiceStepNote & {
  kind: VoiceStepKind;
  name: string;
  /** Provider and model, empty for local work such as a database read. */
  via: string;
  ms: number;
  /** Technical outcome. A rejected decision keeps this true when the call itself returned. */
  ok: boolean;
};

const SEGMENT_OUTCOMES = new Set<VoiceSegmentOutcome>([
  'accepted',
  'clarify',
  'refused',
  'dropped',
]);

const storage = new AsyncLocalStorage<VoiceTrace>();
/** Notes for the traceStep that is actually running, including when two steps overlap. */
const notesStorage = new AsyncLocalStorage<VoiceStepNote>();
const traceKey = Symbol.for('voice.trace');
const BODY_KEEP = 2000;

export class VoiceTrace {
  readonly traceId: string;
  readonly steps: VoiceStep[] = [];
  /** Planner segment being parsed. Router, specialist, and normalizer read it. */
  activeSegment?: number;
  private nextLlmReason?: string;

  constructor(traceId?: string) {
    const id = traceId?.trim();
    this.traceId = id || randomUUID();
  }

  armNextLlmReason(reason: string): void {
    this.nextLlmReason = reason;
  }

  takeNextLlmReason(): string | undefined {
    const reason = this.nextLlmReason;
    this.nextLlmReason = undefined;
    return reason;
  }
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

export function currentVoiceTrace(): VoiceTrace | undefined {
  return storage.getStore();
}

/** Run `fn` so nested model and database calls land on this request's trace. */
export function runWithVoiceTrace<T>(trace: VoiceTrace, fn: () => T): T {
  return storage.run(trace, fn);
}

/**
 * One trace for a user turn.
 * An HTTP request or an outer direct call that already opened a trace is reused.
 */
export function withTurnTrace<T>(fn: () => Promise<T>): Promise<T> {
  if (storage.getStore()) return fn();
  return runWithVoiceTrace(new VoiceTrace(), fn);
}

/** Remember which planner segment the nested router, specialist, and normalizer belong to. */
export async function withVoiceSegment<T>(segment: number, fn: () => Promise<T>): Promise<T> {
  const trace = storage.getStore();
  if (!trace) return fn();
  const previous = trace.activeSegment;
  trace.activeSegment = segment;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete trace.activeSegment;
    else trace.activeSegment = previous;
  }
}

/** Attach tokens or other codes to the step that is running now. Nested steps keep their own notes. */
export function noteVoiceStep(patch: VoiceStepNote): void {
  const notes = notesStorage.getStore();
  if (!notes) return;
  Object.assign(notes, patch);
}

/** The next model call on this turn records why the previous attempt gave up. */
export function armNextLlmReason(reason: string): void {
  storage.getStore()?.armNextLlmReason(reason);
}

export function annotateLatestStep(
  match: (step: VoiceStep) => boolean,
  patch: VoiceStepNote | ((step: VoiceStep) => VoiceStepNote),
): void {
  const trace = storage.getStore();
  if (!trace) return;
  for (let i = trace.steps.length - 1; i >= 0; i -= 1) {
    const step = trace.steps[i];
    if (!match(step)) continue;
    Object.assign(step, typeof patch === 'function' ? patch(step) : patch);
    return;
  }
}

export function voiceComponentForStep(name: string): VoiceComponent | undefined {
  if (name === 'router' || name.startsWith('router.')) return 'router';
  if (name.startsWith('specialist')) return 'specialist';
  if (name.startsWith('planner')) return 'planner';
  if (name.startsWith('tool.')) return 'tool';
  if (name === 'normalizer') return 'normalizer';
  return undefined;
}

/**
 * Bodies (transcripts, raw model text, calendar payloads) stay off unless asked.
 * Production needs a second explicit flag so a copied dev env is not enough.
 */
export function voiceTraceBodiesEnabled(): boolean {
  const flag = process.env.VOICE_TRACE_BODY?.trim().toLowerCase();
  if (flag !== '1' && flag !== 'true') return false;
  if (process.env.NODE_ENV === 'production') {
    const allow = process.env.VOICE_TRACE_BODY_PRODUCTION?.trim().toLowerCase();
    return allow === '1' || allow === 'true';
  }
  return true;
}

/** Redact secrets and cap length before a debug body is written. */
export function clipVoiceBody(text: string, maxChars = BODY_KEEP): string {
  const clean = redactSecrets(String(text || ''))
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…(+${clean.length - maxChars})`;
}

export function voiceTraceReport(trace: VoiceTrace): { traceId: string; steps: VoiceStep[] } {
  return {
    traceId: trace.traceId,
    steps: trace.steps.map((step) => ({ ...step })),
  };
}

function clipToken(value: string, max = 80): string {
  return value.replace(/[|\r\n]/g, ' ').trim().slice(0, max);
}

function definedNote(note: VoiceStepNote): VoiceStepNote {
  const out: VoiceStepNote = {};
  if (note.component) out.component = note.component;
  if (note.segment != null) out.segment = note.segment;
  if (note.tokens != null) out.tokens = note.tokens;
  if (note.decision) out.decision = clipToken(note.decision);
  if (note.errorCode) out.errorCode = clipToken(note.errorCode);
  if (note.reason) out.reason = clipToken(note.reason, 180);
  if (note.valid != null) out.valid = note.valid;
  if (note.outcome && SEGMENT_OUTCOMES.has(note.outcome)) out.outcome = note.outcome;
  return out;
}

/** A bookkeeping step, such as the disposition of one segment. No personal data. */
export function recordVoiceStep(step: VoiceStepNote & { name: string; ok?: boolean }): void {
  const trace = storage.getStore();
  if (!trace) return;
  trace.steps.push({
    kind: 'other',
    name: clipToken(step.name) || 'step',
    via: '',
    ms: 0,
    ok: step.ok ?? true,
    ...definedNote(step),
  });
}

type StepMeta<T> = {
  component?: VoiceComponent;
  segment?: number;
  describe?: (value: T) => VoiceStepNote;
};

/**
 * Time one step of the current voice turn.
 * Outside a trace (tests, a call that did not open one) this only runs `fn`.
 * `failed` marks a result that came back without throwing, such as a provider hop.
 * Validation (`valid`) is separate from `ok` and is filled in by the caller.
 */
export async function traceStep<T>(
  kind: VoiceStepKind,
  name: string,
  via: string,
  fn: () => Promise<T>,
  failed?: (value: T) => boolean,
  meta?: StepMeta<T>,
): Promise<T> {
  const trace = storage.getStore();
  const notes: VoiceStepNote = {};
  const start = Date.now();
  const finish = (ok: boolean, extra: VoiceStepNote): void => {
    if (!trace) return;
    let reason = notes.reason ?? extra.reason;
    if (kind === 'llm') {
      const armed = trace.takeNextLlmReason();
      if (armed) reason = reason ? `${reason},${armed}` : armed;
    }
    trace.steps.push({
      kind,
      name: clipToken(name) || 'step',
      via: clipToken(via),
      ms: Math.max(0, Date.now() - start),
      ok,
      ...definedNote({ ...notes, ...extra, ...(reason ? { reason } : {}) }),
    });
  };
  const exec = async (): Promise<T> => {
    try {
      const value = await fn();
      let described: VoiceStepNote = {};
      if (meta?.describe) {
        try {
          described = meta.describe(value) ?? {};
        } catch {
          described = {};
        }
      }
      finish(!failed?.(value), {
        ...(meta?.component ? { component: meta.component } : {}),
        ...(meta?.segment != null ? { segment: meta.segment } : {}),
        ...described,
      });
      return value;
    } catch (err) {
      finish(false, {
        ...(meta?.component ? { component: meta.component } : {}),
        ...(meta?.segment != null ? { segment: meta.segment } : {}),
      });
      throw err;
    }
  };
  return notesStorage.run(notes, exec);
}

function sumMs(steps: VoiceStep[]): number {
  return steps.reduce((total, step) => total + step.ms, 0);
}

function formatStep(step: VoiceStep): string {
  const via = step.via ? ` ${step.via}` : '';
  const segment = step.segment != null ? ` s${step.segment}` : '';
  const outcome = step.outcome ? ` outcome=${step.outcome}` : '';
  const decision = step.decision ? ` decision=${clipToken(step.decision)}` : '';
  const tokens = step.tokens != null ? ` tokens=${step.tokens}` : '';
  const technical = step.ok ? '' : ' fail';
  const validation =
    step.valid === false
      ? ` invalid=${step.errorCode ? clipToken(step.errorCode) : 'rejected'}`
      : '';
  const reason = step.reason ? ` reason=${clipToken(step.reason, 180)}` : '';
  return `${step.kind} ${step.name}${via}${segment}${outcome}${decision}${tokens} ${step.ms}ms${technical}${validation}${reason}`;
}

/**
 * One line for a finished /voice call: trace id, wall time, how many model calls,
 * how many other steps, the unaccounted gap, then each step in order.
 * The id is on the line once. Steps do not repeat it.
 * Null for every other route.
 */
export function formatVoiceTrace(input: {
  traceId: string;
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
    `voice.trace ${clipToken(input.traceId) || 'none'} ${input.method} ${path} ${input.statusCode} ${total}ms` +
    ` | llm ${llm.length}x ${sumMs(llm)}ms` +
    ` | other ${other.length}x ${sumMs(other)}ms` +
    ` | gap ${gap}ms`;
  if (!input.steps.length) return head;
  return `${head} | ${input.steps.map(formatStep).join(' | ')}`;
}
