import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Trash2, X } from 'lucide-react';
import { Modal } from '../../../ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { Input } from 'ui/Input';
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
        <Button
          type="button"
          variant="danger"
          size={dialogButtonSize}
          onClick={() => void openFlow()}
          disabled={busy}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          {t('settings.deleteAccount')}
        </Button>
      </div>

      <Modal
        open={step === 'calendars'}
        onClose={() => !busy && setStep('closed')}
        title={t('settings.deleteAccountCalendarsTitle')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size={dialogButtonSize}
              disabled={busy}
              onClick={() => setStep('closed')}
              icon={X}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size={dialogButtonSize}
              disabled={busy}
              onClick={() => setStep('confirm')}
              icon={ArrowRight}
            >
              {t('settings.deleteAccountContinue')}
            </Button>
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
            <Button
              type="button"
              variant="secondary"
              size={dialogButtonSize}
              disabled={busy}
              onClick={() => setStep('calendars')}
              icon={ArrowLeft}
            >
              {t('settings.deleteAccountBack')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size={dialogButtonSize}
              disabled={busy || !confirmation.trim()}
              onClick={() => void submitDelete()}
              icon={Trash2}
            >
              {busy ? t('common.deleting') : t('settings.deleteAccountForever')}
            </Button>
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
            <Input
              type="text"
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
