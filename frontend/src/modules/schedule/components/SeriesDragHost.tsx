import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from 'ui/Modal';
import {
  registerSeriesDragAsker,
  type SeriesDragScope,
} from '../seriesDragChoice';

type PendingAsk = {
  taskName: string;
  resolve: (scope: SeriesDragScope | null) => void;
};

/** Asks whether a series drag moves one day or this day and every later day. */
export function SeriesDragHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingAsk | null>(null);

  useEffect(() => {
    registerSeriesDragAsker(
      (taskName) =>
        new Promise((resolve) => {
          setPending({ taskName, resolve });
        }),
    );
    return () => registerSeriesDragAsker(null);
  }, []);

  const choose = (scope: SeriesDragScope | null) => {
    pending?.resolve(scope);
    setPending(null);
  };

  return (
    <Modal
      open={!!pending}
      onClose={() => choose(null)}
      title={t('calendar.seriesDragTitle')}
      footer={
        <>
          <button type="button" className="ui-btn-secondary" onClick={() => choose(null)}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ui-btn-secondary" onClick={() => choose('occurrence')}>
            {t('calendar.seriesDragThisDay')}
          </button>
          <button type="button" className="ui-btn-primary" onClick={() => choose('series')}>
            {t('calendar.seriesDragFollowing')}
          </button>
        </>
      }
    >
      <p>{t('calendar.seriesDragBody', { name: pending?.taskName ?? '' })}</p>
    </Modal>
  );
}
