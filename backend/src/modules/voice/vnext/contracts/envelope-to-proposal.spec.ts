import { envelopeToProposalGroup } from './envelope-to-proposal';
import type { SemanticEnvelopeV1 } from './types';

describe('envelopeToProposalGroup mechanical bridge', () => {
  it('preserves weekday constraints without computing a calendar date', () => {
    const envelope: SemanticEnvelopeV1 = {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'create',
        target: { kind: 'new', localId: 'new-1' },
        changes: { title: 'Review' },
        constraints: [{ kind: 'weekday', weekday: 1, which: 'next' }, { kind: 'clock', value: '10:00', role: 'start' }],
        dependsOn: [],
        source: { text: 'next Monday at 10' },
      }],
    };
    const group = envelopeToProposalGroup(envelope, { nowIso: '2026-10-18T10:00:00.000Z', timeZone: 'Europe/Kyiv' });
    expect(group).not.toBeNull();
    expect(group!.proposals[0].constraints.some((constraint) => constraint.kind === 'weekday' && constraint.weekday === 1)).toBe(true);
    expect(group!.proposals[0].constraints.some((constraint) => constraint.kind === 'date')).toBe(false);
  });

  it('carries scope:all and description without expanding targets', () => {
    const envelope: SemanticEnvelopeV1 = {
      version: '1',
      kind: 'operations',
      operations: [{
        opId: 'op-1',
        action: 'delete',
        scope: 'all',
        target: { kind: 'existing', description: 'Нарада', calendarId: 'work' },
        changes: {},
        constraints: [],
        dependsOn: [],
        source: { text: 'all' },
      }],
    };
    const group = envelopeToProposalGroup(envelope);
    expect(group!.proposals).toHaveLength(1);
    expect(group!.proposals[0].scope).toBe('all');
    expect(group!.proposals[0].scopeDescription).toBe('Нарада');
    expect(group!.proposals[0].calendarId).toBe('work');
    expect(group!.proposals[0].target.kind).toBe('unresolved');
  });
});
