import React from 'react';
import { UseFormRegister, FieldErrors, UseFormHandleSubmit } from 'react-hook-form';
import { EmailVerificationFormData } from './types';

interface Props {
    onSubmit: (data: EmailVerificationFormData) => void;
    register: UseFormRegister<EmailVerificationFormData>;
    errors: FieldErrors<EmailVerificationFormData>;
    handleSubmit: UseFormHandleSubmit<EmailVerificationFormData>;
    requestStatus: string;
}

const EmailVerificationForm: React.FC<Props> = ({
    onSubmit,
    register,
    errors,
    requestStatus,
    handleSubmit,
}) => {
    return (
        <form className="auth-form-card-narrow" onSubmit={handleSubmit(onSubmit)}>
            <h2 className="auth-form-title">Verify email</h2>

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

export default EmailVerificationForm;
