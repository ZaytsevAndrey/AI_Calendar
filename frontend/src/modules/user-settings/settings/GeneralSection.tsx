import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserSettingsDTO } from 'api/user-settings.api';
import { Select } from 'ui/Select';
import { Segmented } from 'ui/Segmented';
import { useTheme } from 'theme/ThemeProvider';
import type { ThemePreference } from 'theme/themeColors';
import { APP_LANGUAGES, isAppLanguage, writeStoredLanguage, type AppLanguage } from 'i18n';
import { timeZoneSelectOptions } from '../ianaTimeZones';
import { SettingRow, SettingsGroup } from './SettingsUi';
import { useAutosave } from './useAutosave';
import { useIsPhone } from 'ui/useViewport';

export function GeneralSection({ settings }: { settings: UserSettingsDTO }) {
    const { t, i18n } = useTranslation();
    const { preference, setPreference } = useTheme();
    const { save, status } = useAutosave();
    const phone = useIsPhone();
    const [language, setLanguage] = useState<AppLanguage>(
        isAppLanguage(settings.language) ? settings.language : isAppLanguage(i18n.language) ? i18n.language : 'en',
    );
    const [timeZone, setTimeZone] = useState(settings.timeZone?.trim() || '');

    useEffect(() => {
        const next = settings.timeZone?.trim();
        if (next) setTimeZone(next);
    }, [settings.timeZone]);

    const changeLanguage = (next: AppLanguage) => {
        setLanguage(next);
        writeStoredLanguage(next);
        void i18n.changeLanguage(next);
        void save('language', { language: next });
    };

    return (
        <SettingsGroup>
            <SettingRow label={t('settings.language')} hint={t('settings.languageHint')} status={status('language')} stack={phone}>
                <Segmented
                    className={phone ? 'w-full' : undefined}
                    label={t('settings.language')}
                    value={language}
                    onChange={changeLanguage}
                    options={APP_LANGUAGES.map((code) => ({
                        value: code,
                        label: code === 'en' ? 'English' : 'Українська',
                    }))}
                />
            </SettingRow>
            <SettingRow label={t('settings.theme')} hint={t('settings.themeHint')} stack={phone}>
                <Segmented<ThemePreference>
                    className={phone ? 'w-full' : undefined}
                    label={t('settings.theme')}
                    value={preference}
                    onChange={setPreference}
                    options={[
                        { value: 'system', label: t('settings.themeSystem') },
                        { value: 'light', label: t('settings.themeLight') },
                        { value: 'dark', label: t('settings.themeDark') },
                    ]}
                />
            </SettingRow>
            <SettingRow label={t('settings.timeZone')} htmlFor="time-zone" status={status('timeZone')} stack={phone}>
                <Select
                    id="time-zone"
                    className="md:w-72"
                    value={timeZone}
                    onChange={(e) => {
                        setTimeZone(e.target.value);
                        if (e.target.value) void save('timeZone', { timeZone: e.target.value });
                    }}
                >
                    {!timeZone ? (
                        <option value="" disabled>
                            {t('settings.detecting')}
                        </option>
                    ) : null}
                    {timeZoneSelectOptions(timeZone).map((zone) => (
                        <option key={zone} value={zone}>
                            {zone}
                        </option>
                    ))}
                </Select>
            </SettingRow>
        </SettingsGroup>
    );
}
