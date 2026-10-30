import { ENABLED_PROVIDERS, PROVIDERS } from './auth';
import type { Locale } from './site';

/** All landing copy, both languages. Short and informal on purpose. */

export type CaptureKind = 'event' | 'reminder' | 'task' | 'later';

export interface WaitlistLabels {
    emailLabel: string;
    placeholder: string;
    submit: string;
    pending: string;
    waking: string;
    note: string;
    privacyLink: string;
    invalid: string;
    error: string;
    done: string;
    exists: string;
    followIntro: string;
    calendarLabel: string;
    calendars: { value: string; label: string }[];
    painLabel: string;
    painPlaceholder: string;
    send: string;
    skip: string;
    thanks: string;
}

export interface Dictionary {
    htmlLang: string;
    ogLocale: string;
    meta: { title: string; description: string; keywords: string[]; ogAlt: string };
    nav: { signIn: string; langLabel: string; otherLangName: string; skip: string };
    hero: { badge: string; title: string; lead: string };
    demo: {
        label: string;
        kinds: Record<CaptureKind, string>;
        items: { said: string; kind: CaptureKind; result: string }[];
    };
    waitlist: WaitlistLabels;
    steps: { title: string; items: { title: string; body: string }[] };
    calendarsLine: string;
    final: { title: string; body: string };
    signIn: {
        title: string;
        with: string;
        pending: string;
        waking: string;
        error: string;
        unavailable: string;
        failedRedirect: string;
    };
    footer: { tagline: string; privacy: string };
    privacy: {
        title: string;
        description: string;
        updated: string;
        sections: { title: string; paras: string[] }[];
        contact: string;
        back: string;
    };
}

