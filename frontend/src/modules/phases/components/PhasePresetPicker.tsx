import React from 'react';
import clsx from 'clsx';
import type { PhasePresetId } from 'api/phasesApi';

export type PhasePresetChoice = PhasePresetId | 'defaults';

const LIFESTYLE_OPTIONS: {
  id: PhasePresetId;
  title: string;
  detail: string;
}[] = [
  {
    id: 'working',
    title: 'Working person',
    detail: 'Deep work, meetings, then life admin before sleep.',
  },
  {
    id: 'student',
    title: 'Student / learner',
    detail: 'Classes, study, then free time before sleep.',
  },
  {
    id: 'open',
    title: 'Open day',
    detail: 'Morning focus, errands, personal projects, and wind down.',
  },
];

type PhasePresetPickerProps = {
  value: PhasePresetChoice | null;
  onChange: (value: PhasePresetChoice) => void;
  includeDefaults?: boolean;
  disabled?: boolean;
};

export function PhasePresetPicker({
  value,
  onChange,
  includeDefaults = false,
  disabled = false,
}: PhasePresetPickerProps) {
  const options: { id: PhasePresetChoice; title: string; detail: string }[] = [
    ...(includeDefaults
      ? [
          {
            id: 'defaults' as const,
            title: 'Sleep and focus only',
            detail: 'The usual setup: sleep overnight and a hidden focus window.',
          },
        ]
      : []),
    ...LIFESTYLE_OPTIONS,
  ];

  return (
    <div role="radiogroup" aria-label="Phase preset" className="space-y-2">
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={clsx(
              'w-full rounded-lg border px-3 py-2.5 text-left transition',
              selected
                ? 'border-ide-accentBlue bg-ide-accentBlue/10'
                : 'border-ide-border hover:border-ide-accentBlue/60',
            )}
          >
            <span className="block text-sm font-medium text-ide-text">{option.title}</span>
            <span className="mt-0.5 block text-xs text-ide-muted">{option.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

export function messageFromApiError(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as {
    data?: { message?: unknown };
    response?: { data?: { message?: unknown } };
  };
  const message = record.response?.data?.message ?? record.data?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join(' ');
  }
  return undefined;
}
