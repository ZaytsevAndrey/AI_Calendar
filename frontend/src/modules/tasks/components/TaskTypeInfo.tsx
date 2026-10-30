import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import { IconButton } from 'ui/IconButton';
import { Input } from 'ui/Input';
import type { TaskPresetId } from '../task-wizard/constants';

const STORAGE_KEY = 'taskTypeInfo.dismissed';

/** Per-viewer convenience only; a blocked storage just shows the block again. */
export function readDismissedTypes(): TaskPresetId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as TaskPresetId[]) : [];
  } catch {
    return [];
  }
}

function writeDismissedTypes(types: TaskPresetId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  } catch {
    // Storage blocked: the choice lasts until the form closes.
  }
}

type Props = {
  type: TaskPresetId;
  onHide: () => void;
};

/** What the selected tab means and what it changes in placement and sync. */
export function TaskTypeInfo({ type, onHide }: Props) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<TaskPresetId[]>(readDismissedTypes);
  const points = t(`tasks.typeInfo.${type}.points`, { returnObjects: true });

  const toggleDismissed = (checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...dismissed, type]))
      : dismissed.filter((id) => id !== type);
    setDismissed(next);
    writeDismissedTypes(next);
  };

  return (
    <section
      aria-label={t(`tasks.typeInfo.${type}.title`)}
      className="relative rounded-control bg-ide-surface py-3 pl-4 pr-11 text-body-sm leading-snug text-ide-muted"
    >
      <p className="flex items-center gap-1.5 font-medium text-ide-text">
        <Info className="h-3.5 w-3.5 shrink-0 text-ide-link" aria-hidden />
        {t(`tasks.typeInfo.${type}.title`)}
      </p>
      <p className="mt-0.5">{t(`tasks.typeInfo.${type}.body`)}</p>
      {Array.isArray(points) ? (
        <ul className="mt-1 space-y-0.5">
          {(points as string[]).map((point) => (
            <li key={point} className="flex gap-1.5">
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ide-muted" aria-hidden />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <IconButton
        label={t('tasks.typeInfo.hide')}
        size="sm"
        className="absolute right-1 top-1"
        onClick={onHide}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </IconButton>
    </section>
  );
}
