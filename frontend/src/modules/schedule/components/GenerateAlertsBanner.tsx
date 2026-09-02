import React from 'react';
import { SchedulingAlerts } from 'api/schedule.api';

type Props = {
  alerts: SchedulingAlerts;
  onDismiss: () => void;
};

export function GenerateAlertsBanner({ alerts, onDismiss }: Props) {
  if (alerts.issueCount <= 0) return null;

  return (
    <section
      className="rounded-xl border border-ide-border bg-ide-panel p-4"
      aria-label="Last generate notes"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-ide-text">Last generate</h2>
        <button type="button" className="ui-btn-ghost shrink-0 text-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
      {alerts.errors.length > 0 ? (
        <ul className="mb-2 list-inside list-disc text-sm text-ide-error">
          {alerts.errors.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      ) : null}
      {alerts.warnings.length > 0 ? (
        <ul className="list-inside list-disc text-sm text-ide-warn">
          {alerts.warnings.map((msg) => (
            <li key={msg}>{msg}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
