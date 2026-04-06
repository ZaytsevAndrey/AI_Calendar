# Google OAuth & Calendar Integration (оновлено липень 2024)

## Призначення
Інтеграція з Google Calendar через OAuth 2.0 для автоматичного планування подій.

## Як це працює
- Користувач підключає Google Calendar через OAuth
- Токени зберігаються у базі
- Події синхронізуються через Google Calendar API
- Можна відключити календар

## Основні ендпоінти
- GET /google-calendar/auth-url
- GET /google-calendar/callback
- GET /google-calendar/check-connection
- POST /google-calendar/disconnect

## Flow
1. Користувач натискає "Підключити Google Calendar"
2. Відбувається редирект на Google OAuth
3. Після авторизації — редирект назад у додаток
4. Токени зберігаються, статус підключення оновлюється
5. Можна відключити календар через кнопку

**Останнє оновлення:** Липень 2024
**Статус:** Працює, інтегровано з фронтом 