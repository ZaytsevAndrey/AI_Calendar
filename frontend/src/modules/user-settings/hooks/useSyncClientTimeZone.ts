import { useEffect, useRef } from 'react';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from '../../../api/userSettingsApi';

/** Keep server-side day windows aligned with the browser IANA zone. */
export function useSyncClientTimeZone(enabled: boolean): void {
  const { data: settings } = useGetUserSettingsQuery(undefined, { skip: !enabled });
  const [updateSettings] = useUpdateUserSettingsMutation();
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled || !settings || sent.current) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone || settings.timeZone === timeZone) return;
    sent.current = true;
    void updateSettings({ timeZone });
  }, [enabled, settings, updateSettings]);
}
