import { z } from 'zod';

const loginSchema = z.object({
    email: z.string().email('Введіть коректний email'),
    password: z.string().min(6, 'Мінімум 6 символів'),
});

export default loginSchema;
export type LoginFormData = z.infer<typeof loginSchema>;
