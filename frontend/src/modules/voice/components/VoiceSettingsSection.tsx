import React, { useEffect, useState } from 'react';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

export function VoiceSettingsSection({
  confirmVoiceCommands,
}: {
  confirmVoiceCommands: boolean;
}) {
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
        title: next ? 'Voice confirmation on' : 'Voice confirmation off',
        detail: next
          ? 'Complete, skip, and move will ask first.'
          : 'Those commands run as soon as they are understood.',
      });
    } catch (error) {
      setEnabled(!next);
      showErrorToast({
        title: 'Could not update voice settings',
        detail: extractApiErrorMessage(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">Voice</h2>
      <p className="mb-4 text-sm text-ide-muted">
        Creating a task by voice still happens immediately. This switch only covers finishing,
        skipping, or moving a task.
      </p>
      <label className="flex items-center gap-2 text-sm text-ide-text">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void toggle(event.target.checked)}
        />
        Ask before voice commands
      </label>
    </section>
  );
}
