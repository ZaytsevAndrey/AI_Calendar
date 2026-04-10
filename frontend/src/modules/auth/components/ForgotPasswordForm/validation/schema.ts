import { z } from 'zod';

export const forgotPasswordSchema = z.object({
    email: z
        .string()
        .min(1, 'This field is required')
        .email('Enter a valid email'),
});
