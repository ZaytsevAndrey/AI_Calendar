# AI Calendar Planner 🗓️

**AI Calendar Planner** — це сучасний веб-додаток для автоматичного планування часу з інтеграцією Google Calendar. Система допомагає користувачам ефективно організовувати свій день, враховуючи їх життєвий ритм, категорії задач та пріоритети.

## 🚀 Основні можливості

### ✅ Реалізовані функції
- **🔐 Повна система аутентифікації** - реєстрація, вхід, відновлення паролю
- **⏰ Управління налаштуваннями часу** - час пробудження/сну з auto-save
- **📅 Інтеграція з Google Calendar** - OAuth 2.0 підключення та управління
- **📋 Управління категоріями** - створення та редагування категорій задач
- **✅ Управління задачами** - повний CRUD для задач
- **🎨 Сучасний UI/UX** - Material-UI компоненти з responsive дизайном
- **🔄 Auto-save функціональність** - автоматичне збереження змін
- **📱 Адаптивний дизайн** - працює на всіх пристроях

### 🛠 В розробці
- **🤖 AI двигун планування** - автоматичне розподілення задач
- **📊 Статистика та аналітика** - графіки продуктивності
- **📅 Розширені функції календаря** - drag & drop, навігація
- **🧪 Тестування** - unit, integration та E2E тести

## 🏗️ Архітектура

### Frontend
- **React 18** + **TypeScript** - сучасний UI фреймворк
- **Material-UI (MUI)** - компонентна бібліотека
- **Redux Toolkit** - управління станом
- **React Query** - управління серверним станом
- **React Router** - навігація
- **React Hook Form** - управління формами

### Backend
- **NestJS** + **TypeScript** - серверний фреймворк
- **TypeORM** - ORM для роботи з базою даних
- **SQLite** - база даних (для MVP)
- **JWT** - аутентифікація
- **Google OAuth 2.0** - інтеграція з Google Calendar
- **Swagger** - API документація

## 📦 Швидкий старт

### Передумови
- Node.js 18+
- npm або yarn
- Google OAuth 2.0 credentials

### Встановлення

1. **Клонуйте репозиторій**
```bash
git clone https://github.com/your-username/ai-calendar-planner.git
cd ai-calendar-assistant
```

2. **Встановіть залежності**
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

3. **Налаштуйте змінні середовища**

**Backend (.env):**
```env
# Database
DATABASE_URL=sqlite:./database.sqlite

# JWT
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/google-calendar/callback

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-email-password
```

**Frontend (.env):**
```env
REACT_APP_API_URL=http://localhost:3001
```

4. **Запустіть проекти**

**Backend:**
```bash
cd backend
npm run start:dev
```

**Frontend:**
```bash
cd frontend
npm start
```

5. **Відкрийте додаток**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API документація: http://localhost:3001/api

## 📚 Документація

- **[Основна документація](documentation/AI-Calendar-Planner-Project-Documentation.md)** - повний опис проекту
- **[Backend документація](backend/docs/project-overview.md)** - детальний опис backend
- **[API документація](http://localhost:3001/api)** - Swagger UI (після запуску)

## 🗂️ Структура проекту

```
ai-calendar-assistant/
├── backend/                 # NestJS backend
│   ├── src/
│   │   ├── modules/         # Модулі додатку
│   │   │   ├── auth/        # Аутентифікація
│   │   │   ├── users/       # Користувачі
│   │   │   ├── user-settings/ # Налаштування
│   │   │   ├── categories/  # Категорії
│   │   │   ├── tasks/       # Задачі
│   │   │   └── google-calendar/ # Google Calendar
│   │   └── common/          # Спільні утиліти
│   └── docs/                # Backend документація
├── frontend/                # React frontend
│   ├── src/
│   │   ├── modules/         # Модулі додатку
│   │   │   ├── auth/        # Аутентифікація
│   │   │   ├── user-settings/ # Налаштування
│   │   │   ├── categories/  # Категорії
│   │   │   ├── tasks/       # Задачі
│   │   │   └── calendar/    # Календар
│   │   ├── api/             # API клієнти
│   │   └── store/           # Redux store
│   └── public/              # Статичні файли
├── documentation/           # Основна документація
└── scripts/                 # Допоміжні скрипти
```

## 🔧 Розробка

### Команди

**Backend:**
```bash
npm run start:dev    # Розробка з hot reload
npm run build        # Збірка
npm run test         # Unit тести
npm run test:e2e     # E2E тести
npm run test:cov     # Покриття тестами
```

**Frontend:**
```bash
npm start            # Розробка
npm run build        # Збірка
npm test             # Тести
npm run lint         # Лінтер
```

### Технології розробки
- **TypeScript** - типізація
- **ESLint** + **Prettier** - форматування коду
- **Jest** - тестування
- **Docker** - контейнеризація

## 🔐 Безпека

- **JWT токени** для аутентифікації
- **bcrypt** для хешування паролів
- **Email верифікація** для реєстрації
- **Google OAuth 2.0** для безпечної інтеграції
- **Валідація вхідних даних** на всіх рівнях
- **CORS** налаштування
- **Захист від SQL ін'єкцій**

## 📊 База даних

### Схема
- **Users** - користувачі
- **User Settings** - налаштування користувачів
- **Categories** - категорії задач
- **Tasks** - задачі

### Дефолтні значення
- **Wake Time:** 07:00
- **Sleep Time:** 22:00
- **Work Block Duration:** 25 хвилин
- **Break Duration:** 5 хвилин
- **Lunch Duration:** 60 хвилин

## 🚀 Розгортання

### Docker
```bash
# Backend
cd backend
docker build -t ai-calendar-backend .
docker run -p 3001:3001 ai-calendar-backend

# Frontend
cd frontend
docker build -t ai-calendar-frontend .
docker run -p 3000:3000 ai-calendar-frontend
```

### Production
- Налаштуйте змінні середовища для production
- Використовуйте PostgreSQL замість SQLite
- Налаштуйте SSL сертифікати
- Налаштуйте моніторинг та логування

## 🤝 Внесок

1. Fork проект
2. Створіть feature branch (`git checkout -b feature/amazing-feature`)
3. Commit зміни (`git commit -m 'Add amazing feature'`)
4. Push до branch (`git push origin feature/amazing-feature`)
5. Відкрийте Pull Request

## 📄 Ліцензія

Цей проект ліцензований під MIT License - дивіться файл [LICENSE](LICENSE) для деталей.

## 📞 Підтримка

- **Email:** support@aicalendarplanner.com
- **Issues:** [GitHub Issues](https://github.com/your-username/ai-calendar-planner/issues)
- **Documentation:** [Документація](documentation/)

## 🎯 Roadmap

### Phase 1: MVP ✅
- [x] Базова аутентифікація
- [x] Управління налаштуваннями
- [x] Google Calendar інтеграція
- [x] Управління категоріями та задачами

### Phase 2: AI Engine 🚧
- [ ] AI двигун планування
- [ ] Автоматичне розподілення задач
- [ ] Оптимізація часу

### Phase 3: Analytics 📊
- [ ] Статистика продуктивності
- [ ] Графіки та діаграми
- [ ] Звіти

### Phase 4: Advanced Features 🚀
- [ ] Мобільний додаток
- [ ] Командна робота
- [ ] Інтеграції (Telegram, Notion)

---

**Розроблено з ❤️ для ефективного планування часу**

**Last Updated:** December 2024  
**Version:** 1.0.0  
**Status:** MVP Development Phase 