// Mock API data for e2e/design screenshots. Times are Europe/Kyiv (+02:00 this week).
const TZ_OFF = '+02:00';
const iso = (ymd, hm) => new Date(`${ymd}T${hm}:00${TZ_OFF}`).toISOString();
const NOW = '2026-10-29T08:00:00.000Z';
const APP_CAL = 'app-cal@group.calendar.google.com';
const PRIMARY = 'andrii@gmail.com';

const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];

function makePhases(lang) {
  const uk = lang === 'uk';
  return [
    { id: 'ph-deep', name: uk ? 'Глибока робота' : 'Deep work', color: '#1d4ed8', description: uk ? 'Фокус без зустрічей' : 'Focus, no meetings', startTime: '08:00', endTime: '11:00', weekDays: [1, 2, 3, 4, 5], type: 'work', createdAt: NOW, updatedAt: NOW, subphases: [] },
    { id: 'ph-meet', name: uk ? 'Зустрічі' : 'Meetings', color: '#7c3aed', description: uk ? 'Дзвінки та сінки' : 'Calls and syncs', startTime: '11:00', endTime: '14:00', weekDays: [1, 2, 3, 4, 5], type: 'work', createdAt: NOW, updatedAt: NOW, subphases: [] },
    { id: 'ph-work', name: uk ? 'Робота' : 'Work', color: '#0369a1', description: '', startTime: '14:00', endTime: '20:00', weekDays: [1, 2, 3, 4, 5], type: 'work', createdAt: NOW, updatedAt: NOW, subphases: [] },
    { id: 'ph-life', name: uk ? 'Побут' : 'Life admin', color: '#0f766e', description: uk ? 'Справи по дому' : 'Errands and home', startTime: '20:00', endTime: '22:00', weekDays: [0, 1, 2, 3, 4, 5, 6], type: 'personal', createdAt: NOW, updatedAt: NOW, subphases: [] },
    { id: 'ph-wknd', name: uk ? 'Вихідні' : 'Weekend', color: '#c2410c', description: '', startTime: '10:00', endTime: '20:00', weekDays: [0, 6], type: 'personal', createdAt: NOW, updatedAt: NOW, subphases: [] },
  ];
}

function task(p) {
  return {
    description: '',
    isRecurring: false,
    allowSplit: false,
    priority: 'medium',
    status: 'todo',
    eventType: 'admin',
    scheduleState: 'none',
    isUnscheduled: false,
    scheduleTimeZone: 'Europe/Kyiv',
    createdAt: NOW,
    updatedAt: NOW,
    ...p,
  };
}

