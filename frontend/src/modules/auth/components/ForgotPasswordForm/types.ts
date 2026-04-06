import { UseFormReturn } from 'react-hook-form';

export interface ForgotPasswordFormData {
    email: string;
}

export interface ForgotPasswordFormProps {
    form: UseFormReturn<ForgotPasswordFormData>;
    onSubmit: (data: ForgotPasswordFormData) => Promise<void>;
    requestStatus: string;
}
