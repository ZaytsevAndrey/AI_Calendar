import React from 'react';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { ForgotPasswordFormData } from './types';

interface Props {
    onSubmit: React.FormEventHandler<HTMLFormElement>;
    register: UseFormRegister<ForgotPasswordFormData>;
    errors: FieldErrors<ForgotPasswordFormData>;
    requestStatus: string;
}

const ForgotPasswordForm: React.FC<Props> = ({
    onSubmit,
    register,
    errors,
    requestStatus,
}) => {
    return (
        <form className="auth-form-card-narrow" onSubmit={onSubmit}>
            <h2 className="auth-form-title">Forgot password?</h2>

            <div className="auth-form-field">
                <label htmlFor="email" className="auth-form-label">
                    Email
                </label>
                <input id="email" type="email" className="auth-form-input" {...register('email')} />
                {errors.email && (
                    <span className="auth-form-error">{errors.email.message}</span>
                )}
            </div>

            <button
                type="submit"
                className="auth-form-submit"
                disabled={requestStatus === 'pending'}
            >
                {requestStatus === 'pending' ? 'Sending...' : 'Send code'}
            </button>
        </form>
    );
};

export default ForgotPasswordForm;
