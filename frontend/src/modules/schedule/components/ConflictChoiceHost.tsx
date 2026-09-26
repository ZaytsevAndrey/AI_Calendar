import React, { useEffect, useState } from 'react';
import {
  setConflictChoiceListener,
  type SchedulingConflictDTO,
} from '../conflictChoiceBus';
import { ConflictOptionsSheet } from './ConflictOptionsSheet';

/**
 * Global host for the shared conflict choice sheet (form create, Generate;
 * Voice/drag call openConflictChoice on the same bus later).
 */
export function ConflictChoiceHost() {
  const [queue, setQueue] = useState<SchedulingConflictDTO[]>([]);

  useEffect(() => {
    setConflictChoiceListener((incoming) => {
      setQueue((prev) => {
        const seen = new Set(prev.map((c) => c.taskId));
        const next = [...prev];
        for (const c of incoming) {
          if (!seen.has(c.taskId)) {
            seen.add(c.taskId);
            next.push(c);
          }
        }
        return next;
      });
    });
    return () => setConflictChoiceListener(null);
  }, []);

  const current = queue[0] ?? null;

  return (
    <ConflictOptionsSheet
      conflict={current}
      onClose={() => {
        setQueue((prev) => prev.slice(1));
      }}
    />
  );
}
