export interface RegisterFormProps {
    onSubmit: (data: { email: string; password: string; confirmPassword: string }) => void;
    requestStatus: string;
    backendError?: string | null;
}

export interface RegisterFormData {
    email: string;
    password: string;
    confirmPassword: string;
}