const uk: Dictionary = {
    htmlLang: 'uk',
    ogLocale: 'uk_UA',
    meta: {
        title: 'Luefy — календар для тих, хто не веде календар',
        description:
            'Опиши свій тиждень один раз і кидай справи голосом чи текстом: Luefy розкладе їх у вільні місця. Google, Outlook та iCloud в одному календарі. Ранній доступ.',
        keywords: [
            'AI планувальник',
            'задачі голосом',
            'нагадування',
            'розумний календар',
            'планувальник дня',
            'Google Календар',
        ],
        ogAlt: 'Luefy перетворює сказане на події, нагадування й задачі в календарі',
    },
    nav: { signIn: 'Увійти', langLabel: 'Мова', otherLangName: 'English', skip: 'Перейти до змісту' },
    hero: {
        badge: 'Ще в розробці',
        title: 'Календар для тих, хто не веде календар.',
        lead: 'Не треба розписувати кожну годину. Один раз опиши свій звичайний тиждень: коли робота, коли вільний час. Далі просто кидай справи, голосом чи текстом, і Luefy розкладе їх у вільні місця.',
    },
    demo: {
        label: 'Як Luefy розбирає сказане',
        kinds: { event: 'Подія', reminder: 'Нагадування', task: 'Задача', later: 'На потім' },
        items: [
            { said: 'Подзвонити в банк', kind: 'task', result: 'Робота, вт 11:30' },
            { said: 'Нагадай скасувати підписку через місяць', kind: 'reminder', result: '30 листопада' },
            { said: 'Колись розібратися зі страховкою', kind: 'later', result: 'Без дати' },
            { said: 'Завтра о 15:00 стоматолог', kind: 'event', result: 'Завтра, 15:00–16:00' },
        ],
    },
    waitlist: {
        emailLabel: 'Емейл',
        placeholder: 'твій@емейл.com',
        submit: 'Хочу спробувати',
        pending: 'Секунду…',
        waking: 'Будимо сервер, це до хвилини…',
        note: 'Один лист, коли відкриємо доступ. Без спаму.',
        privacyLink: 'Про дані',
        invalid: 'Перевір емейл, щось не так.',
        error: 'Не вийшло. Спробуй ще раз за хвилину.',
        done: 'Готово, ти в списку.',
        exists: 'Ти вже в списку.',
        followIntro: 'Два питання, якщо є хвилинка:',
        calendarLabel: 'Яким календарем користуєшся?',
        calendars: [
            { value: 'google', label: 'Google' },
            { value: 'outlook', label: 'Outlook' },
            { value: 'icloud', label: 'iCloud' },
            { value: 'none', label: 'Ніяким' },
        ],
        painLabel: 'Що найчастіше забуваєш?',
        painPlaceholder: 'Дзвінки, оплати, дні народження…',
        send: 'Надіслати',
        skip: 'Пропустити',
        thanks: 'Дякуємо! Скоро напишемо.',
    },
    steps: {
        title: 'Як це працює',
        items: [
            { title: 'Опиши свій тиждень', body: 'Коли робота, коли вдома, коли вільно. Один раз.' },
            { title: 'Кидай справи', body: 'Голосом або текстом, як думаєш.' },
            {
                title: 'Luefy розкладе',
                body: 'Справи без часу — у вільні місця твого тижня. Решту — в нагадування або на потім.',
            },
        ],
    },
    calendarsLine: 'Google, Outlook та iCloud — в одному календарі.',
    final: {
        title: 'Хочеш спробувати?',
        body: 'Залиш емейл — напишемо, коли відкриємо доступ.',
    },
    signIn: {
        title: 'Вже маєш доступ?',
        with: 'Увійти через {provider}',
        pending: 'Відкриваємо вхід…',
        waking: 'Будимо сервер, це до хвилини…',
        error: 'Не вийшло відкрити вхід. Спробуй ще раз.',
        unavailable: 'Вхід через {provider} зараз не працює. Спробуй інший.',
        failedRedirect: 'Вхід не завершився. Спробуй ще раз.',
    },
    footer: { tagline: 'Календар для тих, хто не веде календар.', privacy: 'Конфіденційність' },
    privacy: {
        title: 'Про твої дані',
        description: 'Які дані збирає Luefy, навіщо, де вони зберігаються і як їх видалити.',
        updated: 'Оновлено 31 жовтня 2026 року.',
        sections: [
            {
                title: 'Список очікування',
                paras: [
                    'Зберігаємо емейл, мову сторінки і, якщо відповів, календар та що забуваєш. Тільки щоб написати про доступ і зрозуміти, для кого робимо Luefy. Нікому не передаємо.',
                    'Видалимо, коли отримаєш доступ або попросиш.',
                ],
            },
            {
                title: 'Застосунок',
                paras: [
                    'Вхід через Google або Microsoft: отримуємо ім’я, емейл і доступ до календаря, щоб бачити зайнятий час і записувати заплановане.',
                    'Задачі й налаштування зберігаються на наших серверах (Render, Франкфурт; база — Neon). Щоб розпізнати голос і зрозуміти фразу, Luefy передає її сервісам розпізнавання мовлення та мовній моделі.',
                    'Дані не продаємо і для реклами не використовуємо. Акаунт можна видалити в налаштуваннях.',
                ],
            },
        ],
        contact: 'Питання й запити щодо даних: {email}.',
        back: 'На головну',
    },
};

