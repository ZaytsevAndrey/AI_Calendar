import React from 'react';
import { Link } from 'react-router-dom';

import { LoginFormProps } from './types';

const LoginForm: React.FC<LoginFormProps> = ({
    onSubmit,
    register,
    errors,
    requestStatus,
}) => {
    return (
        <form className="auth-form-card" onSubmit={onSubmit}>
            <h2 className="auth-form-title">Log in</h2>

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

            <button
                type="submit"
                className="auth-form-submit"
                disabled={requestStatus === 'pending'}
            >
                {requestStatus === 'pending' ? 'Signing in...' : 'Log in'}
            </button>

            <div className="auth-form-footer">
                No account? <Link to="/register">Sign up</Link>
            </div>

            <div className="auth-form-footer">
                Forgot password? <Link to="/forgot-password">Reset</Link>
            </div>
        </form>
    );
};

export default LoginForm;
