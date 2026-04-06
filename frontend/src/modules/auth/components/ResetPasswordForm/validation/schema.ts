import { z } from 'zod';

const schema = z
    .object({
        password: z.string().min(6, 'Пароль повинен містити щонайменше 6 символів'),
        confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
        message: 'Паролі не співпадають',
        path: ['confirmPassword'],
    });

export default schema;
