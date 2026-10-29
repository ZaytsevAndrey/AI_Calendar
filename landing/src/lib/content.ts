import { ENABLED_PROVIDERS, PROVIDERS } from './auth';
import type { Locale } from './site';

export type PhaseKey = 'dawn' | 'focus' | 'day' | 'dusk';

export interface Dictionary {
    htmlLang: string;
    ogLocale: string;
    meta: {
        title: string;
        description: string;
        keywords: string[];
        ogAlt: string;
    };
    nav: {
        how: string;
        features: string;
        faq: string;
        signIn: string;
        langLabel: string;
        otherLangName: string;
        skip: string;
    };
    hero: {
        title: string;
        lead: string;
        note: string;
    };
    signIn: {
        with: string;
        pending: string;
        waking: string;
        error: string;
        unavailable: string;
        failedRedirect: string;
    };
    strip: {
        label: string;
        caption: string;
        phases: { key: PhaseKey; name: string; from: string; to: string }[];
        tasks: { name: string; from: string; to: string; fixed?: boolean }[];
    };
    how: {
        title: string;
        intro: string;
        steps: { title: string; body: string }[];
    };
    features: {
        title: string;
        items: { title: string; body: string }[];
    };
    faq: {
        title: string;
        items: { q: string; a: string }[];
    };
    final: {
        title: string;
        body: string;
    };
    footer: {
        tagline: string;
    };
}

/*
 * Copy follows documentation/overview.md (Features). Keep it in step when the product changes.
 * "{providers}" is replaced with the enabled sign-in providers ("Google or Microsoft").
 */

