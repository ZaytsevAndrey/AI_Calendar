import {
    UseFormRegister,
    FieldErrors,
} from 'react-hook-form';
import { LoginFormData } from './validation/schema';

export interface LoginFormProps {
    register: UseFormRegister<LoginFormData>;
    errors: FieldErrors<LoginFormData>;
    requestStatus: string;
    onSubmit: React.FormEventHandler<HTMLFormElement>;
    isSubmitting: boolean;
}
