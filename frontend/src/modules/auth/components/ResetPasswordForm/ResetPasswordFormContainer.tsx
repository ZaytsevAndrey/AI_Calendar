import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';

import ResetPasswordForm from './ResetPasswordForm';
import { resetPassword } from 'modules/auth/actions/resetPassword';
import { getResetPasswordStatus } from 'modules/auth/selectors/resetPasswordSelectors';
import setBackendErrors from 'modules/common/utils/setBackendErrors';
import { getApiErrorMessage } from 'modules/common/constants/apiErrorMessages';
import { ResetPasswordFormData } from './types';

const ResetPasswordFormContainer = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const requestStatus = useSelector(getResetPasswordStatus);
    const [backendError, setBackendError] = useState<string | null>(null);

    const {
        register,
        handleSubmit,
        setError,
        formState: { errors },
        control
    } = useForm<ResetPasswordFormData>();

    const searchParams = new URLSearchParams(location.search);
    const token = searchParams.get('token');
 
    console.log(token);

    const onSubmit = async (data: ResetPasswordFormData) => {
        if (!token) return;

        try {
            await dispatch<any>(
                resetPassword({
                    token: token,
                    newPassword: data.newPassword,
                })
            );
            navigate('/login');
        } catch (error: any) {
            const errorCode = error?.code as string;
            setBackendError(errorCode ?? null);
            setBackendErrors(error?.fields ?? {}, setError);
        }
    };

    const errorMessage = backendError ? getApiErrorMessage(backendError) : null;

    return (
        <ResetPasswordForm
            onSubmit={ handleSubmit(onSubmit) }
            requestStatus={ requestStatus }
            register={ register }
            errors={ errors }
            backendError={ errorMessage }
            control={ control }
        />
    );
};

export default ResetPasswordFormContainer;
