import { ENABLED_PROVIDERS, PROVIDERS } from './auth';
import type { Locale } from './site';

/*
 * All landing copy, both languages. The Ukrainian text follows the "Luefy — тексти лендінгу" doc;
 * the English one is its translation. "{providers}" becomes the enabled sign-in providers.
 */

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
    nav: {
        how: string;
        who: string;
        faq: string;
        signIn: string;
        langLabel: string;
        otherLangName: string;
        skip: string;
        home: string;
    };
    hero: { badge: string; title: string; lead: string };
    demo: {
        label: string;
        kinds: Record<CaptureKind, string>;
        items: { said: string; kind: CaptureKind; result: string }[];
    };
    waitlist: WaitlistLabels;
    problem: { title: string; paras: string[]; pull: string };
    how: { title: string; steps: { title: string; body: string }[]; summary: string };
    principles: {
        title: string;
        lead: string;
        items: { title: string; body: string }[];
        dialogLabel: string;
        dialog: { from: 'you' | 'luefy'; text: string }[];
    };
    audience: {
        title: string;
        groups: { title: string; body: string; bullets?: string[] }[];
        note: string;
    };
    vision: { title: string; body: string; bullets: string[]; closing: string };
    faq: { title: string; items: { q: string; a: string }[] };
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
        title: 'Luefy: скажіть один раз, і можна відпустити',
        description:
            'Скажіть Luefy, що треба зробити або не забути. Він зрозуміє, що це — подія, нагадування чи задача, — і знайде для цього час у календарі. Ранній доступ.',
        keywords: [
            'AI планувальник дня',
            'планувальник задач',
            'розумний календар',
            'задачі голосом',
            'нагадування',
            'планування при СДУГ',
            'тайм-блокінг',
            'планувальник з Google Календарем',
        ],
        ogAlt: 'Luefy перетворює сказане на події, нагадування й задачі в календарі',
    },
    nav: {
        how: 'Як це працює',
        who: 'Для кого',
        faq: 'Питання',
        signIn: 'Увійти',
        langLabel: 'Мова',
        otherLangName: 'English',
        skip: 'Перейти до змісту',
        home: 'На головну',
    },
    hero: {
        badge: 'Luefy у розробці. Відкриваємо доступ невеликими групами.',
        title: 'Скажіть один раз — і можна відпустити.',
        lead:
            'Скажіть Luefy, що треба: подзвонити в банк, забрати посилку, нарешті розібратися зі страховкою. Він зрозуміє, що це — подія, нагадування чи задача, — і знайде для цього час у вашому календарі. Ви знаєте, коли це станеться, і більше не прокручуєте це в голові.',
    },
    demo: {
        label: 'Як Luefy розбирає сказане',
        kinds: { event: 'Подія', reminder: 'Нагадування', task: 'Задача', later: 'Пізніше' },
        items: [
            { said: 'Завтра о 15:00 стоматолог', kind: 'event', result: 'Завтра, 15:00–16:00' },
            { said: 'Не забути забрати посилку', kind: 'reminder', result: 'Сьогодні, 18:00' },
            {
                said: 'Треба розібратися зі страховкою на тому тижні',
                kind: 'task',
                result: 'Середа, 10:00–11:00',
            },
        ],
    },
    waitlist: {
        emailLabel: 'Ваш емейл',
        placeholder: 'name@example.com',
        submit: 'Хочу ранній доступ',
        pending: 'Надсилаємо…',
        waking: 'Будимо сервер, це може зайняти до хвилини…',
        note: 'Напишемо, коли дійде ваша черга. Без розсилок.',
        privacyLink: 'Як ми зберігаємо дані',
        invalid: 'Схоже, в емейлі помилка. Перевірте його і спробуйте ще раз.',
        error: 'Не вдалося надіслати. Спробуйте ще раз за хвилину.',
        done: 'Дякуємо, ви в списку.',
        exists: 'Ви вже в списку. Напишемо, коли дійде ваша черга.',
        followIntro: 'Два коротких питання допоможуть зробити Luefy зручним саме для вас.',
        calendarLabel: 'Яким календарем користуєтеся?',
        calendars: [
            { value: 'google', label: 'Google' },
            { value: 'outlook', label: 'Outlook' },
            { value: 'icloud', label: 'iCloud' },
            { value: 'none', label: 'Не користуюся' },
        ],
        painLabel: 'Що найчастіше вилітає з голови?',
        painPlaceholder: 'Дзвінки, оплати, дні народження…',
        send: 'Надіслати',
        skip: 'Пропустити',
        thanks: 'Дякуємо! До зустрічі в Luefy.',
    },
    problem: {
        title: 'Чому про справи так важко не думати',
        paras: [
            'Незроблена справа не дає спокою. Ви згадуєте про неї в душі, перед сном, посеред розмови — і щоразу нічого з цим не робите. Думка крутиться по колу, забирає увагу і сили, а справа не рухається.',
            'Психологи давно це помітили: незавершене тримається в голові наполегливіше за завершене. Але є і добра новина: щоб думка відпустила, справу не обов’язково робити просто зараз. Досить чітко вирішити, коли і як ви її зробите.',
            'Luefy робить саме це. Кожне «треба б…» отримує своє місце в календарі. Ви знаєте, коли до нього повернетеся, і можете думати про інше.',
            'А якщо для рішення бракує інформації? Тоді план — дізнатися. «Порівняти ціни на страховку, 30 хвилин у четвер» — теж задача, і вона теж звільняє голову.',
        ],
        pull: 'Конкретний план для голови — як обіцянка. І вона перестає нагадувати.',
    },
    how: {
        title: 'Від «треба б…» до місця в календарі',
        steps: [
            {
                title: 'Скажіть як є',
                body: 'Голосом або текстом, своїми словами. Дата, час і тривалість — за бажанням. «Треба розібратися зі страховкою на тому тижні» — уже достатньо.',
            },
            {
                title: 'Luefy розбереться, що це',
                body: 'Подія з точним часом, нагадування на день, задача, якій потрібен час, чи те, що чекає на «потім». Якщо чогось важливого бракує, спитає одне питання, а не десять.',
            },
            {
                title: 'І знайде час',
                body: 'У вільному місці вашого дня, не поверх зустрічей і не о 23:00. Ваші події з Google, Outlook чи iCloud він уже бачить.',
            },
        ],
        summary: 'Десять секунд на те, щоб сказати. Жодної хвилини на те, щоб пам’ятати.',
    },
    principles: {
        title: 'План, який ви справді проживете',
        lead: 'AI сьогодні за секунду складе ідеальний день з йогою, читанням і глибокою роботою. Проблема в тому, що це не ваш день. Luefy працює навпаки.',
        items: [
            {
                title: 'Не вигадує задач',
                body: 'У календар потрапляє лише те, що ви самі сказали. Вільний час лишається вільним.',
            },
            {
                title: 'Відрізняє «можу» від «хочу»',
                body: 'Вісім вільних годин не означає вісім годин роботи. Ви кажете, скільки готові дати, і план це поважає.',
            },
            {
                title: 'Питає, а не вгадує',
                body: 'Якщо чогось важливого бракує, спитає. Одне питання — те, що найбільше впливає на план.',
            },
            {
                title: 'План змінюється разом із днем',
                body: 'Прокинулися пізніше чи затрималися на задачі — Luefy перебудує решту дня, а не докорятиме.',
            },
        ],
        dialogLabel: 'Приклад розмови з Luefy',
        dialog: [
            { from: 'you', text: 'Розплануй мені завтра.' },
            {
                from: 'luefy',
                text: 'У тебе три незавершені задачі, зустрічей немає. Скільки часу хочеш дати роботі?',
            },
            { from: 'you', text: 'Годин п’ять. Прокинуся о другій.' },
            {
                from: 'luefy',
                text: 'Тоді два блоки після 15:00 і один коротший увечері. Решту часу не займатиму.',
            },
        ],
    },
    audience: {
        title: 'Якщо в голові завжди відкрито десять вкладок',
        groups: [
            {
                title: 'Коли справ більше, ніж голови',
                body: 'Робота, діти, лікар, податки, подарунок мамі. Кожна справа сама по собі дрібна, але разом вони забирають увагу цілий день. Luefy тримає їх за вас, тож ви думаєте лише про те, чим займаєтесь зараз.',
            },
            {
                title: 'Коли голова працює не за списком (СДУГ / ADHD)',
                body: 'Записати нема коли, потім забув або сам запис десь загубився. Велика задача лякає, і ви відкладаєте її знову і знову. Luefy зроблений так, щоб допомогти саме тут:',
                bullets: [
                    'Записати — за десять секунд голосом, поки думка ще тут.',
                    'Не треба одразу вирішувати коли: Luefy знайде час сам.',
                    'Довга задача ділиться на короткі блоки, до яких легше взятися.',
                    'Нагадування приходить тоді, коли потрібно, а не висить над вами цілий день.',
                    'На екрані тільки «зараз» і «далі», без стіни задач.',
                ],
            },
        ],
        note: 'Luefy — інструмент планування, а не лікування. Він не замінює лікаря чи терапію.',
    },
    vision: {
        title: 'Далі — помічник, який вас знає',
        body: 'Зараз Luefy вчиться добре робити одну річ: приймати все, що ви йому кажете, і ставити це на місце. Наступний крок — помічник, який з часом розуміє саме вас:',
        bullets: [
            'коли ви справді працюєте, а коли лише думаєте, що працюватимете;',
            'скільки часу у вас насправді забирають типові справи;',
            'що для вас важливо, а що може почекати.',
        ],
        closing:
            'І при цьому він не докучатиме порадами і не вигадуватиме задач, щоб виглядати корисним. Ранні користувачі впливають на те, яким він стане. Долучайтеся.',
    },
    faq: {
        title: 'Часті питання',
        items: [
            {
                q: 'Коли можна буде спробувати?',
                a: 'Відкриваємо доступ невеликими групами, в порядку черги. Залиште емейл, і ми напишемо, коли дійде ваша черга.',
            },
            { q: 'Скільки це коштує?', a: 'Під час раннього доступу — безкоштовно.' },
            {
                q: 'З якими календарями працює Luefy?',
                a: 'Google Календар, Microsoft Outlook та Apple iCloud. Ваші події там вважаються зайнятим часом.',
            },
            {
                q: 'Чи змінить Luefy мої події?',
                a: 'Ні. Він створює й переносить лише те, що запланував сам, у власному календарі.',
            },
            { q: 'Які мови він розуміє?', a: 'Українську та англійську, і голосом, і текстом.' },
            {
                q: 'Чи працює на телефоні?',
                a: 'Так. Luefy відкривається в браузері і встановлюється на головний екран Android чи iPhone.',
            },
            {
                q: 'Хто бачить мої справи?',
                a: 'Лише ви. Щоб розпізнати голос і зрозуміти фразу, Luefy передає її сервісам розпізнавання мовлення та мовній моделі. Ми не продаємо дані й не показуємо рекламу.',
            },
            {
                q: 'Чим це краще за звичайний список справ?',
                a: 'Список пам’ятає за вас, але не каже, коли це робити. А саме «коли» дає голові відпочити. Luefy відповідає на обидва питання.',
            },
        ],
    },
    final: {
        title: 'Звільніть голову для важливого',
        body: 'Luefy ще росте, і ми шукаємо людей, для яких це важливо. Залиште емейл — і спробуйте серед перших.',
    },
    signIn: {
        title: 'Вже маєте доступ?',
        with: 'Увійти через {provider}',
        pending: 'Відкриваємо вхід…',
        waking: 'Запускаємо сервер, це може зайняти до хвилини…',
        error: 'Не вдалося відкрити вхід. Перевірте з’єднання і спробуйте ще раз.',
        unavailable: 'Вхід через {provider} зараз недоступний. Скористайтеся іншим способом.',
        failedRedirect: 'Вхід не завершився. Спробуйте ще раз.',
    },
    footer: {
        tagline: 'Скажіть один раз — і можна відпустити.',
        privacy: 'Конфіденційність',
    },
    privacy: {
        title: 'Як ми зберігаємо ваші дані',
        description: 'Які дані збирає Luefy, навіщо, де вони зберігаються і як їх видалити.',
        updated: 'Оновлено 30 жовтня 2026 року.',
        sections: [
            {
                title: 'Список очікування',
                paras: [
                    'Коли ви залишаєте заявку, ми зберігаємо ваш емейл, мову сторінки і, якщо ви відповіли, яким календарем користуєтеся та що найчастіше забуваєте.',
                    'Ми використовуємо це лише для того, щоб написати вам про доступ і краще зрозуміти, для кого робимо Luefy. Без розсилок і без передачі третім особам.',
                    'Заявка зберігається, доки ви не отримаєте доступ або не попросите її видалити.',
                ],
            },
            {
                title: 'Застосунок',
                paras: [
                    'Ви входите через Google або Microsoft. Ми отримуємо ваше ім’я та емейл, а також доступ до календаря, щоб бачити зайнятий час і записувати заплановане.',
                    'Ваші задачі, фази та налаштування зберігаються на наших серверах. Щоб розпізнати голос і зрозуміти фразу, Luefy передає її сервісам розпізнавання мовлення та мовній моделі.',
                    'Ми не продаємо дані й не використовуємо їх для реклами.',
                ],
            },
            {
                title: 'Де зберігаються дані',
                paras: [
                    'Сервери застосунку працюють у Render (Франкфурт), база даних — у Neon.',
                ],
            },
            {
                title: 'Ваші права',
                paras: [
                    'Ви можете попросити показати, виправити або видалити ваші дані. Акаунт можна видалити в налаштуваннях застосунку.',
                ],
            },
        ],
        contact: 'Питання і запити щодо даних: {email}.',
        back: 'На головну',
    },
};