const en: Dictionary = {
    htmlLang: 'en',
    ogLocale: 'en_US',
    meta: {
        title: 'Luefy: AI day planner that schedules your tasks',
        description:
            'Split your day into phases, add tasks by voice or text, and Luefy places each one in a free slot around your Google, Outlook and iCloud events. In English and Ukrainian.',
        keywords: [
            'AI day planner',
            'AI calendar',
            'auto schedule tasks',
            'time blocking app',
            'daily planner',
            'Google Calendar planner',
            'Outlook calendar planner',
            'voice to task',
        ],
        ogAlt: 'Luefy places your tasks into the phases of your day',
    },
    nav: {
        how: 'How it works',
        features: 'Features',
        faq: 'FAQ',
        signIn: 'Sign in',
        langLabel: 'Language',
        otherLangName: 'Українська',
        skip: 'Skip to content',
    },
    hero: {
        title: 'An AI day planner that finds a time for every task',
        lead:
            'Split your day into phases like focus hours, errands and evening. Add a task by voice or by typing, and Luefy puts it in a free slot of the right phase, around what is already in your Google, Outlook or iCloud calendar.',
        note: 'Sign in with {providers}. Calendar access is requested the first time you sign in.',
    },
    signIn: {
        with: 'Continue with {provider}',
        pending: 'Opening sign-in…',
        waking: 'Starting the server, this can take up to a minute…',
        error: 'Could not open sign-in. Check your connection and try again.',
        unavailable: 'Sign-in with {provider} is not available right now. Use another option.',
        failedRedirect: 'Sign-in did not finish. Try again.',
    },
    strip: {
        label: 'Example of a planned day in Luefy',
        caption: 'A Tuesday in Luefy',
        phases: [
            { key: 'dawn', name: 'Morning', from: '07:00', to: '09:00' },
            { key: 'focus', name: 'Focus hours', from: '09:00', to: '13:00' },
            { key: 'day', name: 'Errands & calls', from: '13:00', to: '18:00' },
            { key: 'dusk', name: 'Evening', from: '18:00', to: '22:00' },
        ],
        tasks: [
            { name: 'Stretch & plan the day', from: '07:30', to: '08:00' },
            { name: 'Write the project brief', from: '09:15', to: '11:00' },
            { name: 'Team call', from: '11:30', to: '12:00', fixed: true },
            { name: 'Reply to emails', from: '12:00', to: '12:45' },
            { name: 'Call the dentist', from: '13:30', to: '13:50' },
            { name: 'Groceries', from: '16:00', to: '16:45' },
            { name: 'Gym', from: '18:30', to: '19:30' },
            { name: 'Read', from: '21:00', to: '21:30' },
        ],
    },
    how: {
        title: 'How Luefy plans your day',
        intro: 'Three steps. After the first one, you only ever do the second.',
        steps: [
            {
                title: 'Describe your day once',
                body: 'Set your wake and sleep times, weekends and time zone. Pick a day shape to start from, then add your own phases, like focus hours or errands.',
            },
            {
                title: 'Add tasks the quick way',
                body: 'Tap the mic and say “call the dentist tomorrow, twenty minutes”, or type it. A task can be flexible, fixed to a time or recurring. To block time, drag across the calendar.',
            },
            {
                title: 'Luefy finds the slot',
                body: 'Each new task goes into a free slot of its phase, by priority, around fixed tasks and your calendar events. If two things clash, you choose what moves. Anything without room waits in Later.',
            },
        ],
    },
    features: {
        title: 'What you get',
        items: [
            {
                title: 'Day phases',
                body: 'Give each part of the day a job. Deep work goes to focus hours, calls go to the afternoon, and nothing lands at 23:00.',
            },
            {
                title: 'An assistant you can talk to',
                body: 'Plan out loud or in a chat, in English or Ukrainian. It asks only what it needs and shows a preview of every change before you apply it.',
            },
            {
                title: 'All your calendars in one view',
                body: 'Connect Google and Microsoft Outlook with a sign-in, and iCloud from Settings. Their events count as busy time, and you choose which calendars to show.',
            },
            {
                title: 'Your plan in Google Calendar',
                body: 'Planned tasks go to Luefy’s own calendar in your Google account. Luefy changes only the events it created.',
            },
            {
                title: 'Fixed, flexible and recurring tasks',
                body: 'Pin a meeting to 11:30, let a report float within a From/Until window, or repeat the gym on chosen weekdays.',
            },
            {
                title: 'Long tasks split into parts',
                body: 'If a four-hour task does not fit in one go, Luefy can split it into blocks no shorter than the minimum you set.',
            },
            {
                title: 'Now, Next and Later',
                body: 'See what is on now, what comes next and what is still waiting for a slot today. Mark it done or skip it in one tap.',
            },
            {
                title: 'Day reminders',
                body: 'Errands that need a day but not a time slot, like picking up a parcel. Overdue ones get harder to ignore.',
            },
            {
                title: 'On your phone, with reminders',
                body: 'Add Luefy to your home screen on Android or iPhone and get a notification shortly before each task.',
            },
        ],
    },
    faq: {
        title: 'Questions people ask',
        items: [
            {
                q: 'What is Luefy?',
                a: 'Luefy is an AI day planner. You split the day into phases and add tasks, and Luefy places them in free time around your calendar events.',
            },
            {
                q: 'How do I sign in?',
                a: 'With your {providers} account. There is no separate password to remember.',
            },
            {
                q: 'Which calendars does Luefy work with?',
                a: 'Google Calendar, Microsoft Outlook and Apple iCloud. Google and Microsoft connect with a sign-in; iCloud connects from Settings with an app-specific password.',
            },
            {
                q: 'Will Luefy change my existing calendar events?',
                a: 'No. Events you already have count as busy time. Luefy creates and moves only the events it planned, in its own calendar.',
            },
            {
                q: 'What happens when a task does not fit?',
                a: 'It is not squeezed in. When tasks clash you pick what to do, and anything without room waits in Later until you schedule it.',
            },
            {
                q: 'Which languages does Luefy support?',
                a: 'English and Ukrainian, both in the interface and for voice.',
            },
            {
                q: 'Does Luefy work on a phone?',
                a: 'Yes. It runs in the browser, installs to the home screen on Android and iPhone, and can send a reminder before each task.',
            },
        ],
    },
    final: {
        title: 'Plan tomorrow in two minutes',
        body: 'Sign in, set your phases and add a few tasks. Luefy takes it from there.',
    },
    footer: {
        tagline: 'AI day planner with phases, voice input and your calendars in one place.',
    },
};

