import React from 'react';
import { UseFormRegister, FieldErrors, useWatch } from 'react-hook-form';
import { ResetPasswordFormData } from './types';
import styles from './ResetPasswordForm.module.scss';

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
        <form className={ styles.form } onSubmit={ onSubmit }>
            <h2 className={ styles.title }>Reset password</h2>

            <div className={ styles.inputGroup }>
                <label htmlFor="newPassword">New password</label>
                <input id="newPassword" type="password" { ...register('newPassword', { required: 'This field is required' }) } />
                { errors.newPassword && <span className={ styles.error }>{ errors.newPassword.message }</span> }
            </div>

            <div className={ styles.inputGroup }>
                <label htmlFor="confirmPassword">Confirm password</label>
                <input id="confirmPassword" type="password" { ...register('confirmPassword', {
                    required: 'This field is required',
                    validate: value => value === newPassword || 'Passwords do not match'
                }) } />
                { errors.confirmPassword && <span className={ styles.error }>{ errors.confirmPassword.message }</span> }
            </div>

            { backendError && <div className={ styles.error }>{ backendError }</div> }

            <button
                type="submit"
                className={ styles.submitButton }
                disabled={ requestStatus === 'pending' }
            >
                { requestStatus === 'pending' ? 'Updating...' : 'Update password' }
            </button>
        </form>
    );
};

export default ResetPasswordForm;
