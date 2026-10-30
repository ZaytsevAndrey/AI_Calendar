import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserSettingsDTO } from 'api/user-settings.api';
import { TimeField } from 'ui/TimeField';
import { PhasesEditor } from 'modules/phases/components/PhasesEditor';
import { SettingRow, SettingsGroup } from './SettingsUi';
import { useAutosave } from './useAutosave';

export function DaySection({ settings }: { settings: UserSettingsDTO }) {
    const { t } = useTranslation();
    const { save, status } = useAutosave();
    const [wake, setWake] = useState(settings.wakeTime || '07:00');
    const [sleep, setSleep] = useState(settings.sleepTime || '22:00');

    return (
        <div className="space-y-4">
            <SettingsGroup hint={t('settings.wakeSleepHint')} title={t('settings.sleepSchedule')}>
                <SettingRow label={t('settings.wakeTime')} htmlFor="wake-time" status={status('wake')}>
                    <TimeField
                        id="wake-time"
                        className="w-28 md:w-32"
                        value={wake}
                        minuteStep={15}
                        aria-label={t('settings.wakeTime')}
                        onChange={(next) => {
                            if (!next) return;
                            setWake(next);
                            void save('wake', { wakeTime: next, sleepTime: sleep });
                        }}
                    />
                </SettingRow>
                <SettingRow label={t('settings.sleepTime')} htmlFor="sleep-time" status={status('sleep')}>
                    <TimeField
                        id="sleep-time"
                        className="w-28 md:w-32"
                        value={sleep}
                        minuteStep={15}
                        aria-label={t('settings.sleepTime')}
                        onChange={(next) => {
                            if (!next) return;
                            setSleep(next);
                            void save('sleep', { wakeTime: wake, sleepTime: next });
                        }}
                    />
                </SettingRow>
            </SettingsGroup>
            <PhasesEditor />
        </div>
    );
}
