import React from 'react';

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
    const pending = requestStatus === 'pending';

    return (
        <div className="auth-form-card">
            <h2 className="auth-form-title">Sign in</h2>
            <p className="mb-6 text-sm text-ide-muted">
                Continue with Google. Calendar access is requested once when you create an account.
            </p>
            {errorMessage ? <p className="auth-form-error mb-4">{errorMessage}</p> : null}
            <button
                type="button"
                className="auth-form-submit"
                disabled={pending}
                onClick={onGoogleSignIn}
            >
                {pending ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>
        </div>
    );
};

export default LoginForm;
