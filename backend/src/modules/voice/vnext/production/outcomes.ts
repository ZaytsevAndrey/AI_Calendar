/**
 * Client Apply outcomes for a dispatched structured execution.
 * The ledger is what confirm consults before sending a write again: `unknown` blocks a resend,
 * `failed` allows one, `succeeded` is history.
 */
import type { VoiceExecutionReport } from '../../voice-agent.types';
import type { ExecutionState } from '../contracts/proposal';
import type { SessionEntry } from './session-registry';

type LedgerStatus = 'succeeded' | 'failed' | 'unknown';
type ReportRow = VoiceExecutionReport['results'][number];

/**
 * applied → stored. conflict → stored; the client is asking where to place it.
 * skipped → never sent. error → failed only when the server definitively rejected it,
 * otherwise the write may have landed and is unknown.
 */
export function ledgerStatus(row: ReportRow): LedgerStatus {
  if (row.status === 'applied' || row.status === 'conflict') return 'succeeded';
  if (row.status === 'skipped') return 'failed';
  return row.definite === true ? 'failed' : 'unknown';
}

function executionState(statuses: LedgerStatus[]): ExecutionState {
  if (statuses.some((status) => status === 'unknown')) return 'unknown';
  if (statuses.some((status) => status === 'failed')) return 'definitive_failure';
  return 'provider_succeeded';
}

function setLedger(entry: SessionEntry, key: string, status: LedgerStatus | 'pending', error?: string): void {
  const ledger = entry.session.applyLedger;
  const row = ledger.find((item) => item.key === key);
  if (row) {
    row.status = status;
    if (error) row.error = error;
    else delete row.error;
  } else {
    ledger.push({ key, status, ...(error ? { error } : {}) });
  }
}

function setExecutionState(entry: SessionEntry, executionId: string, state: ExecutionState): void {
  const structured = entry.session.structured;
  if (!structured) return;
  entry.session.structured = {
    ...structured,
    executions: structured.executions.map((record) => (record.executionId === executionId ? { ...record, state } : record)),
  };
}

/** Remember what was handed to the client so its report can be matched by position. */
export function recordDispatch(entry: SessionEntry, executionId: string, keys: string[]): void {
  entry.dispatched.set(executionId, { keys, reported: false });
}

/**
 * Apply a client report. A report for an execution this session did not dispatch, or with a
 * different number of rows, changes nothing.
 */
export function applyReport(entry: SessionEntry, report: VoiceExecutionReport | undefined): { ok: boolean; code?: string } {
  const executionId = report?.executionId;
  if (!executionId) return { ok: false, code: 'report_without_execution' };
  const dispatched = entry.dispatched.get(executionId);
  if (!dispatched) return { ok: false, code: 'unknown_execution' };
  const rows = report?.results ?? [];
  if (rows.length !== dispatched.keys.length) return { ok: false, code: 'report_shape' };
  const statuses = rows.map(ledgerStatus);
  statuses.forEach((status, index) => setLedger(entry, dispatched.keys[index], status, status === 'succeeded' ? undefined : rows[index].status));
  dispatched.reported = true;
  setExecutionState(entry, executionId, executionState(statuses));
  return { ok: true };
}

/**
 * A dispatched execution with no report by the next turn may have partly run. Its pending rows
 * become unknown, so the same write is not sent again on a fresh confirm.
 */
export function expireUnreported(entry: SessionEntry): string[] {
  const expired: string[] = [];
  for (const [executionId, dispatched] of entry.dispatched) {
    if (dispatched.reported) continue;
    let touched = false;
    for (const key of dispatched.keys) {
      const row = entry.session.applyLedger.find((item) => item.key === key);
      if (row?.status === 'pending') {
        row.status = 'unknown';
        row.error = 'no_report';
        touched = true;
      }
    }
    if (touched) {
      setExecutionState(entry, executionId, 'unknown');
      expired.push(executionId);
    }
  }
  return expired;
}
