import React from 'react';
import { Link } from 'react-router-dom';

import { LoginFormProps } from './types';
import styles from './LoginForm.module.scss';

const LoginForm: React.FC<LoginFormProps> = ({
                                                 onSubmit,
                                                 register,
                                                 errors,
                                                 requestStatus,
                                             }) => {
    return (
        <form className={ styles.loginForm } onSubmit={ onSubmit }>
            <h2 className={ styles.title }>Log in</h2>

            <div className={ styles.inputGroup }>
                <label htmlFor="email">Email</label>
                <input id="email" type="email" { ...register('email') } />
                { errors.email && <span className={ styles.error }>{ errors.email.message }</span> }
            </div>

            <div className={ styles.inputGroup }>
                <label htmlFor="password">Password</label>
                <input id="password" type="password" { ...register('password') } />
                { errors.password && <span className={ styles.error }>{ errors.password.message }</span> }
            </div>

            <button
                type="submit"
                className={ styles.submitButton }
                disabled={ requestStatus === 'pending' }
            >
                { requestStatus === 'pending' ? 'Signing in...' : 'Log in' }
            </button>

            <div className={ styles.redirect }>
                No account? <Link to="/register">Sign up</Link>
            </div>

            <div className={ styles.redirect }>
                Forgot password? <Link to="/forgot-password">Reset</Link>
            </div>
        </form>
    );
};

export default LoginForm;
