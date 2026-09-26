/**
 * Merge en/uk locale trees and fill known gaps so every used key exists in both.
 * Run: node scripts/merge-i18n-locales.js
 */
const fs = require('fs');
const path = require('path');

const enPath = path.join(__dirname, '../frontend/src/i18n/locales/en.json');
const ukPath = path.join(__dirname, '../frontend/src/i18n/locales/uk.json');

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const uk = JSON.parse(fs.readFileSync(ukPath, 'utf8'));

/** English strings for keys that exist in uk but not (yet) fully in en. */
const enFill = {
  'common.clear': 'Clear',
  'common.search': 'Search',
  'common.filters': 'Filters',
  'common.select': 'Select',
  'common.name': 'Name',
  'common.priority': 'Priority',
  'common.description': 'Description',
  'common.phase': 'Phase',
  'common.status': 'Status',
  'common.deadline': 'Deadline',
  'common.duration': 'Duration',
  'common.saving': 'Saving…',
  'common.deleting': 'Deleting…',
  'common.closeModal': 'Close modal',
  'settings.lead':
    'Time zone, wake and sleep, reminders, Google Calendar, and account.',
  'settings.timeManagement': 'Time management',
  'settings.timeManagementHint':
    'These settings shape how your schedule is built. Wake, sleep, and phases use the time zone you set here.',
  'settings.account': 'Account',
  'settings.accountHint':
    'You signed in with Google. Logging out ends only this session; your data stays on this account.',
  'settings.bufferHint':
    'Free time before and after each fixed task and external Google event. Generate uses this gap only when the task would not fit otherwise. 0 turns the buffer off. Dragging a block can still land in the gap.',
  'settings.googleCalendar': 'Google Calendar',
  'settings.appCalendarName': 'App calendar name',
  'settings.appCalendarNameHint':
    'Events created by this app are written to a dedicated Google calendar with this name. Change it here anytime; if Google is connected, the calendar title updates automatically.',
  'settings.calendarNameSaved': 'Calendar name saved',
  'settings.calendarNameSaveFailed': 'Could not save calendar name',
  'settings.calendarNameSaveFailedDetail': 'Check your connection and try again.',
  'settings.checkingConnection': 'Checking connection…',
  'settings.linked': 'Linked with your Google account',
  'settings.notLinkedHint':
    'The calendar links automatically when you sign in with Google. Sign out and back in if this status does not update.',
  'habits.lead':
    'Check off any of the last 14 days. A daily time block, if you set one, stays free for that habit during Generate and is added to Google Calendar when connected.',
  'habits.add': 'Add habit',
  'habits.loading': 'Loading habits…',
  'habits.loadError': 'Could not load habits',
  'habits.todayCount': 'Today {{done}}/{{total}}',
  'habits.points': '{{count}} points',
  'habits.empty': 'No habits yet. Add one — for example Workout or No smoking.',
  'habits.editTitle': 'Edit habit',
  'habits.newTitle': 'New habit',
  'habits.deleteTitle': 'Delete habit',
  'habits.deleteConfirm':
    'Delete "{{name}}" and all its check-ins? This cannot be undone.',
  'habits.updated': 'Habit updated',
  'habits.added': 'Habit added',
  'habits.deleted': 'Habit deleted',
  'habits.updateFailed': 'Could not update habit',
  'habits.createFailed': 'Could not create habit',
  'habits.deleteFailed': 'Could not delete habit',
  'habits.name': 'Name',
  'habits.color': 'Color',
  'habits.hexColor': 'Hex color',
  'habits.description': 'Description (optional)',
  'habits.descriptionHint': 'A tap marks a successful day. The name carries the meaning.',
  'habits.namePlaceholder': 'Workout, No smoking…',
  'habits.nameRequired': 'Name is required',
  'habits.nameMax': 'At most 80 characters',
  'habits.colorInvalid': 'Use a hex color like #22c55e',
  'habits.descriptionMax': 'At most 500 characters',
  'habits.reserveBlock': 'Reserve a daily time block',
  'habits.starts': 'Starts',
  'habits.minutes': 'Minutes',
  'habits.reserveHint':
    'Generate will not place tasks over this time. When Google Calendar is connected, the same block is added there daily.',
  'habits.timeFormat': 'Enter a time like 07:30',
  'habits.minutesRange': 'Between 5 and 240 minutes',
  'habits.createHabit': 'Create habit',
  'habits.gridCaption': 'Habit check-ins for the last 14 days',
  'habits.habitColumn': 'Habit',
  'habits.streakPts': 'Streak {{streak}} days · {{points}} points',
  'habits.editAria': 'Edit {{name}}',
  'habits.todayAria': '{{name}} today',
  'habits.dateAria': '{{name}} on {{date}}',
  'habits.futureLocked': 'Future days cannot be checked.',
  'habits.rangeLocked': 'You can only change check-ins for the last 14 days.',
  'habits.done': 'Done',
  'habits.mark': 'Mark',
  'habits.dayTitle': 'Habits · {{date}}',
  'habits.dotsAria': 'Habits on {{date}}, {{done}} of {{total}} done',
  'habits.checkInFailed': 'Could not check in',
  'habits.clearFailed': 'Could not clear check-in',
  'phases.lead': 'Time windows for planning and a weekly template.',
  'phases.usePreset': 'Use a preset',
  'phases.add': 'Add phase',
  'phases.loading': 'Loading phases…',
  'phases.loadError': 'Could not load phases',
  'phases.editTitle': 'Edit phase',
  'phases.createTitle': 'Create phase',
  'phases.presetTitle': 'Phase preset',
  'phases.presetLead':
    'Replaces Sleep and all other phases. Times follow your wake and sleep settings. Blocked while a phase still has tasks.',
  'phases.selectWeekdays': 'Select weekdays',
  'phases.selectWeekdaysDetail': 'Pick at least one weekday for the preset.',
  'phases.selectWeekdaysSetupDetail': 'Pick at least one weekday for phases.',
  'phases.selectOneDay': 'Select at least one day',
  'phases.applyFailed': 'Could not apply preset',
  'phases.applyFailedDetail':
    'Phases were not replaced. If a phase still has tasks, move or delete them first.',
  'phases.deleteConfirm': 'Delete this phase?',
  'phases.updateFailed': 'Could not update phase',
  'phases.updateFailedDetail': 'The new time was not saved. Try again.',
  'phases.replacePhases': 'Replace phases',
  'phases.empty': 'No phases yet. Add one to get started.',
  'phases.typeDays': 'Type: {{type}} · Days: {{days}}',
  'phases.name': 'Phase name*',
  'phases.nameRequired': 'Phase name is required',
  'phases.colorInvalid': 'Invalid color format',
  'phases.description': 'Description',
  'phases.startRequired': 'Start time is required',
  'phases.endRequired': 'End time is required',
  'phases.weekDaysRequired': 'Select at least one weekday',
  'phases.outsideActiveDay': 'A phase cannot extend outside the active day!',
  'phases.update': 'Update phase',
  'phases.create': 'Create phase',
  'phases.presetWorking': 'Working person',
  'phases.presetWorkingDetail': 'Deep work, meetings, then life admin before sleep.',
  'phases.presetStudent': 'Student / study',
  'phases.presetStudentDetail': 'Classes, study, then free time before sleep.',
  'phases.presetOpen': 'Open day',
  'phases.presetOpenDetail': 'Morning focus, errands, personal projects, and wind-down.',
  'phases.presetDefaults': 'Sleep and focus only',
  'phases.presetDefaultsDetail':
    'Default setup: overnight sleep and a hidden focus window.',
  'phases.presetAria': 'Phase preset',
  'phases.daysOfWeek': 'Days of week*',
  'phases.mon': 'Mon',
  'phases.tue': 'Tue',
  'phases.wed': 'Wed',
  'phases.thu': 'Thu',
  'phases.fri': 'Fri',
  'phases.sat': 'Sat',
  'phases.sun': 'Sun',
  'phases.timeRange': 'Time range*',
  'phases.start': 'Start',
  'phases.end': 'End',
  'phases.startPlaceholder': 'Start time',
  'phases.endPlaceholder': 'End time',
  'phases.weeklyTemplate': 'Weekly phase template',
  'phases.dragHint':
    'Drag a block or its top/bottom edge. Step: {{minutes}} min. Click the center to edit.',
  'phases.tapHint': 'Tap a phase to edit. Times follow your wake and sleep window.',
  'phases.noPhases': 'No phases',
  'phases.legend': 'Legend',
  'phases.setupTitle': 'Set up phases',
  'phases.setupLead':
    'Wake and sleep times define the day. Pick weekdays, then a day shape.',
  'phases.wake': 'Wake',
  'phases.sleep': 'Sleep',
  'phases.dayShape': 'Day shape',
  'phases.saveCreate': 'Save and create phases',
  'phases.skipDefaults': 'Skip — default phases',
  'phases.createFailed': 'Could not create phases',
  'phases.saveSettingsFailed': 'Could not save settings',
  'phases.saveSettingsDetail': 'Wake and sleep times were not saved. Try again.',
  'voice.addByVoice': 'Add task by voice',
  'voice.stop': 'Stop',
  'voice.confirm': 'Confirm',
  'voice.answer': 'Answer',
  'voice.startSpeaking': 'Start speaking',
  'voice.listeningStop': 'Listening… tap Stop when finished.',
  'voice.hint':
    'Speak Ukrainian, English, or Russian. Add a task, or say complete, skip, or move to another time.',
  'voice.heard': 'Heard:',
  'voice.working': 'Working…',
  'voice.saving': 'Saving…',
  'voice.understanding': 'Understanding…',
  'voice.transcribing': 'Transcribing…',
  'voice.clarifyMore': 'Can you add a bit more detail?',
  'voice.askName': 'What should this task be called?',
  'voice.micPermission':
    'Microphone access is required. Allow it in the browser and try again.',
  'voice.micUnsupported':
    'This browser cannot record audio. Try Chrome on Android or Safari 14.3+.',
  'voice.micFailed': 'Could not start the microphone.',
  'voice.confirmOn': 'Voice confirmation on',
  'voice.confirmOff': 'Voice confirmation off',
  'voice.confirmOnDetail': 'Complete, skip, and move will ask before writing.',
  'voice.confirmOffDetail': 'Those commands run as soon as they are understood.',
  'voice.updateFailed': 'Could not update voice settings',
  'voice.title': 'Voice',
  'voice.sectionHint':
    'Creating a task by voice still runs immediately. This switch only covers completing, skipping, or moving a task.',
  'voice.askBefore': 'Ask before voice commands',
  'voice.button': 'Voice',
  'voice.taskCompleted': 'Task completed',
  'voice.occurrenceSkipped': 'Occurrence skipped',
  'voice.eventMoved': 'Event moved',
  'voice.taskRescheduled': 'Task rescheduled',
  'auth.signIn': 'Sign in',
  'auth.signInLead':
    'Continue with Google. Calendar access is requested once when the account is created.',
  'auth.redirecting': 'Redirecting to Google…',
  'auth.continueGoogle': 'Continue with Google',
  'auth.googleFailed': 'Google sign-in failed. Try again.',
  'auth.signInFailed': 'Sign-in failed',
  'auth.couldNotStart': 'Could not start Google sign-in.',
  'auth.didNotComplete': 'Google sign-in did not complete.',
  'auth.signingIn': 'Signing in…',
  'auth.loggedOut': 'Logged out',
  'auth.loggedOutDetail': 'You have been signed out of this device.',
  'auth.missingAuthUrl': 'Missing Google auth URL',
  'pwa.installPrompt': 'Install AI Calendar on this device for faster voice input.',
  'pwa.iosHint': 'On iPhone: Share → Add to Home Screen to install the app.',
  'pwa.install': 'Install',
  'pwa.notNow': 'Not now',
  'pwa.cannotShow': 'This browser cannot show reminders.',
  'pwa.notificationsBlocked': 'Notifications are blocked in this browser.',
  'pwa.subscriptionReadFailed': 'Could not read the push subscription.',
  'calendar.attendeeCount': '{{count}} attendees',
  'schedule.block': '{{count}} blocks',
  'schedule.blocksInRange': '{{count}} time blocks in this range.',
  'schedule.clearedDetail': '{{count}} generated time blocks removed.',
  'schedule.errorsDetail': '{{count}} errors. Details are on this page.',
  'schedule.rescheduled': '{{count}} tasks rescheduled.',
  'schedule.warningsDetail': '{{count}} warnings. Details are on this page.',
};

