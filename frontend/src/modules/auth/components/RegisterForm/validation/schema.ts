import { z } from 'zod';

export const registerSchema = z
    .object({
        email: z.string().email('Invalid email format'),
        password: z.string().min(6, 'At least 6 characters'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
    });

export type RegisterSchema = z.infer<typeof registerSchema>;

export default registerSchema;
