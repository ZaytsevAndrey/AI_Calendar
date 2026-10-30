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
    why: string;
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
        title: 'Luefy — викинь це з голови',
        description:
            'Скажи Luefy, що треба зробити. Він сам розбере, що це, і знайде для цього час у календарі. Ранній доступ.',
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
        title: 'Викинь це з голови.',
        lead: 'Скажи Luefy, що треба зробити. Він сам розбере, що це, і знайде для цього час у календарі. А ти більше про це не думаєш.',
    },
    demo: {
        label: 'Як Luefy розбирає сказане',
        kinds: { event: 'Подія', reminder: 'Нагадування', task: 'Задача', later: 'Колись потім' },
        items: [
            { said: 'Завтра о 15:00 стоматолог', kind: 'event', result: 'Завтра, 15:00–16:00' },
            { said: 'Не забути забрати посилку', kind: 'reminder', result: 'Сьогодні, 18:00' },
            { said: 'Розібратися зі страховкою на тому тижні', kind: 'task', result: 'Середа, 10:00–11:00' },
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
            { title: 'Кажеш як є', body: 'Голосом або текстом. Без дат, форм і списків.' },
            { title: 'Luefy розбирається', body: 'Подія, нагадування, задача чи «колись потім».' },
            { title: 'І знаходить час', body: 'Між твоїми справами. Не о 23:00.' },
        ],
    },
    why: 'Поки в справи немає часу, голова про неї нагадує. Дав їй час — відпустило.',
    final: {
        title: 'Хочеш спробувати першим?',
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
    footer: { tagline: 'Викинь це з голови.', privacy: 'Конфіденційність' },
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
        title: 'Luefy — get it out of your head',
        description:
            'Tell Luefy what needs doing. It works out what it is and finds time for it in your calendar. Early access.',
        keywords: ['AI planner', 'voice to task', 'reminders', 'AI calendar', 'day planner', 'Google Calendar'],
        ogAlt: 'Luefy turns what you say into events, reminders and tasks in your calendar',
    },
    nav: { signIn: 'Sign in', langLabel: 'Language', otherLangName: 'Українська', skip: 'Skip to content' },
    hero: {
        badge: 'Still in the works',
        title: 'Get it out of your head.',
        lead: 'Tell Luefy what needs doing. It works out what it is and finds time for it in your calendar. You stop thinking about it.',
    },
    demo: {
        label: 'How Luefy sorts what you say',
        kinds: { event: 'Event', reminder: 'Reminder', task: 'Task', later: 'Someday' },
        items: [
            { said: 'Dentist tomorrow at 3 pm', kind: 'event', result: 'Tomorrow, 15:00–16:00' },
            { said: 'Don’t forget the parcel', kind: 'reminder', result: 'Today, 18:00' },
            { said: 'Sort out the insurance next week', kind: 'task', result: 'Wednesday, 10:00–11:00' },
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
            { title: 'Say it as it is', body: 'Voice or text. No dates, forms or lists.' },
            { title: 'Luefy sorts it out', body: 'An event, a reminder, a task or “someday”.' },
            { title: 'And finds the time', body: 'Between your other plans. Not at 11 pm.' },
        ],
    },
    why: 'Until a task has a time, your head keeps reminding you. Give it a time and it lets go.',
    final: {
        title: 'Want to try it first?',
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
    footer: { tagline: 'Get it out of your head.', privacy: 'Privacy' },
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
