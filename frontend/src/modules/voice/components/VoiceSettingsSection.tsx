import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

export function VoiceSettingsSection({
  confirmVoiceCommands,
  speakVoiceReplies,
}: {
  confirmVoiceCommands: boolean;
  speakVoiceReplies: boolean;
}) {
  const { t } = useTranslation();
  const [updateUserSettings] = useUpdateUserSettingsMutation();
  const [confirmEnabled, setConfirmEnabled] = useState(confirmVoiceCommands);
  const [speakEnabled, setSpeakEnabled] = useState(speakVoiceReplies);
  const [busy, setBusy] = useState<'confirm' | 'speak' | null>(null);

  useEffect(() => {
    setConfirmEnabled(confirmVoiceCommands);
  }, [confirmVoiceCommands]);

  useEffect(() => {
    setSpeakEnabled(speakVoiceReplies);
  }, [speakVoiceReplies]);

  const toggleConfirm = async (next: boolean) => {
    setBusy('confirm');
    setConfirmEnabled(next);
    try {
      await updateUserSettings({ confirmVoiceCommands: next }).unwrap();
      showSuccessToast({
        title: next ? t('voice.confirmOn') : t('voice.confirmOff'),
        detail: next ? t('voice.confirmOnDetail') : t('voice.confirmOffDetail'),
      });
    } catch (error) {
      setConfirmEnabled(!next);
      showErrorToast({
        title: t('voice.updateFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(null);
    }
  };

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

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">{t('voice.title')}</h2>
      <p className="mb-4 text-sm text-ide-muted">{t('voice.sectionHint')}</p>
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-ide-text">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={confirmEnabled}
            disabled={busy !== null}
            onChange={(event) => void toggleConfirm(event.target.checked)}
          />
          {t('voice.askBefore')}
        </label>
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
