import React from 'react';
import { UseFormRegister, FieldErrors } from 'react-hook-form';
import { ForgotPasswordFormData } from './types';
import styles from './ForgotPasswordForm.module.scss';

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
        <form className={ styles.form } onSubmit={ onSubmit }>
            <h2 className={ styles.title }>Забули пароль?</h2>

            <div className={ styles.inputGroup }>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" { ...register('email') } />
                { errors.email && <span className={ styles.error }>{ errors.email.message }</span> }
            </div>

            <button
                type="submit"
                className={ styles.submitButton }
                disabled={ requestStatus === 'pending' }
            >
                { requestStatus === 'pending' ? 'Відправка...' : 'Надіслати код' }
            </button>
        </form>
    );
};

export default ForgotPasswordForm;
