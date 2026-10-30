import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';
import { isAppLanguage, type AppLanguage } from 'i18n';
import { Segmented } from 'ui/Segmented';
import { Switch } from 'ui/Switch';
import { SettingRow, SettingsGroup } from 'modules/user-settings/settings/SettingsUi';

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
    <SettingsGroup>
      <SettingRow
        label={t('voice.communicationLanguage')}
        hint={t('voice.communicationLanguageHint')}
        stack
      >
        <Segmented<AppLanguage>
          label={t('voice.communicationLanguage')}
          value={voiceLang}
          onChange={(next) => void changeSpeechLanguage(next)}
          options={[
            { value: 'uk', label: 'Українська' },
            { value: 'en', label: 'English' },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('voice.speakReplies')} htmlFor="voice-speak" hint={t('voice.sectionHint')}>
        <Switch
          id="voice-speak"
          label={t('voice.speakReplies')}
          checked={speakEnabled}
          disabled={busy !== null}
          onChange={(next) => void toggleSpeak(next)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
