import React from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  count: number;
  onOpen: () => void;
};

export function UnscheduledInboxBanner({ count, onOpen }: Props) {
  const { t } = useTranslation();
  if (count <= 0) return null;

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ide-link/40 bg-ide-link/10 px-4 py-3 max-md:my-1"
      aria-label={t('schedule.unscheduledAria')}
    >
      <p className="text-sm font-medium text-ide-text">
        {t('schedule.unscheduledChip', { count })}
      </p>
      <button
        type="button"
        className="ui-btn-secondary shrink-0 px-3 py-1.5 text-sm"
        onClick={onOpen}
      >
        {t('schedule.unscheduledReview')}
      </button>
    </section>
  );
}
