import React from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  count: number;
  onOpen: () => void;
};

export function ProblematicInboxBanner({ count, onOpen }: Props) {
  const { t } = useTranslation();
  if (count <= 0) return null;

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ide-warn/40 bg-ide-warn/10 px-4 py-3"
      aria-label={t('schedule.problematicAria')}
    >
      <p className="text-sm text-ide-text">
        {t('schedule.problematicChip', { count })}
      </p>
      <button type="button" className="ui-btn-secondary shrink-0 text-sm" onClick={onOpen}>
        {t('schedule.problematicReview')}
      </button>
    </section>
  );
}