const en: Dictionary = {
    htmlLang: 'en',
    ogLocale: 'en_US',
    meta: {
        title: 'Luefy: say it once, then let it go',
        description:
            'Tell Luefy what you need to do or remember. It works out whether it is an event, a reminder or a task, and finds time for it in your calendar. Early access.',
        keywords: [
            'AI day planner',
            'AI calendar',
            'voice to task',
            'reminders app',
            'ADHD planner',
            'time blocking app',
            'auto schedule tasks',
            'Google Calendar planner',
        ],
        ogAlt: 'Luefy turns what you say into events, reminders and tasks in your calendar',
    },
    nav: {
        how: 'How it works',
        who: 'Who it is for',
        faq: 'FAQ',
        signIn: 'Sign in',
        langLabel: 'Language',
        otherLangName: 'Українська',
        skip: 'Skip to content',
        home: 'Home',
    },
    hero: {
        badge: 'Luefy is in development. We are opening access in small groups.',
        title: 'Say it once, then let it go.',
        lead:
            'Tell Luefy what needs doing: call the bank, pick up a parcel, finally sort out the insurance. It works out whether that is an event, a reminder or a task, and finds time for it in your calendar. You know when it will happen, so you stop replaying it in your head.',
    },
    demo: {
        label: 'How Luefy sorts what you say',
        kinds: { event: 'Event', reminder: 'Reminder', task: 'Task', later: 'Later' },
        items: [
            { said: 'Dentist tomorrow at 3 pm', kind: 'event', result: 'Tomorrow, 15:00–16:00' },
            { said: 'Don’t forget to pick up the parcel', kind: 'reminder', result: 'Today, 18:00' },
            { said: 'Need to sort out the insurance next week', kind: 'task', result: 'Wednesday, 10:00–11:00' },
        ],
    },
    waitlist: {
        emailLabel: 'Your email',
        placeholder: 'name@example.com',
        submit: 'Get early access',
        pending: 'Sending…',
        waking: 'Waking the server, this can take up to a minute…',
        note: 'We’ll write when your turn comes. No newsletters.',
        privacyLink: 'How we store data',
        invalid: 'That email looks wrong. Check it and try again.',
        error: 'Could not send. Try again in a minute.',
        done: 'Thanks, you’re on the list.',
        exists: 'You’re already on the list. We’ll write when your turn comes.',
        followIntro: 'Two quick questions help us make Luefy fit you.',
        calendarLabel: 'Which calendar do you use?',
        calendars: [
            { value: 'google', label: 'Google' },
            { value: 'outlook', label: 'Outlook' },
            { value: 'icloud', label: 'iCloud' },
            { value: 'none', label: 'None' },
        ],
        painLabel: 'What slips your mind most often?',
        painPlaceholder: 'Calls, payments, birthdays…',
        send: 'Send',
        skip: 'Skip',
        thanks: 'Thank you! See you in Luefy.',
    },
    problem: {
        title: 'Why unfinished things won’t leave your head',
        paras: [
            'An unfinished task doesn’t let go. It comes back in the shower, before sleep, in the middle of a conversation, and each time you do nothing about it. The thought goes round in circles, taking attention and energy, and the task doesn’t move.',
            'Psychologists noticed this long ago: unfinished things stick in the mind harder than finished ones. The good news is that you don’t have to do the task right now for the thought to let go. It is enough to decide clearly when and how you will do it.',
            'That is what Luefy does. Every “I should…” gets its own place in the calendar. You know when you’ll come back to it, so you can think about something else.',
            'And if you don’t have enough information to decide? Then the plan is to find out. “Compare insurance prices, 30 minutes on Thursday” is a task too, and it frees your head just the same.',
        ],
        pull: 'A concrete plan is a promise to your mind, and it stops nagging you.',
    },
    how: {
        title: 'From “I should…” to a place in your calendar',
        steps: [
            {
                title: 'Say it as it is',
                body: 'By voice or by typing, in your own words. Date, time and length are optional. “Need to sort out the insurance next week” is enough.',
            },
            {
                title: 'Luefy works out what it is',
                body: 'An event at a set time, a reminder for a day, a task that needs time, or something for “later”. If something important is missing, it asks one question, not ten.',
            },
            {
                title: 'And finds the time',
                body: 'In a free slot of your day, not on top of meetings and not at 11 pm. It already sees your events from Google, Outlook or iCloud.',
            },
        ],
        summary: 'Ten seconds to say it. Not a minute spent remembering it.',
    },
    principles: {
        title: 'A plan you will actually live',
        lead: 'Any AI can draft a perfect day with yoga, reading and deep work in a second. The trouble is, it isn’t your day. Luefy works the other way round.',
        items: [
            {
                title: 'It doesn’t invent tasks',
                body: 'Only what you said goes into the calendar. Free time stays free.',
            },
            {
                title: 'It knows “can” from “want to”',
                body: 'Eight free hours don’t mean eight hours of work. You say how much you’re willing to give, and the plan respects it.',
            },
            {
                title: 'It asks instead of guessing',
                body: 'If something important is missing, it asks. One question: the one that changes the plan most.',
            },
            {
                title: 'The plan moves with your day',
                body: 'Woke up late or a task ran long? Luefy rebuilds the rest of the day instead of nagging.',
            },
        ],
        dialogLabel: 'An example conversation with Luefy',
        dialog: [
            { from: 'you', text: 'Plan my day tomorrow.' },
            { from: 'luefy', text: 'You have three open tasks and no meetings. How much time do you want to give to work?' },
            { from: 'you', text: 'About five hours. I’ll be up at two.' },
            { from: 'luefy', text: 'Then two blocks after 15:00 and a shorter one in the evening. I’ll leave the rest free.' },
        ],
    },
    audience: {
        title: 'If your head always has ten tabs open',
        groups: [
            {
                title: 'When there’s more to do than room to hold it',
                body: 'Work, kids, the doctor, taxes, a present for mum. Each thing is small on its own, but together they take your attention all day. Luefy holds them for you, so you only think about what you’re doing now.',
            },
            {
                title: 'When your brain doesn’t run on lists (ADHD)',
                body: 'No time to write it down, then you forget, or the note gets lost. A big task feels heavy, so you put it off again and again. Luefy is built to help right there:',
                bullets: [
                    'Capture it in ten seconds by voice, while the thought is still there.',
                    'No need to decide when right away: Luefy finds the time.',
                    'A long task is split into short blocks that are easier to start.',
                    'A reminder arrives when it’s needed, instead of hanging over you all day.',
                    'Only “now” and “next” on screen, no wall of tasks.',
                ],
            },
        ],
        note: 'Luefy is a planning tool, not a treatment. It doesn’t replace a doctor or therapy.',
    },
    vision: {
        title: 'Next: an assistant that knows you',
        body: 'Right now Luefy is learning to do one thing well: take whatever you tell it and put it in its place. The next step is an assistant that, over time, understands you in particular:',
        bullets: [
            'when you really work, and when you only think you will;',
            'how long your usual tasks actually take;',
            'what matters to you, and what can wait.',
        ],
        closing:
            'And it won’t pester you with advice or make up tasks to look useful. Early users shape what it becomes. Join in.',
    },
    faq: {
        title: 'Questions people ask',
        items: [
            {
                q: 'When can I try it?',
                a: 'We’re opening access in small groups, in order. Leave your email and we’ll write when your turn comes.',
            },
            { q: 'How much does it cost?', a: 'It’s free during early access.' },
            {
                q: 'Which calendars does Luefy work with?',
                a: 'Google Calendar, Microsoft Outlook and Apple iCloud. Your events there count as busy time.',
            },
            {
                q: 'Will Luefy change my events?',
                a: 'No. It only creates and moves what it planned itself, in its own calendar.',
            },
            { q: 'Which languages does it understand?', a: 'English and Ukrainian, by voice and by text.' },
            {
                q: 'Does it work on a phone?',
                a: 'Yes. Luefy runs in the browser and installs to the home screen on Android or iPhone.',
            },
            {
                q: 'Who sees my tasks?',
                a: 'Only you. To recognise your voice and understand a phrase, Luefy sends it to speech-recognition and language-model services. We don’t sell data or show ads.',
            },
            {
                q: 'How is this better than a to-do list?',
                a: 'A list remembers for you, but doesn’t say when to do it. It’s the “when” that lets your mind rest. Luefy answers both.',
            },
        ],
    },
    final: {
        title: 'Free your head for what matters',
        body: 'Luefy is still growing, and we’re looking for people who need it. Leave your email and be among the first to try it.',
    },
    signIn: {
        title: 'Already have access?',
        with: 'Continue with {provider}',
        pending: 'Opening sign-in…',
        waking: 'Starting the server, this can take up to a minute…',
        error: 'Could not open sign-in. Check your connection and try again.',
        unavailable: 'Sign-in with {provider} is not available right now. Use another option.',
        failedRedirect: 'Sign-in did not finish. Try again.',
    },
    footer: {
        tagline: 'Say it once, then let it go.',
        privacy: 'Privacy',
    },
    privacy: {
        title: 'How we store your data',
        description: 'What data Luefy collects, why, where it is stored and how to delete it.',
        updated: 'Updated 30 October 2026.',
        sections: [
            {
                title: 'Waiting list',
                paras: [
                    'When you join, we store your email, the page language and, if you answered, which calendar you use and what you forget most often.',
                    'We use this only to write to you about access and to understand who we are building Luefy for. No newsletters, nothing shared with third parties.',
                    'Your request is kept until you get access or ask us to delete it.',
                ],
            },
            {
                title: 'The app',
                paras: [
                    'You sign in with Google or Microsoft. We receive your name and email, plus calendar access so Luefy can see busy time and write what it plans.',
                    'Your tasks, phases and settings are stored on our servers. To recognise your voice and understand a phrase, Luefy sends it to speech-recognition and language-model services.',
                    'We don’t sell data or use it for advertising.',
                ],
            },
            {
                title: 'Where data is stored',
                paras: ['The app servers run on Render (Frankfurt); the database is hosted by Neon.'],
            },
            {
                title: 'Your rights',
                paras: [
                    'You can ask us to show, correct or delete your data. You can delete your account in the app settings.',
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
    uk: fillProviders(uk, providerList('uk')),
    en: fillProviders(en, providerList('en')),
};

export function getDictionary(locale: Locale): Dictionary {
    return dictionaries[locale];
}
