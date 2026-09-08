import { useEffect, useRef } from 'react';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from '../../../api/userSettingsApi';
import { detectClientTimeZone } from '../ianaTimeZones';

/** Fill settings.timeZone once from the browser; never overwrite a saved zone. */
export function useSyncClientTimeZone(enabled: boolean): void {
  const { data: settings } = useGetUserSettingsQuery(undefined, { skip: !enabled });
  const [updateSettings] = useUpdateUserSettingsMutation();
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled) {
      sent.current = false;
      return;
    }
    if (!settings || sent.current) return;
    if (settings.timeZone?.trim()) return;
    const timeZone = detectClientTimeZone();
    if (!timeZone) return;
    sent.current = true;
    void updateSettings({ timeZone });
  }, [enabled, settings, updateSettings]);
}
