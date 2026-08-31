export interface LoginFormProps {
    requestStatus: string;
    errorMessage?: string | null;
    onGoogleSignIn: () => void;
}
