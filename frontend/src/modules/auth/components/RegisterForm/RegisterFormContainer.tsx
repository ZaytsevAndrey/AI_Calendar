import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { registerUser } from 'modules/auth/actions/registerUser';
import { getRegisterStatus, getAuthError, isAuthenticated } from 'modules/auth/selectors/authSelectors';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

import { RegisterFormData } from './types';
import { registerSchema } from './validation/schema';
import RegisterForm from './RegisterForm';
import setBackendErrors from 'modules/common/utils/setBackendErrors';
import { showErrorToast } from '../../../../utils/toast';

const RegisterFormContainer: React.FC = () => {
    const dispatch = useDispatch<any>();
    const navigate = useNavigate();

    const registerStatus = useSelector(getRegisterStatus) || requestsStatuses.default;
    const backendError = useSelector(getAuthError) as Record<string, string> | null;
    const isUserAuthenticated = useSelector(isAuthenticated);

    console.log('Register form container rendered:', { 
        registerStatus, 
        isUserAuthenticated 
    });

    const {
        setError,
    } = useForm<RegisterFormData>({
        resolver: zodResolver(registerSchema),
    });

    const onSubmit = async (data: RegisterFormData) => {
        console.log('Register form submitted:', data);
        try {
            await dispatch(registerUser(data));
            navigate('/login');
        } catch (error: any) {
            const errorMessage = error?.response?.data?.message || 'Registration failed. Please try again.';
            showErrorToast(errorMessage);
        }
    };

    useEffect(() => {
        if (backendError) {
            setBackendErrors(backendError, setError);
        }
    }, [backendError, setError]);

    useEffect(() => {
        if (registerStatus === requestsStatuses.success) {
            console.log('Register success - redirecting to login');
            navigate('/login');
        }
    }, [registerStatus, navigate]);

    useEffect(() => {
        if (isUserAuthenticated) {
            navigate('/');
        }
    }, [isUserAuthenticated, navigate]);

    return (
        <RegisterForm
            onSubmit={onSubmit}
            requestStatus={registerStatus}
        />
    );
};

export default RegisterFormContainer;