/** Ukrainian for keys present in en but missing in uk. */
const ukFill = {
  'common.clear': 'Очистити',
  'common.search': 'Пошук',
  'common.filters': 'Фільтри',
  'common.select': 'Обрати',
  'common.name': 'Назва',
  'common.priority': 'Пріоритет',
  'common.description': 'Опис',
  'common.phase': 'Фаза',
  'common.status': 'Статус',
  'common.deadline': 'Дедлайн',
  'common.duration': 'Тривалість',
  'calendar.form.editEvent': 'Редагувати подію',
  'calendar.form.createEvent': 'Створити подію',
  'calendar.form.sleepError': 'Події не можна створювати під час сну.',
  'calendar.form.namePlaceholder': 'напр. Підготувати квартальний огляд',
  'calendar.form.descriptionPlaceholder': 'Додатковий контекст (необовʼязково)',
  'calendar.form.addDescription': '+ Опис',
  'calendar.form.anyTime': 'Будь-коли',
  'calendar.form.noPhases': 'Немає доступних фаз',
  'calendar.form.recurring': 'Повторювана',
  'calendar.form.allowSplit': 'Дозволити дроблення',
  'calendar.form.start': 'Початок',
  'calendar.form.end': 'Кінець',
  'calendar.form.repeatRrule': 'Повтор (RRULE)',
  'calendar.form.durationMin': 'Тривалість (хв)',
  'calendar.form.minSplit': 'Мін. фрагмент (хв)',
  'calendar.form.maxSplit': 'Макс. фрагмент (хв)',
  'calendar.form.icon': 'Іконка',
  'calendar.form.moreOptions': '+ Більше опцій',
  'calendar.form.saveChanges': 'Зберегти зміни',
  'calendar.form.createEventSubmit': 'Створити подію',
  'calendar.priority.urgent': 'Терміновий',
  'calendar.priority.normal': 'Звичайний',
  'calendar.priority.medium': 'Середній',
  'calendar.status.inProgress': 'В процесі',
  'calendar.status.done': 'Готово',
  'calendar.status.postponed': 'Відкладено',
  'calendar.status.cancelled': 'Скасовано',
  'calendar.google.location': 'Місце',
  'calendar.google.color': 'Колір',
  'calendar.google.phaseColor': 'Колір фази',
  'calendar.google.usePhaseColor': 'Колір фази',
  'calendar.google.visibility': 'Видимість',
  'calendar.google.showAs': 'Показувати як',
  'calendar.google.reminders': 'Нагадування',
  'calendar.google.useDefaults': 'Типові для календаря',
  'calendar.google.popup': 'Спливаюче',
  'calendar.google.email': 'Email',
  'calendar.google.addReminder': '+ Нагадування',
  'calendar.google.visibilityDefault': 'Типово для календаря',
  'calendar.google.public': 'Публічна',
  'calendar.google.private': 'Приватна',
  'calendar.google.confidential': 'Конфіденційна',
  'calendar.google.busy': 'Зайнятий',
  'calendar.google.free': 'Вільний',
  'calendar.google.color1': 'Лаванда',
  'calendar.google.color2': 'Шавлія',
  'calendar.google.color3': 'Виноград',
  'calendar.google.color4': 'Фламінго',
  'calendar.google.color5': 'Банан',
  'calendar.google.color6': 'Мандарин',
  'calendar.google.color7': 'Павич',
  'calendar.google.color8': 'Графіт',
  'calendar.google.color9': 'Чорниця',
  'calendar.google.color10': 'Базилік',
  'calendar.google.color11': 'Томат',
  'calendar.attendeeCount': '{{count}} учасників',
  'schedule.block': '{{count}} блоків',
  'schedule.blocksInRange': '{{count}} тайм-блоків у цьому діапазоні.',
  'schedule.clearedDetail': '{{count}} згенерованих тайм-блоків видалено.',
  'schedule.errorsDetail': '{{count}} помилок. Подробиці на цій сторінці.',
  'schedule.rescheduled': '{{count}} задач переплановано.',
  'schedule.warningsDetail': '{{count}} попереджень. Подробиці на цій сторінці.',
};

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  const leaf = parts[parts.length - 1];
  if (cur[leaf] === undefined) cur[leaf] = value;
}

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function flat(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
    else out[key] = v;
  }
  return out;
}

