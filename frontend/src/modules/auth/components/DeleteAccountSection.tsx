import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { Modal } from '../../../ui/Modal';
import apiCall from 'modules/common/utils/apiCall';
import { clientLogout } from '../actions/logoutActions';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { showSuccessToast } from '../../../utils/toast';

type Step = 'closed' | 'calendars' | 'confirm';

export function DeleteAccountSection() {
  const { t } = useTranslation();
  const dispatch = useDispatch<any>();
  const [step, setStep] = useState<Step>('closed');
  const [email, setEmail] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (step === 'closed') {
      setConfirmation('');
      setError(null);
      setBusy(false);
    }
  }, [step]);

  const openFlow = async () => {
    setError(null);
    setBusy(true);
    try {
      const { data } = await apiCall({ method: 'GET', url: '/auth/me' });
      const row = data as { email?: unknown };
      setEmail(typeof row?.email === 'string' ? row.email : null);
      setStep('calendars');
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    const phrase = confirmation.trim();
    if (!phrase || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiCall({
        method: 'DELETE',
        url: '/auth/account',
        data: { confirmation: phrase },
      });
      showSuccessToast({
        title: t('settings.deleteAccountDone'),
        detail: t('settings.deleteAccountDoneDetail'),
      });
      setStep('closed');
      dispatch(clientLogout(true));
    } catch (err) {
      setError(extractApiErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-8 border-t border-ide-border pt-6">
        <h3 className="mb-1 text-base font-semibold text-ide-error">
          {t('settings.deleteAccount')}
        </h3>
        <p className="mb-4 text-sm text-ide-muted">{t('settings.deleteAccountHint')}</p>
        {error && step === 'closed' ? (
          <p className="mb-3 text-sm text-ide-error">{error}</p>
        ) : null}
        <button
          type="button"
          className="ui-btn-danger inline-flex items-center gap-2 max-md:h-8 max-md:min-h-0 max-md:px-3 max-md:py-0"
          onClick={() => void openFlow()}
          disabled={busy}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t('settings.deleteAccount')}
        </button>
      </div>

      <Modal
        open={step === 'calendars'}
        onClose={() => !busy && setStep('closed')}
        title={t('settings.deleteAccountCalendarsTitle')}
        footer={
          <>
            <button
              type="button"
              className="ui-btn-secondary"
              disabled={busy}
              onClick={() => setStep('closed')}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className="ui-btn-danger"
              disabled={busy}
              onClick={() => setStep('confirm')}
            >
              {t('settings.deleteAccountContinue')}
            </button>
          </>
        }
      >
        <p className="text-sm text-ide-text">{t('settings.deleteAccountCalendarsBody')}</p>
      </Modal>

      <Modal
        open={step === 'confirm'}
        onClose={() => !busy && setStep('closed')}
        title={t('settings.deleteAccountConfirmTitle')}
        footer={
          <>
            <button
              type="button"
              className="ui-btn-secondary"
              disabled={busy}
              onClick={() => setStep('calendars')}
            >
              {t('settings.deleteAccountBack')}
            </button>
            <button
              type="button"
              className="ui-btn-danger"
              disabled={busy || !confirmation.trim()}
              onClick={() => void submitDelete()}
            >
              {busy ? t('common.deleting') : t('settings.deleteAccountForever')}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-ide-text">{t('settings.deleteAccountConfirmBody')}</p>
          {email ? (
            <p className="text-ide-muted">
              {t('settings.deleteAccountTypeHint', { email })}
            </p>
          ) : (
            <p className="text-ide-muted">{t('settings.deleteAccountTypeHintDeleteOnly')}</p>
          )}
          <label className="block">
            <span className="sr-only">{t('settings.deleteAccountConfirmLabel')}</span>
            <input
              type="text"
              className="ui-input w-full"
              autoComplete="off"
              value={confirmation}
              disabled={busy}
              placeholder={email || 'DELETE'}
              onChange={(e) => setConfirmation(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitDelete();
                }
              }}
            />
          </label>
          {error ? <p className="text-ide-error">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
