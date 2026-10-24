import React from 'react';
import { useTranslation } from 'react-i18next';
import { ProviderLogo } from 'modules/calendar/components/ProviderLogo';
import { Button } from 'ui/Button';

export interface LoginFormProps {
    requestStatus: string;
    errorMessage?: string | null;
    onGoogleSignIn: () => void;
    onMicrosoftSignIn?: () => void;
    microsoftAvailable?: boolean;
}

const LoginForm: React.FC<LoginFormProps> = ({
    onGoogleSignIn,
    onMicrosoftSignIn,
    microsoftAvailable,
    requestStatus,
    errorMessage,
}) => {
    const { t } = useTranslation();
    const pending = requestStatus === 'pending';

    return (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center px-4 py-6">
        <div className="auth-form-card my-0 w-full">
            <h2 className="auth-form-title">{t('auth.signIn')}</h2>
            <p className="mb-6 text-sm text-ide-muted">
                {t('auth.signInLead')}
            </p>
            {errorMessage ? <p className="auth-form-error mb-4">{errorMessage}</p> : null}
            <div className="flex flex-col gap-2">
              <Button type="button" className="mt-2 w-full" disabled={pending} onClick={onGoogleSignIn}>
                  <ProviderLogo provider="google" className="h-4 w-4" />
                  {pending ? t('auth.redirecting') : t('auth.continueGoogle')}
              </Button>
              {microsoftAvailable && onMicrosoftSignIn ? (
                <Button type="button" className="w-full" disabled={pending} onClick={onMicrosoftSignIn}>
                  <ProviderLogo provider="microsoft" className="h-4 w-4" />
                  {t('auth.continueMicrosoft')}
                </Button>
              ) : null}
            </div>
        </div>
        </div>
    );
};

export default LoginForm;
