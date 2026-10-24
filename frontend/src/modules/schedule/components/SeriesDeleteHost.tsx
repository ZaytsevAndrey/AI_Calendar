import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, CalendarRange, Trash2, X } from 'lucide-react';
import { Modal } from 'ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
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
        <Button type="button" variant="secondary" size={dialogButtonSize} className="w-full sm:w-auto" onClick={() => choose(null)} icon={X}>
          {t('common.cancel')}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">
        {t('calendar.seriesDeleteBody', { name: pending?.taskName ?? '' })}
      </p>
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => choose('occurrence')}
          icon={Calendar}
        >
          {t('calendar.seriesDeleteThisDay')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={() => choose('series')}
          icon={CalendarRange}
        >
          {t('calendar.seriesDeleteFollowing')}
        </Button>
        <Button
          type="button"
          variant="danger"
          className="w-full"
          onClick={() => choose('all')}
          icon={Trash2}
        >
          {t('calendar.seriesDeleteAll')}
        </Button>
      </div>
    </Modal>
  );
}
