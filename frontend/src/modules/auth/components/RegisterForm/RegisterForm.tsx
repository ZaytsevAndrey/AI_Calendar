import React from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';

import { RegisterFormProps, RegisterFormData } from './types';
import { registerSchema } from './validation/schema';

const RegisterForm: React.FC<RegisterFormProps> = ({ onSubmit, requestStatus }) => {
    const {
        register,
        handleSubmit,
        formState: { errors },
    } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
    });

    return (
        <form className="auth-form-card" onSubmit={handleSubmit(onSubmit)}>
            <h2 className="auth-form-title">Sign up</h2>

            <div className="auth-form-field">
                <label htmlFor="email" className="auth-form-label">
                    Email
                </label>
                <input id="email" type="email" className="auth-form-input" {...register('email')} />
                {errors.email && (
                    <span className="auth-form-error">{errors.email.message}</span>
                )}
            </div>

            <div className="auth-form-field">
                <label htmlFor="password" className="auth-form-label">
                    Password
                </label>
                <input
                    id="password"
                    type="password"
                    className="auth-form-input"
                    {...register('password')}
                />
                {errors.password && (
                    <span className="auth-form-error">{errors.password.message}</span>
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
                    {...register('confirmPassword')}
                />
                {errors.confirmPassword && (
                    <span className="auth-form-error">{errors.confirmPassword.message}</span>
                )}
            </div>

            <button
                type="submit"
                className="auth-form-submit"
                disabled={requestStatus === 'pending'}
            >
                {requestStatus === 'pending' ? 'Signing up...' : 'Sign up'}
            </button>

            <div className="auth-form-footer">
                Already have an account? <Link to="/login">Log in</Link>
            </div>
        </form>
    );
};

export default RegisterForm;