function makeTasks(lang) {
  const uk = lang === 'uk';
  const ph = Object.fromEntries(makePhases(lang).map((x) => [x.id, { id: x.id, name: x.name, color: x.color }]));
  const t = [];
  // Recurring flexible: morning planning every weekday
  t.push(task({ id: 't-plan', name: uk ? 'Планування дня' : 'Plan the day', estimatedTimeInMinutes: 30, isRecurring: true, recurrencePattern: 'DAILY', recurrenceWeekDays: [1, 2, 3, 4, 5], phaseId: 'ph-deep', phases: [ph['ph-deep']], googleEventId: 'ge-plan', seriesSpanStart: iso('2026-10-29', '08:00'), seriesSpanEnd: iso('2026-11-27', '08:00'), scheduledStartTime: iso('2026-10-29', '08:00'), scheduledEndTime: iso('2026-10-29', '08:30') }));
  t.push(task({ id: 't-report', name: uk ? 'Квартальний звіт для інвесторів' : 'Quarterly investor report', estimatedTimeInMinutes: 150, priority: 'high', allowSplit: true, deadline: iso('2026-10-30', '18:00'), phaseId: 'ph-deep', phases: [ph['ph-deep']], googleEventId: 'ge-report', scheduledStartTime: iso('2026-10-29', '08:30'), scheduledEndTime: iso('2026-10-29', '11:00'), description: uk ? 'Зібрати метрики Q3, оновити слайди' : 'Collect Q3 metrics, update slides' }));
  t.push(task({ id: 't-design', name: uk ? 'Рев\'ю дизайну онбордингу' : 'Onboarding design review', estimatedTimeInMinutes: 60, priority: 'medium', eventType: 'fixed', phaseId: 'ph-meet', phases: [ph['ph-meet']], googleEventId: 'ge-design', scheduledStartTime: iso('2026-10-29', '12:30'), scheduledEndTime: iso('2026-10-29', '13:30'), location: 'Zoom' }));
  t.push(task({ id: 't-api', name: uk ? 'Рефакторинг API нагадувань' : 'Refactor reminders API', estimatedTimeInMinutes: 120, priority: 'medium', phaseId: 'ph-work', phases: [ph['ph-work']], googleEventId: 'ge-api', scheduledStartTime: iso('2026-10-29', '14:30'), scheduledEndTime: iso('2026-10-29', '16:30') }));
  t.push(task({ id: 't-gym', name: uk ? 'Спортзал' : 'Gym', estimatedTimeInMinutes: 75, isRecurring: true, recurrencePattern: 'WEEKLY', recurrenceWeekDays: [1, 3, 5], eventType: 'fixed', phaseId: 'ph-life', phases: [ph['ph-life']], googleEventId: 'ge-gym', seriesSpanStart: iso('2026-10-26', '19:00'), seriesSpanEnd: iso('2026-12-25', '19:00'), scheduledStartTime: iso('2026-10-30', '19:00'), scheduledEndTime: iso('2026-10-30', '20:15') }));
  t.push(task({ id: 't-groceries', name: uk ? 'Купити продукти' : 'Buy groceries', estimatedTimeInMinutes: 45, priority: 'low', phaseId: 'ph-life', phases: [ph['ph-life']], googleEventId: 'ge-groc', scheduledStartTime: iso('2026-10-29', '20:15'), scheduledEndTime: iso('2026-10-29', '21:00') }));
  t.push(task({ id: 't-tax', name: uk ? 'Податкова декларація ФОП' : 'File quarterly taxes', estimatedTimeInMinutes: 90, priority: 'urgent', deadline: iso('2026-11-02', '23:59'), phaseId: 'ph-work', phases: [ph['ph-work']], googleEventId: 'ge-tax', scheduledStartTime: iso('2026-10-30', '15:00'), scheduledEndTime: iso('2026-10-30', '16:30') }));
  t.push(task({ id: 't-read', name: uk ? 'Читати «Designing Data-Intensive Applications»' : 'Read “Designing Data-Intensive Applications”', estimatedTimeInMinutes: 60, priority: 'low', phaseId: 'ph-wknd', phases: [ph['ph-wknd']], googleEventId: 'ge-read', scheduledStartTime: iso('2026-10-31', '11:00'), scheduledEndTime: iso('2026-10-31', '12:00') }));
  t.push(task({ id: 't-done', name: uk ? 'Відправити інвойс клієнту' : 'Send invoice to client', estimatedTimeInMinutes: 20, status: 'completed', phaseId: 'ph-work', phases: [ph['ph-work']], googleEventId: 'ge-done', scheduledStartTime: iso('2026-10-28', '14:00'), scheduledEndTime: iso('2026-10-28', '14:20') }));
  t.push(task({ id: 't-done2', name: uk ? 'Ранковий стендап' : 'Morning standup', estimatedTimeInMinutes: 15, status: 'completed', eventType: 'fixed', phaseId: 'ph-meet', phases: [ph['ph-meet']], googleEventId: 'ge-done2', scheduledStartTime: iso('2026-10-27', '11:00'), scheduledEndTime: iso('2026-10-27', '11:15') }));
  // Unscheduled
  t.push(task({ id: 't-unsch1', name: uk ? 'Записатися до стоматолога' : 'Book a dentist appointment', estimatedTimeInMinutes: 15, isUnscheduled: true, priority: 'medium' }));
  t.push(task({ id: 't-unsch2', name: uk ? 'Ідеї для лендінгу' : 'Landing page ideas', estimatedTimeInMinutes: 60, isUnscheduled: true, priority: 'low', phaseId: 'ph-work', phases: [ph['ph-work']] }));
  // Problematic
  t.push(task({ id: 't-prob', name: uk ? 'Підготувати презентацію для конференції' : 'Prepare conference talk', estimatedTimeInMinutes: 240, priority: 'high', scheduleState: 'problematic', problematicDay: '2026-10-30', problematicReason: 'phase_full', problematicOriginalStart: iso('2026-10-30', '08:00'), problematicOriginalEnd: iso('2026-10-30', '12:00'), phaseId: 'ph-deep', phases: [ph['ph-deep']], deadline: iso('2026-11-03', '10:00') }));
  return t;
}

