import React from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';

import { RegisterFormProps, RegisterFormData } from './types';
import { registerSchema } from './validation/schema';

import styles from './RegisterForm.module.scss';

const RegisterForm: React.FC<RegisterFormProps> = ({ onSubmit, requestStatus }) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
    });

    return (
        <form className={ styles.registerForm } onSubmit={ handleSubmit(onSubmit) }>
            <h2 className={ styles.title }>Sign up</h2>

            <div className={ styles.inputGroup }>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" { ...register('email') } />
                {errors.email && <span className={ styles.error }>{ errors.email.message }</span>}
            </div>

            <div className={ styles.inputGroup }>
                <label htmlFor="password">Password</label>
                <input id="password" type="password" { ...register('password') } />
                {errors.password && <span className={ styles.error }>{ errors.password.message }</span>}
            </div>

            <div className={ styles.inputGroup }>
                <label htmlFor="confirmPassword">Confirm password</label>
                <input id="confirmPassword" type="password" { ...register('confirmPassword') } />
                {errors.confirmPassword && <span className={ styles.error }>{ errors.confirmPassword.message }</span>}
            </div>

            <button
                type="submit"
                className={ styles.submitButton }
                disabled={ requestStatus === 'pending' }
            >
                { requestStatus === 'pending' ? 'Signing up...' : 'Sign up' }
            </button>

            <div className={ styles.redirect }>
                Already have an account? <Link to="/login">Log in</Link>
            </div>
        </form>
    );
};

export default RegisterForm;
