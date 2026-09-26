import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from '../../../api/userSettingsApi';
import {
  detectBrowserLanguage,
  isAppLanguage,
  writeStoredLanguage,
  type AppLanguage,
} from '../../../i18n';

/** Keep i18n + Accept-Language in sync with settings; seed language once if missing. */
export function useSyncAppLanguage(enabled: boolean): void {
  const { i18n } = useTranslation();
  const { data: settings } = useGetUserSettingsQuery(undefined, { skip: !enabled });
  const [updateSettings] = useUpdateUserSettingsMutation();

  useEffect(() => {
    if (!enabled || !settings) return;

    if (isAppLanguage(settings.language)) {
      writeStoredLanguage(settings.language);
      if (i18n.language !== settings.language) {
        void i18n.changeLanguage(settings.language);
      }
      return;
    }

    const guessed: AppLanguage = detectBrowserLanguage();
    writeStoredLanguage(guessed);
    void i18n.changeLanguage(guessed);
    void updateSettings({ language: guessed });
  }, [enabled, settings, i18n, updateSettings]);
}