function ev(id, summary, ymd, s, e, extra = {}) {
  return {
    id,
    summary,
    calendarId: extra.calendarId || APP_CAL,
    provider: extra.provider || 'google',
    status: 'confirmed',
    start: { dateTime: iso(ymd, s), timeZone: 'Europe/Kyiv' },
    end: { dateTime: iso(ymd, e), timeZone: 'Europe/Kyiv' },
    isAppGenerated: extra.isAppGenerated ?? true,
    created: NOW,
    updated: NOW,
    htmlLink: 'https://calendar.google.com/',
    ...extra,
  };
}

function makeEvents(lang) {
  const uk = lang === 'uk';
  const tasks = makeTasks(lang);
  const out = [];
  for (const tk of tasks) {
    if (!tk.googleEventId || !tk.scheduledStartTime) continue;
    if (tk.id === 't-plan') {
      for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']) {
        out.push(ev(`ge-plan-${d}`, tk.name, d, '08:00', '08:30', { recurringEventId: 'ge-plan' }));
      }
      continue;
    }
    if (tk.id === 't-gym') {
      for (const d of ['2026-10-26', '2026-10-28', '2026-10-30']) {
        out.push(ev(`ge-gym-${d}`, tk.name, d, '19:00', '20:15', { recurringEventId: 'ge-gym', location: 'Sport Life' }));
      }
      continue;
    }
    const s = new Date(tk.scheduledStartTime), e = new Date(tk.scheduledEndTime);
    const fmt = (dt) => new Date(dt.getTime() + 2 * 3600e3).toISOString().slice(11, 16);
    const ymd = new Date(s.getTime() + 2 * 3600e3).toISOString().slice(0, 10);
    out.push(ev(tk.googleEventId, tk.name, ymd, fmt(s), fmt(e), { location: tk.location }));
  }
  // External events
  const ext = { isAppGenerated: false, calendarId: PRIMARY };
  out.push(ev('x-1on1', uk ? '1:1 з Оленою' : '1:1 with Olena', '2026-10-29', '11:00', '11:30', { ...ext, colorId: '5', attendees: [{ email: 'olena@acme.io', displayName: 'Olena', responseStatus: 'accepted' }, { email: PRIMARY, self: true, responseStatus: 'accepted' }], preview: { calendarName: 'andrii@gmail.com', joinLinks: [{ label: 'Google Meet', url: 'https://meet.google.com/abc' }] } }));
  out.push(ev('x-sync', uk ? 'Продуктовий синк' : 'Product sync', '2026-10-29', '11:30', '12:30', { ...ext, colorId: '9', description: uk ? 'Щотижневий синк по roadmap' : 'Weekly roadmap sync' }));
  out.push(ev('x-lunch', uk ? 'Обід з Максом' : 'Lunch with Max', '2026-10-29', '13:30', '14:30', { ...ext, colorId: '2', location: 'Kanapa, Andriivskyi descent 19' }));
  out.push(ev('x-ms', uk ? 'Дзвінок з клієнтом (Outlook)' : 'Client call (Outlook)', '2026-10-30', '12:00', '13:00', { isAppGenerated: false, calendarId: 'outlook-main', provider: 'microsoft', preview: { calendarName: 'Outlook', joinLinks: [{ label: 'Microsoft Teams', url: 'https://teams.microsoft.com/x' }] } }));
  out.push(ev('x-tue', uk ? 'Ретро спринту' : 'Sprint retro', '2026-10-27', '12:00', '13:00', ext));
  out.push(ev('x-mon', uk ? 'Планування спринту' : 'Sprint planning', '2026-10-26', '11:00', '12:30', ext));
  out.push(ev('x-wed', uk ? 'Співбесіда: Frontend' : 'Interview: Frontend', '2026-10-28', '12:00', '13:00', ext));
  out.push(ev('x-wed2', uk ? 'Код-рев\'ю' : 'Code review', '2026-10-28', '09:00', '10:30', { isAppGenerated: true }));
  out.push(ev('x-tue2', uk ? 'Написати тести' : 'Write tests', '2026-10-27', '08:30', '10:45', { isAppGenerated: true }));
  out.push(ev('x-mon2', uk ? 'Розбір пошти' : 'Inbox zero', '2026-10-26', '14:00', '15:00', { isAppGenerated: true }));
  out.push(ev('x-sat', uk ? 'День народження мами' : 'Mom\'s birthday', '2026-10-31', '17:00', '21:00', ext));
  // All-day
  out.push({ id: 'x-allday', summary: uk ? 'Відпустка Олени' : 'Olena on vacation', calendarId: PRIMARY, provider: 'google', status: 'confirmed', start: { date: '2026-10-30' }, end: { date: '2026-11-01' }, isAppGenerated: false });
  return out;
}

