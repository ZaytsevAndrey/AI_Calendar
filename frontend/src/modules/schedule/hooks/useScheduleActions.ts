import { useEffect, useState } from 'react';
import { ScheduleApi } from 'api/schedule.api';
import {
  parkDayHintsFromJobResult,
  type ParkDayHint,
} from 'modules/schedule/parkDayHints';

/**
 * Calendar helpers that remain after Generate / Clear / Undo were removed.
 * Park-day hints still come from the last completed job result when present.
 */
export function useScheduleActions() {
  const [parkDayHints, setParkDayHints] = useState<Record<string, ParkDayHint>>({});

  useEffect(() => {
    let cancelled = false;
    ScheduleApi.getLatestDoneJob()
      .then(({ job }) => {
        if (cancelled || !job) return;
        const result = job.result;
        setParkDayHints(
          parkDayHintsFromJobResult(
            result && typeof result === 'object'
              ? (result as Parameters<typeof parkDayHintsFromJobResult>[0])
              : null,
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setParkDayHints({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { parkDayHints };
}
