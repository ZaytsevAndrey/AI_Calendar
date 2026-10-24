import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, CalendarRange, Layers, X } from 'lucide-react';
import { Modal } from 'ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import {
  registerSeriesDragAsker,
  type SeriesDragScope,
} from '../seriesDragChoice';

type PendingAsk = {
  taskName: string;
  resolve: (scope: SeriesDragScope | null) => void;
};

/** Asks whether a series drag moves one day, this+later, or every open day. */
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
        <Button type="button" variant="secondary" size={dialogButtonSize} className="w-full sm:w-auto" onClick={() => choose(null)} icon={X}>
          {t('common.cancel')}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-ide-muted">
        {t('calendar.seriesDragBody', { name: pending?.taskName ?? '' })}
      </p>
      <div className="flex flex-col gap-2">
        <Button type="button" variant="secondary" className="w-full" onClick={() => choose('occurrence')} icon={Calendar}>
          {t('calendar.seriesDragThisDay')}
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={() => choose('series')} icon={CalendarRange}>
          {t('calendar.seriesDragFollowing')}
        </Button>
        <Button type="button" className="w-full" onClick={() => choose('all')} icon={Layers}>
          {t('calendar.seriesDragAll')}
        </Button>
      </div>
    </Modal>
  );
}
