import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import { isAppLanguage, type AppLanguage } from 'i18n';

export function VoiceSettingsSection({
  speakVoiceReplies,
  speechLanguage,
}: {
  speakVoiceReplies: boolean;
  speechLanguage: AppLanguage;
}) {
  const { t } = useTranslation();
  const [updateUserSettings] = useUpdateUserSettingsMutation();
  const [speakEnabled, setSpeakEnabled] = useState(speakVoiceReplies);
  const [voiceLang, setVoiceLang] = useState<AppLanguage>(speechLanguage);
  const [busy, setBusy] = useState<'speak' | 'language' | null>(null);

  useEffect(() => {
    setSpeakEnabled(speakVoiceReplies);
  }, [speakVoiceReplies]);

  useEffect(() => {
    if (isAppLanguage(speechLanguage)) setVoiceLang(speechLanguage);
  }, [speechLanguage]);

  const toggleSpeak = async (next: boolean) => {
    setBusy('speak');
    setSpeakEnabled(next);
    try {
      await updateUserSettings({ speakVoiceReplies: next }).unwrap();
      showSuccessToast({
        title: next ? t('voice.speakOn') : t('voice.speakOff'),
        detail: next ? t('voice.speakOnDetail') : t('voice.speakOffDetail'),
      });
    } catch (error) {
      setSpeakEnabled(!next);
      showErrorToast({
        title: t('voice.updateFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const changeSpeechLanguage = async (next: AppLanguage) => {
    if (!isAppLanguage(next) || next === voiceLang) return;
    const previous = voiceLang;
    setBusy('language');
    setVoiceLang(next);
    try {
      await updateUserSettings({ speechLanguage: next }).unwrap();
      showSuccessToast({
        title: t('voice.languageSaved'),
        detail: t('voice.languageSavedDetail'),
      });
    } catch (error) {
      setVoiceLang(previous);
      showErrorToast({
        title: t('voice.updateFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">{t('voice.title')}</h2>
      <p className="mb-4 text-sm text-ide-muted">{t('voice.sectionHint')}</p>
      <div className="space-y-4">
        <div>
          <label htmlFor="voice-language" className="ui-label">
            {t('voice.communicationLanguage')}
          </label>
          <select
            id="voice-language"
            className="ui-input mt-1 max-w-xs"
            value={voiceLang}
            disabled={busy !== null}
            onChange={(event) => void changeSpeechLanguage(event.target.value as AppLanguage)}
          >
            {(['en', 'uk'] as const).map((code) => (
              <option key={code} value={code}>
                {code === 'en' ? t('settings.languageEn') : t('settings.languageUk')}
              </option>
            ))}
          </select>
          <p className="mt-1 max-w-md text-xs text-ide-muted">{t('voice.communicationLanguageHint')}</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-ide-text">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={speakEnabled}
            disabled={busy !== null}
            onChange={(event) => void toggleSpeak(event.target.checked)}
          />
          {t('voice.speakReplies')}
        </label>
      </div>
    </section>
  );
}
