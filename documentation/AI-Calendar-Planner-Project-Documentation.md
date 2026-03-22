# AI Calendar Assistant — Документація (оновлено липень 2024)

## 1. Призначення
AI Calendar Assistant — сервіс для автоматичного планування Google Calendar користувача з урахуванням фаз дня, задач, пріоритетів, дедлайнів і персональних налаштувань часу.

## 2. Архітектура
- **Frontend:** React 18, Redux Toolkit, TypeScript, Material-UI, React Query, React Router, React Hook Form, Toastify, Axios, Webpack.
- **Backend:** NestJS, TypeScript, TypeORM, SQLite, JWT, Passport, Google OAuth 2.0, Google Calendar API, Swagger, Jest.

## 3. Основні модулі
- **Auth:** JWT-авторизація, email-підтвердження, refresh токени, захищені маршрути.
- **User Settings:** Зберігання часу сну (sleepTime), пробудження (wakeTime), автозбереження, інтеграція з Google Calendar.
- **Phases:** CRUD фаз, валідація перетинів, врахування сну, інтерактивний календар фаз (PhasesCalendar), модальні вікна для створення/редагування.
- **Tasks:** CRUD задач, прив’язка до фаз, статуси, дедлайни.
- **Google Calendar:** OAuth 2.0, синхронізація подій, перевірка підключення, відключення.

## 4. Як це працює зараз
- Користувач реєструється, налаштовує час сну/пробудження.
- Створює фази дня (робота, спорт, відпочинок) через модальне вікно з валідацією.
- Всі фази відображаються у grid та інтерактивному календарі (PhasesCalendar), який враховує wakeTime/sleepTime.
- Задачі можна створювати, редагувати, видаляти, прив’язувати до фаз.
- Google Calendar можна підключити/відключити, події синхронізуються.
- Всі налаштування зберігаються автоматично, є toast-повідомлення.

## 5. API (основні ендпоінти)
- `/auth/*` — реєстрація, логін, refresh, logout, відновлення паролю.
- `/user-settings` — отримання/оновлення налаштувань користувача.
- `/phases` — CRUD фаз, отримання фаз для календаря, sleep time phases.
- `/tasks` — CRUD задач.
- `/google-calendar/*` — OAuth, перевірка підключення, синхронізація.

## 6. Важливі особливості
- Всі часові розрахунки враховують wakeTime/sleepTime користувача.
- Валідація фаз: не можна створити фазу, яка перетинається з іншою фазою або зі сном.
- PhasesCalendar — інтерактивний календар фаз, який динамічно підлаштовується під налаштування користувача.
- Модульна структура, утиліти для роботи з часом винесені в окремі файли.

## 7. Як розгорнути проект
### Backend:
```bash
cd backend
npm install
npm run start:dev
```
Swagger: http://localhost:3001/api

### Frontend:
```bash
cd frontend
npm install
npm run start
```
App: http://localhost:3000

## 8. Де шукати деталі
- `documentation/AI-Calendar-Planner-Project-Documentation.md` — загальна архітектура, фічі, API.
- `backend/docs/` — специфікація бекенд-модулів, auth, phases, tasks, user-settings, google-calendar.
- `frontend/README.md` — запуск і деплой фронтенду.
- `backend/README.md` — запуск і деплой бекенду.

**Останнє оновлення:** Липень 2024
**Статус:** Активна розробка, MVP працює, фази та задачі інтегровані, Google Calendar підключається.
