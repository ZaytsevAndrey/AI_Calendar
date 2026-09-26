import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

export function VoiceSettingsSection({
  confirmVoiceCommands,
}: {
  confirmVoiceCommands: boolean;
}) {
  const { t } = useTranslation();
  const [updateUserSettings] = useUpdateUserSettingsMutation();
  const [enabled, setEnabled] = useState(confirmVoiceCommands);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(confirmVoiceCommands);
  }, [confirmVoiceCommands]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setEnabled(next);
    try {
      await updateUserSettings({ confirmVoiceCommands: next }).unwrap();
      showSuccessToast({
        title: next ? t('voice.confirmOn') : t('voice.confirmOff'),
        detail: next ? t('voice.confirmOnDetail') : t('voice.confirmOffDetail'),
      });
    } catch (error) {
      setEnabled(!next);
      showErrorToast({
        title: t('voice.updateFailed'),
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">{t('voice.title')}</h2>
      <p className="mb-4 text-sm text-ide-muted">{t('voice.sectionHint')}</p>
      <label className="flex items-center gap-2 text-sm text-ide-text">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        {t('voice.askBefore')}
      </label>
    </section>
  );
}
