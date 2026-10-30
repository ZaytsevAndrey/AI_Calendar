import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserSettingsDTO } from 'api/user-settings.api';
import { Input } from 'ui/Input';
import { SettingRow, SettingsGroup } from './SettingsUi';
import { useAutosave } from './useAutosave';

const TYPING_MS = 700;

function NumberField({
    id,
    value,
    min,
    max,
    unit,
    onChange,
    label,
}: {
    id: string;
    value: number;
    min: number;
    max: number;
    unit: string;
    onChange: (next: number) => void;
    label?: string;
}) {
    const [text, setText] = useState(String(value));
    return (
        <span className="inline-flex items-center gap-2">
            <Input
                id={id}
                type="number"
                inputMode="numeric"
                min={min}
                max={max}
                aria-label={label}
                className="w-24 tabular-nums"
                value={text}
                onChange={(e) => {
                    setText(e.target.value);
                    const n = parseInt(e.target.value, 10);
                    if (!Number.isNaN(n) && n >= min && n <= max) onChange(n);
                }}
                onBlur={() => {
                    const n = parseInt(text, 10);
                    if (Number.isNaN(n) || n < min || n > max) setText(String(value));
                }}
            />
            <span className="text-body-sm text-ide-muted">{unit}</span>
        </span>
    );
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

export function PlanningSection({ settings }: { settings: UserSettingsDTO }) {
    const { t } = useTranslation();
    const { save, status } = useAutosave();
    const [minSplit, setMinSplit] = useState(numberOr(settings.minSplitMinutes, 30));
    const [maxSplit, setMaxSplit] = useState(numberOr(settings.maxSplitMinutes, 30));
    const min = t('settings.unitMinutes');

    return (
        <SettingsGroup>
            <SettingRow
                label={t('settings.defaultTaskDuration')}
                htmlFor="default-task-duration-minutes"
                hint={t('settings.defaultTaskDurationHint')}
                status={status('duration')}
            >
                <NumberField
                    id="default-task-duration-minutes"
                    value={numberOr(settings.defaultTaskDurationMinutes, 30)}
                    min={5}
                    max={480}
                    unit={min}
                    onChange={(n) => void save('duration', { defaultTaskDurationMinutes: n }, TYPING_MS)}
                />
            </SettingRow>
            <SettingRow label={t('settings.split')} hint={t('settings.splitHint')} status={status('split')} stack>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="inline-flex items-center gap-2">
                        <label htmlFor="min-split-minutes" className="text-body-sm text-ide-muted">
                            {t('settings.minSplit')}
                        </label>
                        <NumberField
                            id="min-split-minutes"
                            value={minSplit}
                            min={5}
                            max={240}
                            unit={min}
                            onChange={(n) => {
                                setMinSplit(n);
                                const nextMax = Math.max(n, maxSplit);
                                setMaxSplit(nextMax);
                                void save('split', { minSplitMinutes: n, maxSplitMinutes: nextMax }, TYPING_MS);
                            }}
                        />
                    </span>
                    <span className="inline-flex items-center gap-2">
                        <label htmlFor="max-split-minutes" className="text-body-sm text-ide-muted">
                            {t('settings.maxSplit')}
                        </label>
                        <NumberField
                            key={maxSplit < minSplit ? minSplit : 'max'}
                            id="max-split-minutes"
                            value={maxSplit}
                            min={5}
                            max={480}
                            unit={min}
                            onChange={(n) => {
                                const next = Math.max(minSplit, n);
                                setMaxSplit(next);
                                void save('split', { minSplitMinutes: minSplit, maxSplitMinutes: next }, TYPING_MS);
                            }}
                        />
                    </span>
                </span>
            </SettingRow>
            <SettingRow
                label={t('settings.buffer')}
                htmlFor="fixed-event-buffer-minutes"
                hint={t('settings.bufferHint')}
                status={status('buffer')}
            >
                <NumberField
                    id="fixed-event-buffer-minutes"
                    value={numberOr(settings.fixedEventBufferMinutes, 0)}
                    min={0}
                    max={180}
                    unit={min}
                    onChange={(n) => void save('buffer', { fixedEventBufferMinutes: n }, TYPING_MS)}
                />
            </SettingRow>
            <SettingRow
                label={t('settings.horizon')}
                htmlFor="recurring-horizon-days"
                hint={t('settings.horizonHint')}
                status={status('horizon')}
            >
                <NumberField
                    id="recurring-horizon-days"
                    value={numberOr(settings.recurringScheduleHorizonDays, 30)}
                    min={1}
                    max={365}
                    unit={t('settings.unitDays')}
                    onChange={(n) => void save('horizon', { recurringScheduleHorizonDays: n }, TYPING_MS)}
                />
            </SettingRow>
        </SettingsGroup>
    );
}
