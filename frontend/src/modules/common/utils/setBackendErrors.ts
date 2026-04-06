import { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import apiErrorMessages from 'modules/common/constants/apiErrorMessages';

export default function setBackendErrors<TFieldValues extends FieldValues>(
    backendErrors: Record<string, string>,
    setError: UseFormSetError<TFieldValues>
) {
    Object.entries(backendErrors).forEach(([field, code]) => {
        const message = apiErrorMessages[code] || 'Помилка';
        setError(field as Path<TFieldValues>, {
            type: 'manual',
            message,
        });
    });
}
