# AI Calendar Planner — Project Documentation

## 1️⃣ Project Purpose
AI Calendar Planner — сервіс, який автоматично організовує Google Calendar користувача, враховуючи його життєвий ритм, категорії часу, пріоритети задач і дедлайни. Основна мета — зняти рутину ручного планування та допомогти зосередитися на виконанні задач.

## 2️⃣ Concept
Користувач задає:
- Wake/sleep time (час пробудження та сну)
- Fixed time blocks (робота, спорт, відпочинок тощо)
- Categories for tasks (категорії задач)
- Google Calendar integration (інтеграція з Google Calendar)

AI автоматично вставляє задачі в календар згідно правил:
- Категорія задачі
- Пріоритет
- Дедлайн
- Дроблення задачі (якщо дозволено)

Сервіс має інтеграцію з Google Calendar, дозволяє manual override, формує статистику.

## 3️⃣ Unique Selling Proposition
- AI-First Time Management
- Category-based Scheduling
- User-driven rules
- Google Calendar bi-directional sync
- Visualization + Advanced Statistics
- Smart auto-save functionality
- Modern UI/UX with MUI components

## 4️⃣ Architecture Overview
- **Frontend:** React + Redux + TypeScript + Material-UI + React Query
- **Backend:** NestJS + JWT + Google OAuth + Google Calendar API + TypeORM
- **Database:** SQLite (для MVP)
- **AI Core:** custom rule-based engine
- **DevOps:** GitHub + CI/CD + Docker

## 5️⃣ Current Implementation Status

### ✅ Completed Features

#### 🏗 Infrastructure & Setup
- ✅ Frontend + Backend projects prepared
- ✅ Stack + structure fully set up
- ✅ CORS + Swagger + Jest + Redux Persist
- ✅ TypeScript configuration
- ✅ ESLint + Prettier setup
- ✅ Webpack configuration
- ✅ Environment variables management

#### 🔐 Authentication System
- ✅ **Backend Auth Module:**
  - User registration with email verification
  - JWT-based authentication
  - Password reset functionality
  - Email service integration
  - Token refresh mechanism
  - User management

- ✅ **Frontend Auth Module:**
  - Login form with validation
  - Registration form with email verification
  - Forgot password flow
  - Reset password functionality
  - Protected routes
  - Redux state management for auth
  - Auto-logout on token expiration

#### 👤 User Management
- ✅ **Backend:**
  - User entity with TypeORM
  - User settings management
  - Default settings creation
  - Settings validation

- ✅ **Frontend:**
  - User settings page
  - Settings form with auto-save
  - Real-time validation
  - Settings persistence

#### ⏰ User Settings & Time Management
- ✅ **Backend:**
  - User settings entity
  - Default time values (wake time: 07:00, sleep time: 22:00)
  - Settings CRUD operations
  - Auto-fill missing settings with defaults

- ✅ **Frontend:**
  - Modern settings UI with Material-UI
  - MUI TimePicker with AM/PM format
  - Auto-save functionality (1-second delay)
  - Smart initialization (prevents auto-save on initial load)
  - Responsive design
  - Toast notifications

#### 📅 Google Calendar Integration
- ✅ **Backend:**
  - Google OAuth 2.0 integration
  - Google Calendar API integration
  - Token management and refresh
  - Calendar connection status checking
  - Disconnect functionality
  - Proper redirect handling

- ✅ **Frontend:**
  - Google Calendar connection UI
  - OAuth flow with proper redirects
  - Connection status display
  - Disconnect button
  - Loading states and error handling

#### 📋 Categories Management
- ✅ **Backend:**
  - Categories entity
  - CRUD operations for categories
  - Category validation
  - User-specific categories

- ✅ **Frontend:**
  - Categories page
  - Category creation/editing forms
  - Categories list with actions
  - Category management UI

#### ✅ Tasks Management
- ✅ **Backend:**
  - Tasks entity with full fields
  - Task CRUD operations
  - Task validation
  - User-task relationships

- ✅ **Frontend:**
  - Tasks page
  - Task creation/editing forms
  - Task list with actions
  - Task management UI

#### 🎨 UI/UX Features
- ✅ **Material-UI Integration:**
  - Modern component library
  - Responsive design
  - Consistent styling
  - Dark/light theme support

- ✅ **User Experience:**
  - Loading states
  - Error handling
  - Toast notifications
  - Form validation
  - Auto-save functionality
  - Smooth transitions

### 🛠 In Progress / Next Features

#### Stage 6: AI Scheduling Engine
- 🔄 **Backend:**
  - AI rule-based engine (respect user rules)
  - Auto-schedule tasks + reschedule after changes
  - Task prioritization algorithm
  - Time block optimization

#### Stage 7: Advanced Calendar Features
- 🔄 **Frontend:**
  - Daily/Weekly calendar view
  - Calendar event management
  - Drag & drop functionality
  - Calendar navigation