const en: Dictionary = {
    htmlLang: 'en',
    ogLocale: 'en_US',
    meta: {
        title: 'Luefy — a calendar for people who don’t keep one',
        description:
            'Describe your week once and throw tasks at it by voice or text: Luefy fits them into the gaps. Google, Outlook and iCloud in one calendar. Early access.',
        keywords: ['AI planner', 'voice to task', 'reminders', 'AI calendar', 'day planner', 'Google Calendar'],
        ogAlt: 'Luefy turns what you say into events, reminders and tasks in your calendar',
    },
    nav: { signIn: 'Sign in', langLabel: 'Language', otherLangName: 'Українська', skip: 'Skip to content' },
    hero: {
        badge: 'Still in the works',
        title: 'A calendar for people who don’t keep one.',
        lead: 'No need to plan every hour. Describe your usual week once: when you work, when you’re free. Then just throw tasks at it, by voice or text, and Luefy fits them into the gaps.',
    },
    demo: {
        label: 'How Luefy sorts what you say',
        kinds: { event: 'Event', reminder: 'Reminder', task: 'Task', later: 'Later' },
        items: [
            { said: 'Call the bank', kind: 'task', result: 'Work, Tue 11:30' },
            { said: 'Remind me to cancel the subscription in a month', kind: 'reminder', result: '30 November' },
            { said: 'Sort out the insurance someday', kind: 'later', result: 'No date' },
            { said: 'Dentist tomorrow at 3 pm', kind: 'event', result: 'Tomorrow, 15:00–16:00' },
        ],
    },
    waitlist: {
        emailLabel: 'Email',
        placeholder: 'you@email.com',
        submit: 'I want in',
        pending: 'One sec…',
        waking: 'Waking the server, up to a minute…',
        note: 'One email when access opens. No spam.',
        privacyLink: 'About data',
        invalid: 'Check the email, something’s off.',
        error: 'Didn’t work. Try again in a minute.',
        done: 'Done, you’re on the list.',
        exists: 'You’re already on the list.',
        followIntro: 'Two questions, if you have a minute:',
        calendarLabel: 'Which calendar do you use?',
        calendars: [
            { value: 'google', label: 'Google' },
            { value: 'outlook', label: 'Outlook' },
            { value: 'icloud', label: 'iCloud' },
            { value: 'none', label: 'None' },
        ],
        painLabel: 'What do you forget most?',
        painPlaceholder: 'Calls, payments, birthdays…',
        send: 'Send',
        skip: 'Skip',
        thanks: 'Thanks! We’ll be in touch.',
    },
    steps: {
        title: 'How it works',
        items: [
            { title: 'Describe your week', body: 'When you work, when you’re home, when you’re free. Once.' },
            { title: 'Throw tasks in', body: 'By voice or text, the way you think.' },
            {
                title: 'Luefy sorts them',
                body: 'Tasks without a time go into free spots in your week. The rest become reminders or wait for later.',
            },
        ],
    },
    calendarsLine: 'Google, Outlook and iCloud in one calendar.',
    final: {
        title: 'Want to try it?',
        body: 'Leave your email and we’ll write when access opens.',
    },
    signIn: {
        title: 'Already have access?',
        with: 'Continue with {provider}',
        pending: 'Opening sign-in…',
        waking: 'Waking the server, up to a minute…',
        error: 'Couldn’t open sign-in. Try again.',
        unavailable: 'Sign-in with {provider} isn’t working right now. Try another.',
        failedRedirect: 'Sign-in didn’t finish. Try again.',
    },
    footer: { tagline: 'A calendar for people who don’t keep one.', privacy: 'Privacy' },
    privacy: {
        title: 'About your data',
        description: 'What data Luefy collects, why, where it is stored and how to delete it.',
        updated: 'Updated 31 October 2026.',
        sections: [
            {
                title: 'Waiting list',
                paras: [
                    'We keep your email, the page language and, if you answered, your calendar and what you forget. Only to tell you about access and to learn who we’re building Luefy for. Never shared.',
                    'Deleted once you get access, or whenever you ask.',
                ],
            },
            {
                title: 'The app',
                paras: [
                    'You sign in with Google or Microsoft: we get your name, email and calendar access, so Luefy can see busy time and write what it plans.',
                    'Tasks and settings live on our servers (Render, Frankfurt; database by Neon). To recognise your voice and understand a phrase, Luefy sends it to speech-recognition and language-model services.',
                    'We don’t sell data or use it for ads. You can delete your account in settings.',
                ],
            },
        ],
        contact: 'Questions and data requests: {email}.',
        back: 'Home',
    },
};

const JOIN: Record<Locale, string> = { uk: ' або ', en: ' or ' };

/** "Google", "Google or Microsoft", "Google, Microsoft or Apple" */
export function providerList(locale: Locale): string {
    const names = ENABLED_PROVIDERS.map((id) => PROVIDERS[id].name);
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')}${JOIN[locale]}${names[names.length - 1]}`;
}

const dictionaries: Record<Locale, Dictionary> = { uk, en };

export function getDictionary(locale: Locale): Dictionary {
    return dictionaries[locale];
}