function deepMergePreferLeft(a, b) {
  if (!b || typeof b !== 'object') return a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMergePreferLeft(a[k] && typeof a[k] === 'object' ? a[k] : {}, v);
    } else if (out[k] === undefined) {
      out[k] = v;
    }
  }
  return out;
}

// Merge structural keys from the other locale (values filled next).
let nextEn = deepMergePreferLeft(en, uk);
let nextUk = deepMergePreferLeft(uk, en);

for (const [k, v] of Object.entries(enFill)) {
  if (getPath(nextEn, k) === undefined) setPath(nextEn, k, v);
}
for (const [k, v] of Object.entries(ukFill)) {
  if (getPath(nextUk, k) === undefined) setPath(nextUk, k, v);
}

// Any remaining gaps: copy from the other language as last resort.
const fe = flat(nextEn);
const fu = flat(nextUk);
for (const k of Object.keys(fu)) {
  if (!(k in fe)) setPath(nextEn, k, enFill[k] || fu[k]);
}
for (const k of Object.keys(fe)) {
  if (!(k in fu)) setPath(nextUk, k, ukFill[k] || fe[k]);
}

fs.writeFileSync(enPath, JSON.stringify(nextEn, null, 2) + '\n');
fs.writeFileSync(ukPath, JSON.stringify(nextUk, null, 2) + '\n');

const fe2 = flat(nextEn);
const fu2 = flat(nextUk);
const stillMissingEn = Object.keys(fu2).filter((k) => !(k in fe2));
const stillMissingUk = Object.keys(fe2).filter((k) => !(k in fu2));
const sameAsEn = Object.keys(fe2).filter(
  (k) => fu2[k] === fe2[k] && /[A-Za-z]{5,}/.test(String(fe2[k])) && !['AI Calendar', 'English', 'Google', 'Email', 'RRULE', 'Primary', 'Generate', 'Clear'].some((x) => String(fe2[k]).includes(x)),
);
console.log({
  enKeys: Object.keys(fe2).length,
  ukKeys: Object.keys(fu2).length,
  stillMissingEn: stillMissingEn.length,
  stillMissingUk: stillMissingUk.length,
  sameAsEnSample: sameAsEn.slice(0, 30),
});
