import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { forgotPassword } from 'modules/auth/actions/forgotPassword';
import { getForgotPasswordStatus } from 'modules/auth/selectors/forgotPasswordSelectors';
// import { FORGOT_PASSWORD_EMAIL_SENT } from 'modules/common/constants/apiErrorCodes';
// apiErrorMessages import removed as it's not used
import setBackendErrors from 'modules/common/utils/setBackendErrors';
import requestsStatuses from 'modules/common/constants/requestsStatuses';

import ForgotPasswordForm from './ForgotPasswordForm';

const schema = z.object({
    email: z.string().email('Невірний формат email'),
});

export type ForgotPasswordFormData = z.infer<typeof schema>;

const ForgotPasswordFormContainer = () => {
    const dispatch = useDispatch<any>();
    const navigate = useNavigate();

    const requestStatus = useSelector(getForgotPasswordStatus);

    const {
        register,
        handleSubmit,
        formState: { errors },
        setError,
    } = useForm<ForgotPasswordFormData>({
        resolver: zodResolver(schema),
    });

    const onSubmit = (data: ForgotPasswordFormData) => {
        dispatch(forgotPassword(data)).then((response: any) => {
            if (response?.error) {
                setBackendErrors(response.payload, setError);
                return;
            }
        }).catch((error: unknown) => {
            if (error && typeof error === 'object' && 'fields' in error) {
                setBackendErrors((error as any).fields ?? {}, setError);
            }
        });
    };

    useEffect(() => {
        if (requestStatus === requestsStatuses.success) {
            navigate('/email-verification');
        }
    }, [requestStatus, navigate]);

    return (
        <ForgotPasswordForm
            onSubmit={ handleSubmit(onSubmit) }
            register={ register }
            errors={ errors }
            requestStatus={ requestStatus }
        />
    );
};

export default ForgotPasswordFormContainer;
