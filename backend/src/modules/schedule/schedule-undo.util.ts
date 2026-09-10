import type {
  SegmentSnapshot,
  TaskScheduleSnapshot,
} from './intelligent-scheduling.engine';

export type UndoSnapshot = {
  version: 1;
  tasks: TaskScheduleSnapshot[];
  segments: SegmentSnapshot[];
};

export function isGenerateJobPayload(payloadJson: string | null): boolean {
  if (!payloadJson) return false;
  try {
    const payload = JSON.parse(payloadJson) as { type?: string };
    return payload.type === 'generate';
  } catch {
    return false;
  }
}

export function parseUndoSnapshot(json: string | null): UndoSnapshot | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as Partial<UndoSnapshot>;
    if (!Array.isArray(raw.tasks) || !Array.isArray(raw.segments)) return null;
    return {
      version: 1,
      tasks: raw.tasks,
      segments: raw.segments,
    };
  } catch {
    return null;
  }
}