const settings = (lang) => ({
  id: 'us-1', userId: 'u-1', wakeTime: '07:30', sleepTime: '23:00', defaultWorkBlockDuration: 90, defaultBreakDuration: 15, defaultLunchDuration: 60,
  defaultTaskDurationMinutes: 30, preferredLunchTime: '13:30', weekendWorkEnabled: false, googleCalendarLinked: true, appGoogleCalendarName: 'Luefy', appGoogleCalendarId: APP_CAL,
  hiddenGoogleCalendarIds: [], fixedEventBufferMinutes: 10, minSplitMinutes: 30, maxSplitMinutes: 120, recurringScheduleHorizonDays: 30, timeZone: 'Europe/Kyiv', language: lang, speechLanguage: lang,
  remindersEnabled: true, defaultReminderTime: '09:00', syncGoogleDeletions: true, syncTargetCalendars: null, dismissWarnExternalWriteBack: false, dismissWarnFlexibleMove: false,
  dismissWarnUnscheduleExternal: false, confirmVoiceCommands: true, speakVoiceReplies: false, createdAt: NOW, updatedAt: NOW,
});

const reminders = (lang) => {
  const uk = lang === 'uk';
  return [
    { id: 'r-1', name: uk ? 'Оплатити інтернет' : 'Pay internet bill', dueYmd: '2026-10-29', notificationTime: '10:00', recurrencePattern: 'MONTHLY', recurrenceMonthDay: 29, status: 'open' },
    { id: 'r-2', name: uk ? 'Подзвонити бабусі' : 'Call grandma', dueYmd: '2026-10-29', notificationTime: null, status: 'open' },
    { id: 'r-3', name: uk ? 'Здати документи в банк' : 'Submit bank documents', dueYmd: '2026-10-27', notificationTime: '09:00', status: 'open', description: uk ? 'Довідка про доходи' : 'Income statement' },
    { id: 'r-4', name: uk ? 'Полити квіти' : 'Water the plants', dueYmd: '2026-10-31', recurrencePattern: 'WEEKLY', recurrenceWeekDays: [6], status: 'open' },
  ];
};

