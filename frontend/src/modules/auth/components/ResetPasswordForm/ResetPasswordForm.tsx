import React from 'react';
import { UseFormRegister, FieldErrors, useWatch } from 'react-hook-form';
import { ResetPasswordFormData } from './types';

interface Props {
    onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
    register: UseFormRegister<ResetPasswordFormData>;
    errors: FieldErrors<ResetPasswordFormData>;
    requestStatus: string;
    backendError?: string | null;
    control: any;
}

const ResetPasswordForm: React.FC<Props> = ({
    onSubmit,
    register,
    errors,
    requestStatus,
    backendError,
    control,
}) => {
    const newPassword = useWatch({ control, name: 'newPassword' });

    return (
        <form className="auth-form-card" onSubmit={onSubmit}>
            <h2 className="auth-form-title">Reset password</h2>

            <div className="auth-form-field">
                <label htmlFor="newPassword" className="auth-form-label">
                    New password
                </label>
                <input
                    id="newPassword"
                    type="password"
                    className="auth-form-input"
                    {...register('newPassword', { required: 'This field is required' })}
                />
                {errors.newPassword && (
                    <span className="auth-form-error">{errors.newPassword.message}</span>
                )}
            </div>

            <div className="auth-form-field">
                <label htmlFor="confirmPassword" className="auth-form-label">
                    Confirm password
                </label>
                <input
                    id="confirmPassword"
                    type="password"
                    className="auth-form-input"
                    {...register('confirmPassword', {
                        required: 'This field is required',
                        validate: (value) => value === newPassword || 'Passwords do not match',
                    })}
                />
                {errors.confirmPassword && (
                    <span className="auth-form-error">{errors.confirmPassword.message}</span>
                )}
            </div>

            {backendError && <div className="auth-form-error">{backendError}</div>}

            <button
                type="submit"
                className="auth-form-submit"
                disabled={requestStatus === 'pending'}
            >
                {requestStatus === 'pending' ? 'Updating...' : 'Update password'}
            </button>
        </form>
    );
};

export default ResetPasswordForm;