#### Stage 8: Statistics & Analytics
- 🔄 **Frontend:**
  - Dashboard with charts
  - Productivity analytics
  - Time tracking statistics
  - Performance metrics

#### Stage 9: Testing & Optimization
- 🔄 **Comprehensive Testing:**
  - Unit tests for all modules
  - Integration tests
  - End-to-end testing
  - Performance optimization

### 📝 Backlog (Post-MVP)
- AI recommendations (reschedule hints)
- Telegram / Notion integrations
- Advanced statistics dashboards
- Mobile + Desktop apps
- Multi-user mode (Teams)
- Advanced scheduling algorithms
- Machine learning integration

## 6️⃣ Technical Stack Details

### Frontend Stack
- **React 18** - UI framework
- **TypeScript** - Type safety
- **Material-UI (MUI)** - Component library
- **Redux Toolkit** - State management
- **React Query** - Server state management
- **React Router** - Navigation
- **React Hook Form** - Form management
- **React Toastify** - Notifications
- **Axios** - HTTP client
- **Webpack** - Build tool

### Backend Stack
- **NestJS** - Framework
- **TypeScript** - Type safety
- **TypeORM** - Database ORM
- **SQLite** - Database
- **JWT** - Authentication
- **Passport** - Authentication strategy
- **Google OAuth 2.0** - OAuth integration
- **Google Calendar API** - Calendar integration
- **Swagger** - API documentation
- **Jest** - Testing framework

### Development Tools
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **Git** - Version control
- **Docker** - Containerization
- **GitHub** - Repository hosting

## 7️⃣ API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/refresh` - Token refresh
- `POST /auth/logout` - User logout
- `POST /auth/forgot-password` - Forgot password
- `POST /auth/reset-password` - Reset password

### User Settings
- `GET /user-settings` - Get user settings
- `PATCH /user-settings` - Update user settings
- `GET /user-settings/required` - Check required settings

### Categories
- `GET /categories` - Get all categories
- `POST /categories` - Create category
- `PATCH /categories/:id` - Update category
- `DELETE /categories/:id` - Delete category

### Tasks
- `GET /tasks` - Get all tasks
- `POST /tasks` - Create task
- `PATCH /tasks/:id` - Update task
- `DELETE /tasks/:id` - Delete task

### Google Calendar
- `GET /google-calendar/auth-url` - Get OAuth URL
- `GET /google-calendar/callback` - OAuth callback
- `GET /google-calendar/check-connection` - Check connection
- `POST /google-calendar/disconnect` - Disconnect calendar

## 8️⃣ Database Schema

### Users
- `id` (UUID, Primary Key)
- `email` (String, Unique)
- `password` (String, Hashed)
- `isVerified` (Boolean)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### User Settings
- `id` (UUID, Primary Key)
- `userId` (UUID, Foreign Key)
- `wakeTime` (Time)
- `sleepTime` (Time)
- `defaultWorkBlockDuration` (Integer)
- `defaultBreakDuration` (Integer)
- `defaultLunchDuration` (Integer)
- `preferredLunchTime` (Time)
- `weekendWorkEnabled` (Boolean)
- `googleCalendarLinked` (Boolean)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### Categories
- `id` (UUID, Primary Key)
- `userId` (UUID, Foreign Key)
- `name` (String)
- `color` (String)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

### Tasks
- `id` (UUID, Primary Key)
- `userId` (UUID, Foreign Key)
- `categoryId` (UUID, Foreign Key)
- `name` (String)
- `description` (Text)
- `estimatedTime` (Integer)
- `priority` (Enum)
- `deadline` (DateTime)
- `allowSplit` (Boolean)
- `recurring` (Boolean)
- `createdAt` (DateTime)
- `updatedAt` (DateTime)

## 9️⃣ Security Features

### Authentication & Authorization
- JWT-based authentication
- Token refresh mechanism
- Password hashing with bcrypt
- Email verification
- Protected routes
- Role-based access control

### Data Protection
- Input validation
- SQL injection prevention
- XSS protection
- CORS configuration
- Rate limiting
- Secure headers

### OAuth Security
- Google OAuth 2.0 integration
- Secure token storage
- Token refresh handling
- Proper redirect URIs

## 🔟 Development Guidelines

### Code Style
- TypeScript strict mode
- ESLint configuration
- Prettier formatting
- Consistent naming conventions
- Component-based architecture

### Testing Strategy
- Unit tests for services
- Integration tests for controllers
- E2E tests for critical flows
- Test coverage requirements

### Git Workflow
- Feature branch workflow
- Pull request reviews
- Commit message conventions
- Version tagging

## 🚀 Deployment

### Development
- Local development with hot reload
- Environment variables management
- Database migrations
- Seed data for testing

### Production
- Docker containerization
- Environment-specific configurations
- Database backup strategies
- Monitoring and logging

---

**Last Updated:** December 2024
**Version:** 1.0.0
**Status:** MVP Development Phase