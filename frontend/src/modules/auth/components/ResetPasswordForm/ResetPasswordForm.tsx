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
            <h2 className={ styles.title }>Скидання паролю</h2>

            <div className={ styles.inputGroup }>
                <label htmlFor="newPassword">Новий пароль</label>
                <input id="newPassword" type="password" { ...register('newPassword', { required: "Це поле обов'язкове" }) } />
                { errors.newPassword && <span className={ styles.error }>{ errors.newPassword.message }</span> }
            </div>

            <div className={ styles.inputGroup }>
                <label htmlFor="confirmPassword">Повторіть пароль</label>
                <input id="confirmPassword" type="password" { ...register('confirmPassword', {
                    required: "Це поле обов'язкове",
                    validate: value => value === newPassword || "Паролі не співпадають"
                }) } />
                { errors.confirmPassword && <span className={ styles.error }>{ errors.confirmPassword.message }</span> }
            </div>

            { backendError && <div className={ styles.error }>{ backendError }</div> }

            <button
                type="submit"
                className={ styles.submitButton }
                disabled={ requestStatus === 'pending' }
            >
                { requestStatus === 'pending' ? 'Оновлення...' : 'Оновити пароль' }
            </button>
        </form>
    );
};

export default ResetPasswordForm;
