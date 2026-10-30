import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserSettingsDTO } from 'api/user-settings.api';
import { TimeField } from 'ui/TimeField';
import { ReminderSettingsSection } from 'modules/pwa/ReminderSettingsSection';
import { SettingRow } from './SettingsUi';
import { useAutosave } from './useAutosave';

export function NotificationsSection({ settings }: { settings: UserSettingsDTO }) {
    const { t } = useTranslation();
    const { save, status } = useAutosave();
    const [time, setTime] = useState(settings.defaultReminderTime || '09:00');
    return (
        <ReminderSettingsSection remindersEnabled={!!settings.remindersEnabled}>
            <SettingRow
                label={t('settings.defaultReminderTime')}
                htmlFor="default-reminder-time"
                hint={t('settings.defaultReminderTimeHint')}
                status={status('time')}
            >
                <TimeField
                    id="default-reminder-time"
                    className="w-28 md:w-32"
                    value={time}
                    aria-label={t('settings.defaultReminderTime')}
                    onChange={(next) => {
                        const value = next || '09:00';
                        setTime(value);
                        void save('time', { defaultReminderTime: value });
                    }}
                />
            </SettingRow>
        </ReminderSettingsSection>
    );
}
