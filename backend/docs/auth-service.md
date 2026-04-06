# Auth Service (оновлено липень 2024)

## Призначення
Аутентифікація користувачів через email, JWT, refresh токени.

## Основний функціонал
- Реєстрація з email-підтвердженням
- Логін/логаут
- JWT-авторизація
- Refresh токени
- Відновлення паролю
- Захищені маршрути (Guard)
- Інтеграція з фронтом (Redux, ProtectedRoute)

## Основні ендпоінти
- POST /auth/register
- POST /auth/login
- POST /auth/refresh
- POST /auth/logout
- POST /auth/forgot-password
- POST /auth/reset-password

## Особливості
- Всі паролі хешуються (bcrypt)
- Email verification через email service
- JWT зберігається у httpOnly cookie
- Refresh токен — окремий cookie

**Останнє оновлення:** Липень 2024
**Статус:** Працює, інтегровано з фронтом 