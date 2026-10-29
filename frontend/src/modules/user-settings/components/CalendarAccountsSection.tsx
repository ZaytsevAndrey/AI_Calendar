import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  connectAppleCalDav,
  disconnectIdentity,
  getAuthProvidersStatus,
  getMicrosoftAuthUrl,
  listLinkedIdentities,
  listProviderCalendars,
  type LinkedIdentityDTO,
} from 'api/calendarOverlays.api';
import {
  useGetUserSettingsQuery,
  useUpdateUserSettingsMutation,
} from 'api/userSettingsApi';
import { ProviderLogo } from 'modules/calendar/components/ProviderLogo';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { Check, Link2, Unlink, X } from 'lucide-react';
import { Button } from 'ui/Button';
import { Input } from 'ui/Input';

/** Connect Microsoft/Apple + choose outbound sync targets. */
export function CalendarAccountsSection() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: settings } = useGetUserSettingsQuery();
  const [updateSettings] = useUpdateUserSettingsMutation();
  const [status, setStatus] = useState<{
    google: boolean;
    microsoft: boolean;
    apple: boolean;
  } | null>(null);
  const [identities, setIdentities] = useState<LinkedIdentityDTO[]>([]);
  const [calendars, setCalendars] = useState<
    Array<{ id: string; summary: string; provider: 'google' | 'microsoft' | 'apple' }>
  >([]);
  const [syncNowhere, setSyncNowhere] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [appleFormOpen, setAppleFormOpen] = useState(false);
  const [appleId, setAppleId] = useState('');
  const [applePassword, setApplePassword] = useState('');
  const [appleBusy, setAppleBusy] = useState(false);
  const [showAppleHelp, setShowAppleHelp] = useState(false);

  const refreshIdentities = useCallback(() => {
    void listLinkedIdentities()
      .then(setIdentities)
      .catch(() => setIdentities([]));
  }, []);

  const refreshCalendars = useCallback(() => {
    void listProviderCalendars()
      .then((res) => setCalendars(res.calendars ?? []))
      .catch(() => setCalendars([]));
  }, []);

  useEffect(() => {
    void getAuthProvidersStatus()
      .then(setStatus)
      .catch(() => setStatus({ google: true, microsoft: false, apple: true }));
    refreshIdentities();
    refreshCalendars();
  }, [refreshIdentities, refreshCalendars]);

  useEffect(() => {
    const ms = searchParams.get('microsoft');
    if (!ms) return;
    if (ms === 'linked') {
      showSuccessToast(t('settings.microsoftLinked'));
      refreshIdentities();
      refreshCalendars();
    } else if (ms === 'error') {
      showErrorToast({
        title: t('settings.microsoftLinkFailed'),
        detail: searchParams.get('detail'),
      });
    }
    const next = new URLSearchParams(searchParams);
    next.delete('microsoft');
    next.delete('detail');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, t, refreshIdentities, refreshCalendars]);

  useEffect(() => {
    if (!settings) return;
    const targets = settings.syncTargetCalendars;
    if (targets === null || targets === undefined) {
      setSyncNowhere(false);
      setSelected([]);
      return;
    }
    setSyncNowhere(targets.length === 0);
    setSelected(targets.map((row) => `${row.provider}:${row.calendarId}`));
  }, [settings]);

  const microsoftLinked = identities.some(
    (i) => i.provider === 'microsoft' && i.connected,
  );
  const appleLinked = identities.some(
    (i) => i.provider === 'apple' && i.connected,
  );
  const googleLinked = !!settings?.googleCalendarLinked;

  const connectMicrosoft = async () => {
    try {
      const { url } = await getMicrosoftAuthUrl(true);
      window.location.href = url;
    } catch (e) {
      showErrorToast({
        title: t('settings.providerNotConfigured'),
        detail: extractApiErrorMessage(e),
      });
    }
  };

  const submitAppleCalDav = async () => {
    setAppleBusy(true);
    try {
      await connectAppleCalDav({
        appleId: appleId.trim(),
        appSpecificPassword: applePassword.trim(),
      });
      showSuccessToast(t('settings.appleLinked'));
      setAppleFormOpen(false);
      setApplePassword('');
      refreshIdentities();
      refreshCalendars();
    } catch (e) {
      showErrorToast({
        title: t('settings.appleLinkFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setAppleBusy(false);
    }
  };

  const disconnect = async (provider: 'microsoft' | 'apple') => {
    const ok = window.confirm(t('settings.disconnectConfirm', { provider }));
    if (!ok) return;
    try {
      await disconnectIdentity(provider, { confirm: true });
      showSuccessToast(t('settings.disconnected'));
      refreshIdentities();
      refreshCalendars();
    } catch (e) {
      showErrorToast({
        title: t('settings.disconnectFailed'),
        detail: extractApiErrorMessage(e),
      });
    }
  };

  const saveTargets = async () => {
    try {
      const syncTargetCalendars = syncNowhere
        ? []
        : selected.map((key) => {
            const [provider, ...rest] = key.split(':');
            return { provider, calendarId: rest.join(':') };
          });
      await updateSettings({ syncTargetCalendars }).unwrap();
      showSuccessToast(t('settings.syncTargetsSaved'));
    } catch (e) {
      showErrorToast({
        title: t('settings.saveFailed'),
        detail: extractApiErrorMessage(e),
      });
    }
  };

  const identityEmail = (provider: 'google' | 'microsoft' | 'apple') =>
    identities.find((i) => i.provider === provider)?.email;

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">
        {t('settings.calendarAccounts')}
      </h2>
      <p className="mb-4 text-sm text-ide-muted">{t('settings.calendarAccountsHint')}</p>

      <ul className="mb-6 space-y-3">
        <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ide-border px-3 py-2">
          <ProviderLogo provider="google" className="h-4 w-4" />
          <span className="min-w-0 flex-1 text-sm text-ide-text">
            Google
            {googleLinked ? (
              <span className="ml-2 text-ide-dim">{t('settings.accountConnected')}</span>
            ) : (
              <span className="ml-2 text-ide-muted">{t('settings.accountNotConnected')}</span>
            )}
          </span>
        </li>
        <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ide-border px-3 py-2">
          <ProviderLogo provider="microsoft" className="h-4 w-4" />
          <span className="min-w-0 flex-1 text-sm text-ide-text">
            Microsoft
            {microsoftLinked ? (
              <>
                <span className="ml-2 text-ide-dim">{t('settings.accountConnected')}</span>
                {identityEmail('microsoft') ? (
                  <span className="ml-2 text-xs text-ide-muted">
                    {identityEmail('microsoft')}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="ml-2 text-ide-muted">{t('settings.accountNotConnected')}</span>
            )}
          </span>
          {microsoftLinked ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void disconnect('microsoft')}
              icon={Unlink}
            >
              {t('settings.disconnect')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={status?.microsoft === false}
              onClick={() => void connectMicrosoft()}
              icon={Link2}
            >
              {t('settings.connectMicrosoft')}
            </Button>
          )}
        </li>
        <li className="rounded-lg border border-ide-border px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <ProviderLogo provider="apple" className="h-4 w-4" />
            <span className="min-w-0 flex-1 text-sm text-ide-text">
              Apple
              {appleLinked ? (
                <>
                  <span className="ml-2 text-ide-dim">{t('settings.accountConnected')}</span>
                  {identityEmail('apple') ? (
                    <span className="ml-2 text-xs text-ide-muted">
                      {identityEmail('apple')}
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="ml-2 text-ide-muted">{t('settings.accountNotConnected')}</span>
              )}
            </span>
            {appleLinked ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void disconnect('apple')}
                icon={Unlink}
              >
                {t('settings.disconnect')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setAppleFormOpen((v) => !v);
                  setShowAppleHelp(true);
                }}
                icon={Link2}
              >
                {t('settings.connectApple')}
              </Button>
            )}
          </div>
          {!appleLinked && appleFormOpen ? (
            <div className="mt-3 space-y-3 border-t border-ide-border pt-3">
              <button
                type="button"
                className="text-left text-xs font-medium text-ide-link hover:underline"
                onClick={() => setShowAppleHelp((v) => !v)}
              >
                {t('settings.appleInstructionsTitle')}
              </button>
              {showAppleHelp ? (
                <pre className="whitespace-pre-wrap rounded-md bg-ide-surface px-3 py-2 text-xs leading-relaxed text-ide-muted">
                  {t('settings.appleInstructions')}
                </pre>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm text-ide-text">
                  <span className="mb-1 block text-xs text-ide-muted">
                    {t('settings.appleIdLabel')}
                  </span>
                  <Input
                    type="email"
                    autoComplete="username"
                    size="sm"
                    value={appleId}
                    onChange={(e) => setAppleId(e.target.value)}
                    disabled={appleBusy}
                  />
                </label>
                <label className="block text-sm text-ide-text">
                  <span className="mb-1 block text-xs text-ide-muted">
                    {t('settings.appleAppPasswordLabel')}
                  </span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    size="sm"
                    value={applePassword}
                    onChange={(e) => setApplePassword(e.target.value)}
                    disabled={appleBusy}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={appleBusy || !appleId.trim() || !applePassword.trim()}
                  onClick={() => void submitAppleCalDav()}
                  icon={Link2}
                >
                  {t('settings.appleConnectSubmit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={appleBusy}
                  onClick={() => {
                    setAppleFormOpen(false);
                    setApplePassword('');
                  }}
                  icon={X}
                >
                  {t('settings.appleConnectCancel')}
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      </ul>

      <h3 className="mb-2 text-sm font-semibold text-ide-text">{t('settings.syncTargets')}</h3>
      <p className="mb-3 text-xs text-ide-muted">{t('settings.syncTargetsHint')}</p>
      <label className="mb-2 flex items-center gap-2 text-sm text-ide-text">
        <Input
          type="checkbox"
          checked={syncNowhere}
          onChange={(e) => {
            setSyncNowhere(e.target.checked);
            if (e.target.checked) setSelected([]);
          }}
        />
        {t('settings.syncNowhere')}
      </label>
      {!syncNowhere && calendars.length > 0 ? (
        <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded border border-ide-border p-2">
          {calendars.map((cal) => {
            const key = `${cal.provider}:${cal.id}`;
            return (
              <li key={key}>
                <label className="flex items-center gap-2 text-sm text-ide-text">
                  <Input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={(e) => {
                      setSelected((prev) =>
                        e.target.checked
                          ? [...prev, key]
                          : prev.filter((k) => k !== key),
                      );
                    }}
                  />
                  <ProviderLogo provider={cal.provider} className="h-3 w-3" />
                  <span className="truncate">{cal.summary}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button type="button" onClick={() => void saveTargets()} icon={Check}>
        {t('common.save')}
      </Button>
    </section>
  );
}
