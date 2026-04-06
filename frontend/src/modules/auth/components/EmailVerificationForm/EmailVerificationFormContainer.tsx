import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';

import { AppDispatch } from 'store/types';
import { sendVerificationCode } from 'modules/auth/actions/sendVerificationCode';
import { getEmailVerificationStatus } from 'modules/auth/selectors/emailVerificationSelectors';
import setBackendErrors from 'modules/common/utils/setBackendErrors';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

import EmailVerificationForm from './EmailVerificationForm';
import { EmailVerificationFormData } from './types';
import schema from './validation/schema';

const EmailVerificationFormContainer = () => {
    const dispatch = useDispatch<any>();
    const navigate = useNavigate();

    const requestStatus = useSelector(getEmailVerificationStatus);

    const {
        register,
        handleSubmit,
        formState: { errors },
        setError,
    } = useForm<EmailVerificationFormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = async (data: EmailVerificationFormData) => {
        try {
            await dispatch(sendVerificationCode({ email: data.email }));
            navigate('/reset-password');
        } catch (error: any) {
            setBackendErrors(error?.fields ?? {}, setError);
        }
    };

    useEffect(() => {
        if (requestStatus === requestsStatuses.success) {
            navigate('/reset-password');
        }
    }, [requestStatus, navigate]);

    return (
        <EmailVerificationForm
            onSubmit={ onSubmit }
            handleSubmit = { handleSubmit }
            register={ register }
            errors={ errors }
            requestStatus={ requestStatus }
        />
    );
};

export default EmailVerificationFormContainer;
