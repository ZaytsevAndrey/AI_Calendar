import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';

import { loginUser } from 'modules/auth/actions/loginUser';
import requestsStatuses from 'modules/common/constants/requestsStatuses';
import { getLoginStatus, getAuthError } from 'modules/auth/selectors/authSelectors';
import { UserSettingsApi } from '../../../../api/user-settings.api';

import LoginForm from './LoginForm';
import loginSchema, { LoginFormData } from './validation/schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import setBackendErrors from 'modules/common/utils/setBackendErrors';

const LoginFormContainer = () => {
    const dispatch = useDispatch<any>();
    const navigate = useNavigate();

    const loginStatus = useSelector(getLoginStatus);
    const backendError = useSelector(getAuthError);

    const {
        handleSubmit,
        setError,
        formState: { isSubmitting, errors },
        ...form
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
    });

    useEffect(() => {
        if (loginStatus === requestsStatuses.success) {
            console.log('Login successful, checking required settings...');
            // Перевіряємо required settings після успішного логіну
            const checkRequiredSettings = async () => {
                try {
                    console.log('Calling UserSettingsApi.checkRequiredSettings()...');
                    const response = await UserSettingsApi.checkRequiredSettings();
                    const hasRequiredSettings = response.requiredFilled;
                    console.log('Required settings check result:', hasRequiredSettings);
                    
                    // Якщо всі required settings заповнені - на головну сторінку
                    // Інакше - на сторінку налаштувань
                    const redirectUrl = hasRequiredSettings ? '/' : '/settings';
                    console.log('Redirecting to:', redirectUrl);
                    navigate(redirectUrl);
                } catch (error) {
                    console.error('Error checking required settings:', error);
                    // Якщо не можемо перевірити - перенаправляємо на налаштування
                    console.log('Redirecting to /settings due to error');
                    navigate('/settings');
                }
            };

            checkRequiredSettings();
        }
    }, [loginStatus, navigate]);

    useEffect(() => {
        if (backendError) {
            setBackendErrors<LoginFormData>({ general: backendError }, setError);
        }
    }, [backendError, setError]);

    const onSubmit = (data: LoginFormData) => {
        dispatch(loginUser(data));
    };

    return (
        <LoginForm
            { ...form }
            onSubmit={ handleSubmit(onSubmit) }
            requestStatus={ loginStatus }
            isSubmitting={ isSubmitting }
            errors={ errors }
        />
    );
};

export default LoginFormContainer;
