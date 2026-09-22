import { ScheduleDiffItem, ScheduleJobResultPayload } from '../../api/schedule.api';
import { formatDateTimeRange } from '../../utils/formatDate';

function blockCount(n: number): string {
  return `${n} block${n === 1 ? '' : 's'}`;
}

export function describeScheduleMove(item: ScheduleDiffItem): string {
  const before = item.before.length;
  const after = item.after.length;
  if (before === 0 && after > 0) {
    const when = formatDateTimeRange(item.after[0].start, item.after[0].end);
    const extra = after > 1 ? ` · ${blockCount(after)}` : '';
    return when ? `Will place ${when}${extra}` : `Will place ${blockCount(after)}`;
  }
  if (after === 0) {
    return 'Will remove open blocks';
  }
  const when = formatDateTimeRange(item.after[0].start, item.after[0].end);
  const counts = `${blockCount(before)} → ${blockCount(after)}`;
  return when ? `${counts}, first ${when}` : counts;
}

function uniqueMessages(messages: Array<string | undefined>): string[] {
  return [...new Set(messages.filter((msg): msg is string => Boolean(msg)))];
}

export function previewMessages(result: ScheduleJobResultPayload): {
  errors: string[];
  warnings: string[];
} {
  return {
    errors: uniqueMessages(result.errors.map((item) => item.message)),
    warnings: uniqueMessages(result.warnings.map((item) => item.message)),
  };
}
