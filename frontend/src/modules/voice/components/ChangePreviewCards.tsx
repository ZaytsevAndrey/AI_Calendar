import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildChangePreviewCards,
  changePreviewKindLabelKey,
  changePreviewScopeLabelKey,
  formatPreviewWhen,
  type ChangePreviewCard,
} from '../changePreviewCards';
import type {
  DayPlanProposal,
  VoiceIntentExecutionStatus,
  VoiceWriteIntent,
} from 'api/voice.api';

type ChangePreviewCardsProps = {
  intents?: VoiceWriteIntent[] | null;
  plan?: DayPlanProposal | null;
  statuses?: VoiceIntentExecutionStatus[] | null;
  timeZone: string;
  title?: string;
};

const STATUS_CLASS: Record<VoiceIntentExecutionStatus, string> = {
  applied: 'text-ide-accent',
  skipped: 'text-ide-muted',
  conflict: 'text-ide-warn',
  error: 'text-ide-error',
};

function formatTimeRange(card: ChangePreviewCard, timeZone: string, unscheduledLabel: string): string {
  return formatPreviewWhen(card, timeZone, unscheduledLabel);
}

export function ChangePreviewCards({
  intents,
  plan,
  statuses,
  timeZone,
  title,
}: ChangePreviewCardsProps) {
  const { t } = useTranslation();
  const cards = buildChangePreviewCards({ intents, plan, statuses });
  const unplaced = plan?.unplaced ?? [];
  const interview = plan?.stage === 'interview';
  if (!cards.length && !unplaced.length && !interview) return null;

  return (
    <div className="space-y-2" data-testid="change-preview">
      <p className="text-xs font-medium text-ide-muted">
        {title ||
          (plan?.day
            ? t(interview ? 'voice.dayPlanInterviewTitle' : 'voice.dayPlanTitle', {
                day: plan.day,
              })
            : t('voice.previewTitle'))}
      </p>
      {cards.length ? (
        <ul className="max-h-48 space-y-2 overflow-y-auto pr-0.5">
          {cards.map((card) => (
            <li
              key={card.id}
              data-changed={card.changed ? 'true' : undefined}
              className={`rounded-xl border bg-ide-surface px-3 py-2 ${
                card.changed ? 'border-ide-accentBlue' : 'border-ide-border'
              }`}
              style={{ borderLeftWidth: 4, borderLeftColor: card.color }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate font-medium text-ide-text">{card.name}</p>
                <span className="flex shrink-0 items-center gap-1">
                  {card.changed ? (
                    <span className="rounded-md bg-ide-accentBlue/15 px-1.5 py-0.5 text-caption font-medium text-ide-accentBlue">
                      {t('voice.previewChanged')}
                    </span>
                  ) : null}
                  <span className="rounded-md bg-ide-bg px-1.5 py-0.5 text-caption font-medium text-ide-muted">
                    {t(changePreviewKindLabelKey(card.kind))}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ide-muted">
                {card.taskType || card.repeats ? (
                  <span>
                    {[
                      card.taskType ? t(`tasks.preset.${card.taskType}`) : null,
                      card.repeats ? t('tasks.preset.recurring') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                ) : null}
                {card.scope ? (
                  <span className="font-medium text-ide-text" data-testid="preview-scope">
                    {t(changePreviewScopeLabelKey(card.scope))}
                  </span>
                ) : null}
                <span>{formatTimeRange(card, timeZone, t('voice.previewUnscheduled'))}</span>
                {card.durationMinutes != null ? (
                  <span>{t('voice.previewDuration', { count: card.durationMinutes })}</span>
                ) : null}
                {card.status ? (
                  <span className={`font-medium ${STATUS_CLASS[card.status]}`}>
                    {t(`voice.status.${card.status}`)}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {unplaced.length ? (
        <div className="rounded-xl border border-dashed border-ide-border px-3 py-2 text-xs">
          <p className="font-medium text-ide-muted">{t('voice.planUnplacedTitle')}</p>
          <ul className="mt-1 space-y-0.5">
            {unplaced.map((row) => (
              <li key={row.itemId} className="flex justify-between gap-2 text-ide-text">
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 text-ide-muted">
                  {t(`voice.unplacedReason.${row.reason}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
