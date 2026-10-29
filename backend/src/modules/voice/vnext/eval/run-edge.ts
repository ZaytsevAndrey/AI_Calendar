import { createSession, type VNextSession } from '../session/session';
import { runVNextTurn, type InterpretOutput } from '../pipeline';
import type { ReadRecord } from '../evidence/evidence';
import type { EdgeCase } from './edge-cases';
import { scoreCase, type RubricActual } from './rubric';

const READS: Record<string, ReadRecord[]> = {
  'edge-calendar-search': [
    { requestId: 'r1', name: 'get_day_agenda', args: { day: '2026-10-18' }, ok: true, day: '2026-10-18', scope: 'day' },
  ],
  'edge-tool-timeout': [
    { requestId: 'r1', name: 'find_free_gaps', args: { day: '2026-10-19' }, ok: false, error: 'timeout' },
  ],
};

function scripted(edge: EdgeCase): InterpretOutput {
  if (!edge.envelope) {
    return {
      ok: false,
      reads: [],
      usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
      specialist: null,
      promptHash: 'scripted',
      code: edge.failureCode ?? 'invalid_model_output',
    };
  }
  return {
    ok: true,
    envelope: edge.envelope,
    reads: READS[edge.id] ?? [],
    usage: { calls: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    specialist: edge.envelope.operations.some((operation) => operation.constraints.some((constraint) => constraint.kind === 'recurrence'))
      ? 'recurrence_grammar'
      : 'bypass_simple',
    promptHash: 'scripted',
  };
}

export async function runEdge(edge: EdgeCase, session = createSession('user-1', `sess-${edge.id}`)): Promise<{ actual: RubricActual; session: VNextSession }> {
  if (edge.sessionPatch) Object.assign(session, edge.sessionPatch);
  const result = await runVNextTurn(
    {
      transcript: edge.transcript,
      userId: 'user-1',
      session,
      nowIso: edge.nowIso,
      timeZone: edge.timeZone,
      wakeHm: edge.wakeHm,
      sleepHm: edge.sleepHm,
      defaultDurationMinutes: edge.defaultDurationMinutes,
      language: edge.language,
      entities: edge.entities,
      evidenceNeed: edge.evidenceNeed,
      arm: 'A',
    },
    { arm: 'A', interpret: async () => scripted(edge) },
  );
  const body = JSON.stringify(result.response);
  const created = result.response.intents.find((intent) => intent.type === 'create');
  const minutes = created ? Number((created.task as { estimatedTimeInMinutes?: number }).estimatedTimeInMinutes) : undefined;
  return {
    session,
    actual: {
      outcome: result.response.outcome,
      serverWrites: result.serverWrites,
      body,
      intentCount: result.response.intents.length,
      heldCount: session.heldIntents.length,
      ...(Number.isFinite(minutes) ? { durationMinutes: minutes } : {}),
      preservedLabels: result.preservedLabels,
      blocked: result.blocked,
    },
  };
}

export async function scoreEdge(edge: EdgeCase): Promise<ReturnType<typeof scoreCase>> {
  if (edge.id === 'edge-repeat-confirm') {
    const session = createSession('user-1', 'sess-repeat');
    session.pendingIntents = [{ type: 'create', summary: 'хліб', task: { name: 'хліб' } }];
    session.pendingSummary = 'хліб';
    await runEdge(edge, session);
    const second = await runEdge(edge, session);
    return scoreCase(edge.expect, second.actual);
  }
  const ran = await runEdge(edge);
  return scoreCase(edge.expect, ran.actual);
}
