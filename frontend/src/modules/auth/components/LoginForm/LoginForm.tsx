import React from 'react';
import { useTranslation } from 'react-i18next';

export interface LoginFormProps {
    requestStatus: string;
    errorMessage?: string | null;
    onGoogleSignIn: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({
    onGoogleSignIn,
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
            <button
                type="button"
                className="auth-form-submit"
                disabled={pending}
                onClick={onGoogleSignIn}
            >
                {pending ? t('auth.redirecting') : t('auth.continueGoogle')}
            </button>
        </div>
        </div>
    );
};

export default LoginForm;
