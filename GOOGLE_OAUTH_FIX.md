# 🔧 Вирішення проблеми Google OAuth

## 🚨 Проблема: `redirect_uri_mismatch`

Помилка `redirect_uri_mismatch` означає, що URL перенаправлення в Google Console не співпадає з тим, що очікує додаток.

## 🛠 Кроки для вирішення:

### 1. Перевірте поточні налаштування

Відкрийте в браузері: http://localhost:3000/google-calendar/test-config

Це покаже вам поточні налаштування Google OAuth.

### 2. Налаштуйте Google Cloud Console

1. Перейдіть на [Google Cloud Console](https://console.cloud.google.com/)
2. Виберіть ваш проект
3. Перейдіть до "APIs & Services" > "Credentials"
4. Знайдіть ваш OAuth 2.0 Client ID і натисніть на нього
5. У розділі "Authorized redirect URIs" додайте:
   ```
   http://localhost:3000/google-calendar/callback
   ```
6. Збережіть зміни

### 3. Створіть .env файл

Створіть файл `backend/.env` з наступним вмістом:

```env
JWT_SECRET=supersecretkey
JWT_EXPIRES_IN=3600s

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_actual_client_id_here
GOOGLE_CLIENT_SECRET=your_actual_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/google-calendar/callback

# Frontend URL
FRONTEND_URL=http://localhost:3001
```

### 4. Перезапустіть backend

```bash
npm run start:backend
```

### 5. Перевірте логування

Тепер backend має детальне логування. Перевірте консоль backend для діагностики:

- Ініціалізація Google OAuth2
- Генерація auth URL
- Обробка callback
- Помилки та їх деталі

### 6. Тестування

1. Зайдіть на http://localhost:3001
2. Увійдіть в систему
3. Перейдіть до Settings
4. Натисніть "Connect Google Calendar"

## 🔍 Діагностика

### Перевірте URL перенаправлення:
- Google Console: `http://localhost:3000/google-calendar/callback`
- Backend .env: `GOOGLE_REDIRECT_URI=http://localhost:3000/google-calendar/callback`

### Перевірте Client ID та Secret:
- Переконайтеся, що вони правильно скопійовані з Google Console
- Не містять зайвих пробілів

### Перевірте API:
- Google Calendar API повинен бути увімкнений
- OAuth consent screen повинен бути налаштований

## 📞 Якщо проблема залишається:

1. Перевірте логування в консолі backend
2. Перевірте endpoint http://localhost:3000/google-calendar/test-config
3. Переконайтеся, що всі змінні середовища правильно встановлені
4. Перезапустіть backend після зміни .env файлу 