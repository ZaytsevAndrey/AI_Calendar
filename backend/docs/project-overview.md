# AI Calendar Assistant — Огляд проекту (оновлено липень 2024)

## Призначення
Автоматичне планування Google Calendar з урахуванням фаз дня, задач, налаштувань користувача.

## Архітектура
- Frontend: React, Redux Toolkit, TypeScript, MUI
- Backend: NestJS, TypeORM, SQLite, JWT, Google OAuth, Swagger

## Основні модулі
- Auth (JWT, email, refresh)
- User Settings (wakeTime, sleepTime, Google Calendar)
- Phases (CRUD, валідація, календар, модальні вікна)
- Tasks (CRUD, прив’язка до фаз)
- Google Calendar (OAuth, sync)

## Як це працює
- Користувач налаштовує час сну/пробудження
- Створює фази дня (з валідацією)
- Всі фази відображаються у grid та календарі (PhasesCalendar)
- Задачі можна створювати, редагувати, видаляти, прив’язувати до фаз
- Google Calendar підключається/відключається

## API
- /auth/*
- /user-settings
- /phases
- /tasks
- /google-calendar/*

## Особливості
- Всі часові розрахунки враховують wakeTime/sleepTime
- Валідація фаз: не можна створити фазу, яка перетинається з іншою фазою або зі сном
- PhasesCalendar — інтерактивний календар фаз
- Модульна структура, утиліти для часу

**Останнє оновлення:** Липень 2024
**Статус:** MVP працює, інтеграція phases/tasks/userSettings/Google Calendar 

## Phases (Фази дня)
- CRUD фічі (створення, редагування, видалення, перегляд)
- Валідація перетинів, врахування сну (userSettings)
- Відображення у grid та інтерактивному календарі (PhasesCalendar)
- Модальні вікна для створення/редагування
- Всі часові розрахунки враховують wakeTime/sleepTime
- Утиліти для роботи з часом винесені в окремі файли 