import { z } from 'zod';

export const registerSchema = z
    .object({
        email: z.string().email('Невірний формат email'),
        password: z.string().min(6, 'Мінімум 6 символів'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: 'Паролі не співпадають',
        path: ['confirmPassword'],
    });

export type RegisterSchema = z.infer<typeof registerSchema>;

export default registerSchema;
