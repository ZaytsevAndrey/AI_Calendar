import { z } from 'zod';

const loginSchema = z.object({
    email: z.string().email('Enter a valid email'),
    password: z.string().min(6, 'At least 6 characters'),
});

export default loginSchema;
export type LoginFormData = z.infer<typeof loginSchema>;
