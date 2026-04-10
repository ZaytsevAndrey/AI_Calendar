import { z } from 'zod';

const schema = z.object({
    email: z.string().email('Invalid email'),
});

export default schema;
export type EmailVerificationFormData = z.infer<typeof schema>;