const uk: Dictionary = {
    htmlLang: 'uk',
    ogLocale: 'uk_UA',
    meta: {
        title: 'Luefy: AI-планувальник дня, що сам розставляє задачі',
        description:
            'Поділіть день на фази, додавайте задачі голосом або текстом, а Luefy знайде кожній вільний час між подіями з Google, Outlook та iCloud. Українською та англійською.',
        keywords: [
            'AI планувальник дня',
            'планувальник задач',
            'розумний календар',
            'автоматичне планування задач',
            'тайм-блокінг',
            'планувальник з Google Календарем',
            'планувальник з Outlook',
            'задачі голосом',
        ],
        ogAlt: 'Luefy розставляє задачі по фазах вашого дня',
    },
    nav: {
        how: 'Як це працює',
        features: 'Можливості',
        faq: 'Питання',
        signIn: 'Увійти',
        langLabel: 'Мова',
        otherLangName: 'English',
        skip: 'Перейти до змісту',
    },
    hero: {
        title: 'AI-планувальник дня, який знаходить час для кожної задачі',
        lead:
            'Поділіть день на фази: фокус, справи, вечір. Додайте задачу голосом або текстом, і Luefy поставить її у вільне місце потрібної фази, між подіями, що вже є у вашому Google, Outlook чи iCloud календарі.',
        note: 'Вхід через {providers}. Доступ до календаря запитується під час першого входу.',
    },
    signIn: {
        with: 'Увійти через {provider}',
        pending: 'Відкриваємо вхід…',
        waking: 'Запускаємо сервер, це може зайняти до хвилини…',
        error: 'Не вдалося відкрити вхід. Перевірте з’єднання і спробуйте ще раз.',
        unavailable: 'Вхід через {provider} зараз недоступний. Скористайтеся іншим способом.',
        failedRedirect: 'Вхід не завершився. Спробуйте ще раз.',
    },
    strip: {
        label: 'Приклад спланованого дня в Luefy',
        caption: 'Вівторок у Luefy',
        phases: [
            { key: 'dawn', name: 'Ранок', from: '07:00', to: '09:00' },
            { key: 'focus', name: 'Години фокусу', from: '09:00', to: '13:00' },
            { key: 'day', name: 'Справи й дзвінки', from: '13:00', to: '18:00' },
            { key: 'dusk', name: 'Вечір', from: '18:00', to: '22:00' },
        ],
        tasks: [
            { name: 'Розминка й план дня', from: '07:30', to: '08:00' },
            { name: 'Написати бриф проєкту', from: '09:15', to: '11:00' },
            { name: 'Дзвінок з командою', from: '11:30', to: '12:00', fixed: true },
            { name: 'Відповісти на листи', from: '12:00', to: '12:45' },
            { name: 'Подзвонити стоматологу', from: '13:30', to: '13:50' },
            { name: 'Продукти', from: '16:00', to: '16:45' },
            { name: 'Спортзал', from: '18:30', to: '19:30' },
            { name: 'Читання', from: '21:00', to: '21:30' },
        ],
    },
    how: {
        title: 'Як Luefy планує ваш день',
        intro: 'Три кроки. Після першого ви робите лише другий.',
        steps: [
            {
                title: 'Опишіть свій день один раз',
                body: 'Вкажіть, коли прокидаєтесь і лягаєте, вихідні та часовий пояс. Оберіть шаблон дня, а потім додайте свої фази, наприклад години фокусу чи справи.',
            },
            {
                title: 'Додайте задачі швидким способом',
                body: 'Натисніть мікрофон і скажіть «подзвонити стоматологу завтра, двадцять хвилин», або напишіть. Задача може бути гнучкою, прив’язаною до часу або повторюваною. Щоб зайняти час, просто проведіть по календарю.',
            },
            {
                title: 'Luefy знаходить місце',
                body: 'Кожна нова задача стає у вільне місце своєї фази, за пріоритетом, між фіксованими задачами й подіями календаря. Якщо щось перетинається, ви обираєте, що перенести. Те, чому немає місця, чекає в «Пізніше».',
            },
        ],
    },
    features: {
        title: 'Що ви отримуєте',
        items: [
            {
                title: 'Фази дня',
                body: 'Дайте кожній частині дня свою роль. Глибока робота йде в години фокусу, дзвінки на після обіду, і нічого не потрапляє на 23:00.',
            },
            {
                title: 'Помічник, з яким можна говорити',
                body: 'Плануйте вголос або в чаті, українською чи англійською. Він питає лише те, що потрібно, і показує кожну зміну до того, як ви її застосуєте.',
            },
            {
                title: 'Усі календарі в одному місці',
                body: 'Підключіть Google і Microsoft Outlook входом, а iCloud у налаштуваннях. Їхні події вважаються зайнятим часом, і ви обираєте, які календарі показувати.',
            },
            {
                title: 'Ваш план у Google Календарі',
                body: 'Заплановані задачі потрапляють в окремий календар Luefy у вашому Google-акаунті. Luefy змінює лише події, які створив сам.',
            },
            {
                title: 'Фіксовані, гнучкі й повторювані задачі',
                body: 'Закріпіть зустріч на 11:30, дайте звіту «плавати» у вікні Від/До або повторюйте спортзал у вибрані дні тижня.',
            },
            {
                title: 'Довгі задачі діляться на частини',
                body: 'Якщо чотиригодинна задача не вміщається за раз, Luefy розіб’є її на блоки, не коротші за мінімум, який ви задали.',
            },
            {
                title: 'Зараз, Далі й Пізніше',
                body: 'Видно, що відбувається зараз, що буде далі і що сьогодні ще чекає на місце. Позначте виконаним або пропустіть одним дотиком.',
            },
            {
                title: 'Нагадування на день',
                body: 'Справи, яким потрібен день, але не час у розкладі, як-от забрати посилку. Прострочені дедалі важче не помітити.',
            },
            {
                title: 'На телефоні, з нагадуваннями',
                body: 'Додайте Luefy на головний екран Android чи iPhone й отримуйте сповіщення незадовго до кожної задачі.',
            },
        ],
    },
    faq: {
        title: 'Часті питання',
        items: [
            {
                q: 'Що таке Luefy?',
                a: 'Luefy — це AI-планувальник дня. Ви ділите день на фази й додаєте задачі, а Luefy розставляє їх у вільний час між подіями вашого календаря.',
            },
            {
                q: 'Як увійти?',
                a: 'Через акаунт {providers}. Окремий пароль запам’ятовувати не треба.',
            },
            {
                q: 'З якими календарями працює Luefy?',
                a: 'Google Календар, Microsoft Outlook та Apple iCloud. Google і Microsoft підключаються входом, iCloud — у налаштуваннях через пароль для застосунку.',
            },
            {
                q: 'Чи змінить Luefy мої наявні події в календарі?',
                a: 'Ні. Наявні події вважаються зайнятим часом. Luefy створює й переносить лише ті події, які запланував сам, у власному календарі.',
            },
            {
                q: 'Що буде, якщо задача не вміщається?',
                a: 'Її не втиснуть силою. Коли задачі перетинаються, ви обираєте, що робити, а те, чому немає місця, чекає в «Пізніше», доки ви його не заплануєте.',
            },
            {
                q: 'Які мови підтримує Luefy?',
                a: 'Українську та англійську, і в інтерфейсі, і для голосу.',
            },
            {
                q: 'Чи працює Luefy на телефоні?',
                a: 'Так. Він працює в браузері, встановлюється на головний екран Android та iPhone і може нагадувати про кожну задачу.',
            },
        ],
    },
    final: {
        title: 'Сплануйте завтра за дві хвилини',
        body: 'Увійдіть, налаштуйте фази й додайте кілька задач. Далі Luefy впорається сам.',
    },
    footer: {
        tagline: 'AI-планувальник дня з фазами, голосовим введенням і всіма календарями в одному місці.',
    },
};

const JOIN: Record<Locale, string> = { en: ' or ', uk: ' або ' };

/** "Google", "Google or Microsoft", "Google, Microsoft or Apple" */
function providerList(locale: Locale): string {
    const names = ENABLED_PROVIDERS.map((id) => PROVIDERS[id].name);
    if (names.length < 2) return names.join('');
    return `${names.slice(0, -1).join(', ')}${JOIN[locale]}${names[names.length - 1]}`;
}

function fillProviders<T>(value: T, providers: string): T {
    if (typeof value === 'string') return value.replace(/\{providers\}/g, providers) as T;
    if (Array.isArray(value)) return value.map((v) => fillProviders(v, providers)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, fillProviders(v, providers)]),
        ) as T;
    }
    return value;
}

const dictionaries: Record<Locale, Dictionary> = {
    en: fillProviders(en, providerList('en')),
    uk: fillProviders(uk, providerList('uk')),
};

export function getDictionary(locale: Locale): Dictionary {
    return dictionaries[locale];
}
