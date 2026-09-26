import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScheduleRecommendationKind,
  ScheduleRecommendations,
  ScheduleApi,
} from 'api/schedule.api';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

const KIND_KEY: Record<ScheduleRecommendationKind, string> = {
  overload: 'schedule.kindOverload',
  gap: 'schedule.kindGap',
  phase_mismatch: 'schedule.kindPhaseMismatch',
  deadline_risk: 'schedule.kindDeadlineRisk',
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ScheduleSuggestionsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScheduleRecommendations | null>(null);
  const request = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = request.current + 1;
    request.current = id;
    setLoading(true);
    setError(null);
    setResult(null);
    void ScheduleApi.recommendSchedule()
      .then((data) => {
        if (request.current !== id) return;
        setResult(data);
      })
      .catch((err) => {
        if (request.current !== id) return;
        setError(extractApiErrorMessage(err));
      })
      .finally(() => {
        if (request.current !== id) return;
        setLoading(false);
      });
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('schedule.suggestions')}
      footer={
        <button type="button" onClick={onClose} className="ui-btn-secondary w-full sm:w-auto">
          {t('common.close')}
        </button>
      }
    >
      <p className="mb-3 text-sm text-ide-muted">{t('schedule.suggestionsIntro')}</p>
      {loading ? (
        <div className="flex items-center gap-3 text-sm text-ide-muted">
          <Spinner className="h-4 w-4" />
          {t('schedule.reviewing')}
        </div>
      ) : null}
      {error ? <p className="text-sm text-ide-error">{error}</p> : null}
      {result ? (
        <div className="space-y-3">
          <p className="text-sm text-ide-text">{result.summary}</p>
          {result.suggestions.length > 0 ? (
            <ul className="space-y-3">
              {result.suggestions.map((item, index) => (
                <li key={`${item.kind}-${index}`} className="text-sm text-ide-text">
                  <span className="font-medium">
                    {KIND_KEY[item.kind] ? t(KIND_KEY[item.kind]) : item.kind}
                  </span>
                  <span className="text-ide-muted"> · {item.title}</span>
                  <span className="mt-0.5 block text-ide-muted">{item.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