function handle(method, path, query, lang, scenario) {
  const p = path.replace(/\/+$/, '');
  const empty = scenario === 'empty';
  if (p === '/auth/me') return { id: 'u-1', email: PRIMARY, name: 'Andrii', firstName: 'Andrii', lastName: 'K.', picture: null };
  if (p === '/user-settings/required') return { requiredFilled: scenario !== 'needsSettings', hasPhases: scenario !== 'needsPhases' && scenario !== 'needsSettings' };
  if (p === '/user-settings') return settings(lang);
  if (p === '/phases' && method === 'GET') return (scenario === 'needsPhases' || scenario === 'needsSettings') ? [] : makePhases(lang);
  if (p.startsWith('/phases/time-phases')) return makePhases(lang);
  if (p === '/phases/sleep-time') return { startTime: '23:00', endTime: '07:30' };
  if (/^\/phases\/[^/]+$/.test(p) && method === 'GET') return makePhases(lang).find((x) => p.endsWith(x.id)) || makePhases(lang)[0];
  if (p === '/tasks' && method === 'GET') return empty ? [] : makeTasks(lang);
  if (/^\/tasks\/[^/]+$/.test(p) && method === 'GET') return makeTasks(lang).find((x) => p.endsWith('/' + x.id)) || makeTasks(lang)[0];
  if (p === '/schedule') return empty ? [] : makeTasks(lang).filter((x) => x.scheduledStartTime);
  if (p === '/schedule/recommendations') return { summary: '', suggestions: [] };
  if (p === '/schedule/free-slots') return { ymd: '2026-10-30', timeZone: 'Europe/Kyiv', durationMinutes: 240, dayStart: iso('2026-10-30', '07:30'), dayEnd: iso('2026-10-30', '23:00'), phase: { id: 'ph-deep', name: lang === 'uk' ? 'Глибока робота' : 'Deep work', color: '#1d4ed8' }, busy: [{ start: iso('2026-10-30', '08:00'), end: iso('2026-10-30', '08:30'), label: 'Plan' }, { start: iso('2026-10-30', '12:00'), end: iso('2026-10-30', '13:00'), label: 'Client call' }, { start: iso('2026-10-30', '15:00'), end: iso('2026-10-30', '16:30'), label: 'Taxes' }], free: [{ start: iso('2026-10-30', '08:30'), end: iso('2026-10-30', '12:00') }, { start: iso('2026-10-30', '16:30'), end: iso('2026-10-30', '19:00') }], candidates: [iso('2026-10-30', '08:30'), iso('2026-10-30', '16:30')] };
  if (p.startsWith('/schedule-jobs')) return { id: 'job', status: 'done', result: { diff: [], warnings: [], errors: [] } };
  if (p === '/calendar-providers/events') return { events: empty ? [] : makeEvents(lang), totalEvents: 0 };
  if (p === '/calendar-providers/calendars') return { providers: ['google', 'microsoft'], sections: { google: [{ id: PRIMARY, summary: PRIMARY, primary: true, provider: 'google' }, { id: APP_CAL, summary: 'Luefy', provider: 'google' }, { id: 'family', summary: lang === 'uk' ? 'Сім\'я' : 'Family', provider: 'google' }], microsoft: [{ id: 'outlook-main', summary: 'Calendar', primary: true, provider: 'microsoft' }] }, calendars: [{ id: PRIMARY, summary: PRIMARY, primary: true, provider: 'google' }, { id: APP_CAL, summary: 'Luefy', provider: 'google' }, { id: 'family', summary: 'Family', provider: 'google' }, { id: 'outlook-main', summary: 'Calendar', primary: true, provider: 'microsoft' }] };
  if (p === '/google-calendar/calendars') return [{ id: PRIMARY, summary: PRIMARY, primary: true, accessRole: 'owner' }, { id: APP_CAL, summary: 'Luefy', accessRole: 'owner' }, { id: 'family', summary: 'Family', accessRole: 'reader' }];
  if (p === '/google-calendar/check-connection') return { connected: true };
  if (p.startsWith('/google-calendar/events/')) return makeEvents(lang).find((e) => p.includes(e.id)) || makeEvents(lang)[0];
  if (p === '/calendar-overlays') return [];
  if (p === '/auth/providers/status') return { google: true, microsoft: true, apple: true };
  if (p === '/auth/identities') return [{ id: 'i1', provider: 'google', email: PRIMARY, isRegistrationIdentity: true, connected: true, createdAt: NOW }, { id: 'i2', provider: 'microsoft', email: 'andrii@outlook.com', isRegistrationIdentity: false, connected: true, createdAt: NOW }];
  if (p === '/day-reminders') return empty ? [] : reminders(lang);
  if (p === '/habits') return [];
  if (p === '/reminders/vapid-public-key') return { publicKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' };
  if (p.startsWith('/places/search')) return [];
  if (p.startsWith('/voice')) return {};
  if (p === '/health') return { ok: true };
  return undefined;
}

module.exports = { handle, makeEvents, makeTasks };
