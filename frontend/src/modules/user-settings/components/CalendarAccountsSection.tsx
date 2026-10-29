import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  connectAppleCalDav,
  disconnectIdentity,
  getAuthProvidersStatus,
  getMicrosoftAuthUrl,
  listLinkedIdentities,
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

type WriteProvider = 'google' | 'microsoft' | 'apple';

const DEFAULT_NAME = 'AI Calendar Assistant';

/** Connected accounts + app calendar name + which account receives new tasks. */
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
  const [calendarName, setCalendarName] = useState(DEFAULT_NAME);
  const [writeProvider, setWriteProvider] = useState<WriteProvider | null>(null);
  const [appleFormOpen, setAppleFormOpen] = useState(false);
  const [appleId, setAppleId] = useState('');
  const [applePassword, setApplePassword] = useState('');
  const [appleBusy, setAppleBusy] = useState(false);
  const [showAppleHelp, setShowAppleHelp] = useState(false);
  const [saving, setSaving] = useState(false);

  const refreshIdentities = useCallback(() => {
    void listLinkedIdentities()
      .then(setIdentities)
      .catch(() => setIdentities([]));
  }, []);

  useEffect(() => {
    void getAuthProvidersStatus()
      .then(setStatus)
      .catch(() => setStatus({ google: true, microsoft: false, apple: true }));
    refreshIdentities();
  }, [refreshIdentities]);

  useEffect(() => {
    const ms = searchParams.get('microsoft');
    if (!ms) return;
    if (ms === 'linked') {
      showSuccessToast(t('settings.microsoftLinked'));
      refreshIdentities();
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
  }, [searchParams, setSearchParams, t, refreshIdentities]);

  const microsoftLinked = identities.some(
    (i) => i.provider === 'microsoft' && i.connected,
  );
  const appleLinked = identities.some(
    (i) => i.provider === 'apple' && i.connected,
  );
  const googleLinked = !!settings?.googleCalendarLinked;

  useEffect(() => {
    if (!settings) return;
    setCalendarName(
      settings.appGoogleCalendarName?.trim() || DEFAULT_NAME,
    );
    const stored = settings.appCalendarProvider;
    if (stored === 'google' && googleLinked) {
      setWriteProvider('google');
      return;
    }
    if (stored === 'microsoft' && microsoftLinked) {
      setWriteProvider('microsoft');
      return;
    }
    if (stored === 'apple' && appleLinked) {
      setWriteProvider('apple');
      return;
    }
    if (googleLinked) setWriteProvider('google');
    else if (microsoftLinked) setWriteProvider('microsoft');
    else if (appleLinked) setWriteProvider('apple');
    else setWriteProvider(null);
  }, [settings, googleLinked, microsoftLinked, appleLinked]);

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
      if (!writeProvider) {
        await updateSettings({ appCalendarProvider: 'apple' }).unwrap();
        setWriteProvider('apple');
      }
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
    } catch (e) {
      showErrorToast({
        title: t('settings.disconnectFailed'),
        detail: extractApiErrorMessage(e),
      });
    }
  };

  const saveAppCalendar = async () => {
    const name = calendarName.trim() || DEFAULT_NAME;
    if (!writeProvider) {
      showErrorToast({ title: t('settings.writeAccountRequired') });
      return;
    }
    setSaving(true);
    try {
      await updateSettings({
        appGoogleCalendarName: name,
        appCalendarProvider: writeProvider,
      }).unwrap();
      setCalendarName(name);
      showSuccessToast(t('settings.appCalendarSaved'));
    } catch (e) {
      showErrorToast({
        title: t('settings.saveFailed'),
        detail: extractApiErrorMessage(e),
      });
    } finally {
      setSaving(false);
    }
  };

  const identityEmail = (provider: WriteProvider) =>
    identities.find((i) => i.provider === provider)?.email;

  const writeOptions = (
    [
      { id: 'google' as const, label: 'Google', ready: googleLinked },
      { id: 'microsoft' as const, label: 'Microsoft', ready: microsoftLinked },
      { id: 'apple' as const, label: 'Apple', ready: appleLinked },
    ] satisfies Array<{ id: WriteProvider; label: string; ready: boolean }>
  ).filter((row) => row.ready);

  return (
    <section className="border-t border-ide-border pt-10">
      <h2 className="mb-2 text-lg font-semibold text-ide-text">
        {t('settings.calendars')}
      </h2>
      <p className="mb-6 text-sm text-ide-muted">{t('settings.calendarsHint')}</p>

      <h3 className="mb-2 text-sm font-semibold text-ide-text">
        {t('settings.linkedAccounts')}
      </h3>
      <p className="mb-3 text-xs text-ide-muted">{t('settings.linkedAccountsHint')}</p>

      <ul className="mb-8 space-y-3">
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

      <h3 className="mb-2 text-sm font-semibold text-ide-text">
        {t('settings.appCalendar')}
      </h3>
      <p className="mb-3 text-xs text-ide-muted">{t('settings.appCalendarHint')}</p>

      <div className="mb-4 flex max-w-md flex-col gap-1">
        <label htmlFor="app-calendar-name" className="ui-label">
          {t('settings.appCalendarName')}
        </label>
        <Input
          id="app-calendar-name"
          type="text"
          className="w-full"
          maxLength={200}
          value={calendarName}
          onChange={(e) => setCalendarName(e.target.value)}
        />
      </div>

      {writeOptions.length > 0 ? (
        <fieldset className="mb-4">
          <legend className="mb-2 text-sm text-ide-text">
            {t('settings.writeAccount')}
          </legend>
          <p className="mb-2 text-xs text-ide-muted">{t('settings.writeAccountHint')}</p>
          <ul className="space-y-2">
            {writeOptions.map((opt) => (
              <li key={opt.id}>
                <label className="flex items-center gap-2 text-sm text-ide-text">
                  <input
                    type="radio"
                    name="app-calendar-provider"
                    checked={writeProvider === opt.id}
                    onChange={() => setWriteProvider(opt.id)}
                  />
                  <ProviderLogo provider={opt.id} className="h-3 w-3" />
                  <span>{opt.label}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : (
        <p className="mb-4 text-sm text-ide-muted">{t('settings.noWriteAccount')}</p>
      )}

      <Button
        type="button"
        disabled={saving || writeOptions.length === 0}
        onClick={() => void saveAppCalendar()}
        icon={Check}
      >
        {t('common.save')}
      </Button>
    </section>
  );
}
