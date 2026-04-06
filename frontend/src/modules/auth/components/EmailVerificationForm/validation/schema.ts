import { z } from 'zod';

const schema = z.object({
    email: z.string().email('Некоректний email'),
});

export default schema;
export type EmailVerificationFormData = z.infer<typeof schema>;
