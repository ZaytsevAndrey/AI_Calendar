import { ScheduleDiffItem, ScheduleJobResultPayload } from '../../api/schedule.api';
import { formatDateTimeRange } from '../../utils/formatDate';
import i18n from 'i18n';

function blockCount(n: number): string {
  return i18n.t('schedule.block', { count: n });
}

export function describeScheduleMove(item: ScheduleDiffItem): string {
  const before = item.before.length;
  const after = item.after.length;
  if (before === 0 && after > 0) {
    const when = formatDateTimeRange(item.after[0].start, item.after[0].end);
    const blocks = blockCount(after);
    if (when && after > 1) {
      return i18n.t('schedule.willPlaceWhenExtra', { when, blocks });
    }
    if (when) return i18n.t('schedule.willPlaceWhen', { when });
    return i18n.t('schedule.willPlaceBlocks', { blocks });
  }
  if (after === 0) {
    return i18n.t('schedule.willRemoveOpenBlocks');
  }
  const when = formatDateTimeRange(item.after[0].start, item.after[0].end);
  const beforeLabel = blockCount(before);
  const afterLabel = blockCount(after);
  return when
    ? i18n.t('schedule.blocksChangeFirst', { before: beforeLabel, after: afterLabel, when })
    : i18n.t('schedule.blocksChange', { before: beforeLabel, after: afterLabel });
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
