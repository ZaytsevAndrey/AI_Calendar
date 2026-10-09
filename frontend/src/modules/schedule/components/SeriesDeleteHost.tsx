import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'ui/Modal';
import {
  registerSeriesDeleteAsker,
  type SeriesDragScope,
} from '../seriesDragChoice';

type PendingAsk = {
  taskName: string;
  resolve: (scope: SeriesDragScope | null) => void;
};

/** Asks whether a series delete removes one day, this+later, or the whole series. */
export function SeriesDeleteHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAsk | null>(null);

  useEffect(() => {
    registerSeriesDeleteAsker(
      (taskName) =>
        new Promise((resolve) => {
          setPending({ taskName, resolve });
        }),
    );
    return () => registerSeriesDeleteAsker(null);
  }, []);

  const choose = (scope: SeriesDragScope | null) => {
    pending?.resolve(scope);
    setPending(null);
  };

  return (
    <Modal
      open={!!pending}
      onClose={() => choose(null)}
      title={t('calendar.seriesDeleteTitle')}
      footer={
        <button type="button" className="ui-btn-secondary w-full sm:w-auto" onClick={() => choose(null)}>
          {t('common.cancel')}
        </button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">
        {t('calendar.seriesDeleteBody', { name: pending?.taskName ?? '' })}
      </p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="ui-btn-secondary w-full justify-center"
          onClick={() => choose('occurrence')}
        >
          {t('calendar.seriesDeleteThisDay')}
        </button>
        <button
          type="button"
          className="ui-btn-secondary w-full justify-center"
          onClick={() => choose('series')}
        >
          {t('calendar.seriesDeleteFollowing')}
        </button>
        <button
          type="button"
          className="ui-btn-danger w-full justify-center"
          onClick={() => choose('all')}
        >
          {t('calendar.seriesDeleteAll')}
        </button>
      </div>
    </Modal>
  );
}
