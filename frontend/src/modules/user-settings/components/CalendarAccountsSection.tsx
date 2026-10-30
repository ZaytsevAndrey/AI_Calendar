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
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { googleCalendarAPI } from 'api/google-calendar.api';
import { Switch } from 'ui/Switch';
import { SettingRow, SettingsGroup } from '../settings/SettingsUi';
import { useAutosave } from '../settings/useAutosave';
import { ProviderLogo } from 'modules/calendar/components/ProviderLogo';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { Link2, Unlink, X } from 'lucide-react';
import { Button } from 'ui/Button';
import { Input } from 'ui/Input';

/** Connect Microsoft/Apple + choose outbound sync targets. */
export function CalendarAccountsSection() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: settings } = useGetUserSettingsQuery();
  const { save, status: saveStatus } = useAutosave();
  const [appName, setAppName] = useState('');
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
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
    void googleCalendarAPI
      .checkConnection()
      .then((response) => setGoogleConnected(!!(response.data as { connected?: boolean })?.connected))
      .catch(() => setGoogleConnected(!!settings?.googleCalendarLinked));
    // Once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setAppName(settings?.appGoogleCalendarName?.trim() || 'luefy');
  }, [settings?.appGoogleCalendarName]);

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

  const saveTargets = (nowhere: boolean, keys: string[]) => {
    const syncTargetCalendars = nowhere
      ? []
      : keys.map((key) => {
          const [provider, ...rest] = key.split(':');
          return { provider, calendarId: rest.join(':') };
        });
    void save('targets', { syncTargetCalendars });
  };

  const saveName = () => {
    const v = appName.trim() || 'luefy';
    if (v === (settings?.appGoogleCalendarName?.trim() || 'luefy')) return;
    void save('name', { appGoogleCalendarName: v, googleCalendarLinked: googleConnected ?? googleLinked });
  };

  const identityEmail = (provider: 'google' | 'microsoft' | 'apple') =>
    identities.find((i) => i.provider === provider)?.email;

  const providerRow = (
    provider: 'google' | 'microsoft' | 'apple',
    name: string,
    linked: boolean,
    detail: React.ReactNode,
    action: React.ReactNode,
    extra?: React.ReactNode,
  ) => (
    <div className="px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ide-surface">
          <ProviderLogo provider={provider} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ide-text">{name}</p>
          <p className={`truncate text-body-sm ${linked ? 'text-ide-accent' : 'text-ide-muted'}`}>{detail}</p>
        </div>
        {action}
      </div>
      {extra}
    </div>
  );

  return (
    <div className="space-y-4">
      <SettingsGroup title={t('settings.calendarAccounts')} hint={t('settings.calendarAccountsHint')}>
        {providerRow(
          'google',
          'Google',
          !!(googleConnected ?? googleLinked),
          googleConnected === null
            ? t('settings.checkingConnection')
            : googleConnected
              ? [t('settings.linked'), identityEmail('google')].filter(Boolean).join(' · ')
              : t('settings.notLinkedHint'),
          null,
        )}
        {providerRow(
          'microsoft',
          'Microsoft',
          microsoftLinked,
          microsoftLinked
            ? [t('settings.accountConnected'), identityEmail('microsoft')].filter(Boolean).join(' · ')
            : status?.microsoft === false
              ? t('settings.providerNotConfigured')
              : t('settings.accountNotConnected'),
          microsoftLinked ? (
            <Button type="button" variant="ghost" size={{ base: 'md', md: 'sm' }} onClick={() => void disconnect('microsoft')} icon={Unlink}>
              {t('settings.disconnect')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size={{ base: 'md', md: 'sm' }}
              disabled={status?.microsoft === false}
              onClick={() => void connectMicrosoft()}
              icon={Link2}
            >
              {t('settings.connectMicrosoft')}
            </Button>
          ),
        )}
        {providerRow(
          'apple',
          'Apple',
          appleLinked,
          appleLinked
            ? [t('settings.accountConnected'), identityEmail('apple')].filter(Boolean).join(' · ')
            : t('settings.accountNotConnected'),
          appleLinked ? (
            <Button type="button" variant="ghost" size={{ base: 'md', md: 'sm' }} onClick={() => void disconnect('apple')} icon={Unlink}>
              {t('settings.disconnect')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size={{ base: 'md', md: 'sm' }}
              onClick={() => {
                setAppleFormOpen((v) => !v);
                setShowAppleHelp(true);
              }}
              icon={Link2}
            >
              {t('settings.connectApple')}
            </Button>
          ),
          !appleLinked && appleFormOpen ? (
            <div className="mt-3 space-y-3 rounded-control bg-ide-surface p-3">
              <button
                type="button"
                className="text-left text-body-sm font-medium text-ide-link hover:underline"
                onClick={() => setShowAppleHelp((v) => !v)}
              >
                {t('settings.appleInstructionsTitle')}
              </button>
              {showAppleHelp ? (
                <p className="whitespace-pre-wrap text-body-sm leading-relaxed text-ide-muted">
                  {t('settings.appleInstructions')}
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-body-sm text-ide-muted">{t('settings.appleIdLabel')}</span>
                  <Input
                    type="email"
                    autoComplete="username"
                    value={appleId}
                    onChange={(e) => setAppleId(e.target.value)}
                    disabled={appleBusy}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-body-sm text-ide-muted">{t('settings.appleAppPasswordLabel')}</span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={applePassword}
                    onChange={(e) => setApplePassword(e.target.value)}
                    disabled={appleBusy}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={appleBusy || !appleId.trim() || !applePassword.trim()}
                  onClick={() => void submitAppleCalDav()}
                  icon={Link2}
                >
                  {t('settings.appleConnectSubmit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
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
          ) : null,
        )}
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow
          stack
          label={t('settings.appCalendarName')}
          htmlFor="app-google-calendar-name"
          hint={t('settings.appCalendarNameHint')}
          status={saveStatus('name')}
        >
          <Input
            id="app-google-calendar-name"
            type="text"
            className="md:w-64"
            maxLength={200}
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            onBlur={saveName}
          />
        </SettingRow>
        <SettingRow label={t('settings.syncTargets')} hint={t('settings.syncTargetsHint')} status={saveStatus('targets')} stack>
          <div className="flex items-center justify-between gap-3 rounded-control bg-ide-surface px-3">
            <label htmlFor="sync-nowhere" className="text-body text-ide-text">
              {t('settings.syncNowhere')}
            </label>
            <Switch
              id="sync-nowhere"
              checked={syncNowhere}
              onChange={(next) => {
                setSyncNowhere(next);
                const keys = next ? [] : selected;
                if (next) setSelected([]);
                saveTargets(next, keys);
              }}
            />
          </div>
          {!syncNowhere && calendars.length > 0 ? (
            <ul className="mt-2 flex flex-col">
              {calendars.map((cal) => {
                const key = `${cal.provider}:${cal.id}`;
                return (
                  <li key={key}>
                    <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-body text-ide-text hover:bg-ide-surface md:min-h-9 md:text-body-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-ide-accentBlue md:h-4 md:w-4"
                        checked={selected.includes(key)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...selected, key] : selected.filter((k) => k !== key);
                          setSelected(next);
                          saveTargets(false, next);
                        }}
                      />
                      <ProviderLogo provider={cal.provider} className="h-3.5 w-3.5" />
                      <span className="truncate">{cal.summary}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
