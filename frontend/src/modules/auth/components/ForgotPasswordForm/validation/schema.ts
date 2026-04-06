import { z } from 'zod';

export const forgotPasswordSchema = z.object({
    email: z
        .string()
        .min(1, 'Це поле обовʼязкове')
        .email('Введіть коректний email'),
});
