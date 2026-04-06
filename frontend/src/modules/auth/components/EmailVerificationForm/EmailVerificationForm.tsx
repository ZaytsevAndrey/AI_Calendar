import React from 'react';
import { UseFormRegister, FieldErrors, UseFormHandleSubmit } from 'react-hook-form';
import { EmailVerificationFormData } from './types';
import styles from './EmailVerificationForm.module.scss';

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
        <form className={ styles.form } onSubmit={ handleSubmit(onSubmit) }>
            <h2 className={ styles.title }>Підтвердження пошти</h2>

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

export default EmailVerificationForm;
