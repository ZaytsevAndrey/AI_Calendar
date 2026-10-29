/**
 * Transactional structured preview preparation.
 * apply → normalize → project. Only the final snapshot is returned.
 * A failed normalize or project keeps the caller's previous state.
 */
import type { VoiceWriteIntent } from '../../voice-agent.types';
import type { ProposalGroup } from '../contracts/proposal';
import type { ApplyItem } from '../apply/apply-preview';
import type { VNextLanguage } from '../copy';
import { normalizeDrafts } from './normalize-drafts';
import { projectApply } from './project-apply';
import { fingerprintsForOperations, withFingerprints } from './revalidate-preview';
import {
  applyProposalGroup,
  type IdAllocator,
  type KnownEntity,
  type StructuredState,
} from './structured-state';

export type PreparedPreview =
  | {
      ok: true;
      state: StructuredState;
      intents: VoiceWriteIntent[];
      items: ApplyItem[];
      preservedLabels: string[];
    }
  | {
      ok: false;
      code: string;
      detail: string;
      state: StructuredState;
    };

export function prepareStructuredPreview(input: {
  state: StructuredState;
  group: ProposalGroup;
  entities: readonly KnownEntity[];
  ids: IdAllocator;
  timeZone: string;
  catalogEntityIds: readonly string[];
  userId: string;
  defaultDurationMinutes?: number;
  defaultReminderTime?: string;
  nowIso?: string;
  wakeHm?: string;
  sleepHm?: string;
  language?: VNextLanguage;
}): PreparedPreview {
  const previous = input.state;
  const applied = applyProposalGroup({
    state: previous,
    group: input.group,
    entities: input.entities,
    ids: input.ids,
    expectedSessionVersion: previous.sessionVersion,
  });
  if (!applied.ok) return { ok: false, code: applied.code, detail: applied.detail, state: previous };
  const normalized = normalizeDrafts(applied.state, input.ids);
  if (!normalized.ok) return { ok: false, code: normalized.code, detail: normalized.detail, state: previous };
  const projected = projectApply({
    state: normalized.state,
    timeZone: input.timeZone,
    catalogEntityIds: input.catalogEntityIds,
    defaultDurationMinutes: input.defaultDurationMinutes,
    defaultReminderTime: input.defaultReminderTime,
    nowIso: input.nowIso,
    wakeHm: input.wakeHm,
    sleepHm: input.sleepHm,
    language: input.language,
    references: input.entities,
  });
  if (!projected.ok) return { ok: false, code: projected.code, detail: projected.detail, state: previous };
  // `entities` is already scoped to the authenticated user (entitiesToKnown), so the owner is that user.
  const fingerprints = fingerprintsForOperations(
    normalized.state.operations,
    input.entities.map((entity) => ({
      entityId: entity.entityId,
      revision: entity.revision,
      calendarId: entity.calendarId,
      writable: entity.writable,
      googleEventId: entity.googleEventId,
      userId: input.userId,
      status: entity.status ?? 'open',
    })),
  );
  // A row an ordering bound was read from is checked at confirm too; it is read, not written.
  for (const operation of normalized.state.operations) {
    for (const constraint of operation.constraints) {
      if (constraint.kind !== 'ordering' || fingerprints[constraint.entityId]) continue;
      const row = input.entities.find((entity) => entity.entityId === constraint.entityId);
      if (!row) continue;
      fingerprints[constraint.entityId] = {
        entityId: row.entityId,
        revision: row.revision,
        calendarId: row.calendarId,
        writable: row.writable,
        googleEventId: row.googleEventId ?? null,
        status: row.status ?? 'open',
        userId: input.userId,
        requiresMoveIdentity: false,
        reference: true,
      };
    }
  }
  return {
    ok: true,
    state: withFingerprints(normalized.state, fingerprints),
    intents: projected.intents,
    items: projected.items,
    preservedLabels: projected.preservedLabels,
  };
}
