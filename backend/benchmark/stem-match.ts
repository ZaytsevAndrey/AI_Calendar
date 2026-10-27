/**
 * Shared stem match for planner benchmarks.
 * A stem matches a word prefix, not the middle of another word.
 * Clocks and bare numbers match only on digit boundaries.
 * A date word also matches the ISO day of the fixed benchmark clock.
 * Closed equivalences are the product calendar and a small verb set.
 * Anything outside those checks is not treated as understood language.
 */
import { CLOCK } from './voice-regression/world';

const APOSTROPHE = /[\u0027\u2019\u02BC]/g;
const WORD = /[\p{L}\p{N}']+/gu;

const ACTIONS: Record<'create' | 'update' | 'delete', string[]> = {
  delete: ['видал', 'прибер', 'скасу'],
  create: ['створ', 'додай', 'запиш', 'заплану'],
  update: ['перенес', 'переймен', 'заклад', 'зміни'],
};

const HOUR_FORMS: Array<{ hour: number; stem: string }> = [
  { hour: 19, stem: "дев'ятнадц" },
  { hour: 18, stem: 'вісімнадц' },
  { hour: 17, stem: 'сімнадц' },
  { hour: 16, stem: 'шістнадц' },
  { hour: 15, stem: "п'ятнадц" },
  { hour: 15, stem: 'пятнадц' },
  { hour: 14, stem: 'чотирнадц' },
  { hour: 13, stem: 'тринадц' },
  { hour: 12, stem: 'дванадц' },
  { hour: 11, stem: 'одинадц' },
  { hour: 10, stem: 'десят' },
  { hour: 9, stem: "дев'ят" },
  { hour: 8, stem: 'восьм' },
  { hour: 8, stem: 'вісім' },
  { hour: 7, stem: 'сьом' },
  { hour: 6, stem: 'шост' },
  { hour: 4, stem: 'четверт' },
  { hour: 3, stem: 'треть' },
  { hour: 2, stem: 'друг' },
  { hour: 1, stem: 'перш' },
];

const DAY_STEMS = ['сьогодні', 'завтра', 'понед', 'вівтор', 'серед', 'четвер', "п'ят", 'пятниц', 'субот', 'неділ', 'today', 'tomorrow'];

const COUNT_WORDS: Array<{ value: number; stem: string }> = [
  { value: 12, stem: 'дванадця' },
  { value: 11, stem: 'одинадця' },
  { value: 10, stem: 'десят' },
  { value: 9, stem: "дев'ят" },
  { value: 8, stem: 'вісім' },
  { value: 7, stem: 'сім' },
  { value: 6, stem: 'шіст' },
  { value: 5, stem: "п'ят" },
  { value: 4, stem: 'чотир' },
  { value: 3, stem: 'три' },
  { value: 2, stem: 'дві' },
  { value: 2, stem: 'два' },
  { value: 1, stem: 'одн' },
];

const STOP = new Set([
  'треба', 'сьогодні', 'завтра', 'вже', 'відразу', 'просто', 'будь', 'ласка', 'гаразд', 'добре',
  'купи', 'додай', 'постав', 'зроби', 'запиши', 'перенеси', 'видали', 'нагадай', 'заклади', 'зміни',
  'закрий', 'забери', 'подзвони', 'скасуй', 'прибери',
]);

export function normalizeMatchText(text: string): string {
  return text.toLowerCase().replace(APOSTROPHE, "'");
}

export function wordsOf(text: string): string[] {
  return normalizeMatchText(text).match(WORD) ?? [];
}

export function stemHits(haystack: string, stem: string, action?: string): boolean {
  const hay = normalizeMatchText(haystack);
  const needle = normalizeMatchText(stem).trim();
  if (!needle) return false;
  if (action && actionKind(needle) === action.trim().toLowerCase()) return true;
  const kind = actionKind(needle);
  if (kind && textHasAction(hay, kind)) return true;
  if (isNumericStem(needle)) return numberTokenHits(hay.replace(/\d{4}-\d{2}-\d{2}/g, ' '), needle) || hourWordHits(hay, clockHour(needle));
  if (needle === 'весь день' || needle === 'цілий день') return wholeDayHits(hay);
  if (needle === 'кінця дня') return phraseHits(hay, needle) || numberTokenHits(hay, CLOCK.sleep);
  const dated = dateOfStem(needle);
  if (dated && isoDates(hay).includes(dated)) return true;
  return phraseHits(hay, needle);
}

export function groupHits(text: string, groups: string[][], action?: string): boolean {
  return groups.every((group) => group.some((stem) => stemHits(text, stem, action)));
}

export function anyStem(text: string, stems: string[], action?: string): boolean {
  return stems.some((stem) => stem && stemHits(text, stem, action));
}

/** The reply commits to an action the utterance did not. Unlisted verbs are not a clash. */
export function actionClash(utterance: string, text: string): boolean {
  const spoken = actionsIn(utterance);
  const written = actionsIn(text);
  if (!spoken.size || !written.size) return false;
  for (const kind of written) if (!spoken.has(kind)) return true;
  return false;
}

export function licensedHours(utterance: string): Set<number> {
  const hours = new Set(mentionedHours(utterance));
  const hay = normalizeMatchText(utterance);
  const morning = /ранк|вранц/.test(hay);
  for (const hour of ordinalHours(hay)) {
    hours.add(hour);
    if (hour <= 7 && !morning) hours.add(hour + 12);
  }
  if (phraseHits(hay, 'весь день') || phraseHits(hay, 'цілий день')) {
    hours.add(hourOf(CLOCK.wake));
    hours.add(hourOf(CLOCK.sleep));
  }
  if (phraseHits(hay, 'кінця дня')) hours.add(hourOf(CLOCK.sleep));
  if (phraseHits(hay, 'зараз')) hours.add(hourOf(CLOCK.nowLocal));
  const shift = hoursAfterNow(hay);
  if (shift !== null) hours.add((hourOf(CLOCK.nowLocal) + shift) % 24);
  return hours;
}

export function inventedHours(utterance: string, text: string): number[] {
  const allowed = licensedHours(utterance);
  return mentionedHours(text).filter((hour) => !allowed.has(hour));
}

export function inventedDays(utterance: string, text: string): string[] {
  const allowed = licensedDates(utterance);
  return dayWords(text).filter((word) => {
    const dated = dateOfStem(word);
    return dated !== null && !allowed.has(dated);
  });
}

export function surplusWords(utterance: string, text: string, allowedStems: string[]): string[] {
  const utteranceWords = wordsOf(utterance);
  const allowed = allowedStems.map((stem) => normalizeMatchText(stem).trim()).filter(Boolean);
  return wordsOf(text).filter((word) => {
    if (word.length < 4 || STOP.has(word) || /^\d+$/.test(word)) return false;
    if (utteranceWords.some((item) => item.startsWith(word) || word.startsWith(item))) return false;
    if (allowed.some((stem) => word.startsWith(stem) || stem.startsWith(word))) return false;
    if (sameActionAsUtterance(utterance, word) || sameActionAsStems(allowed, word)) return false;
    if (HOUR_FORMS.some((form) => word.startsWith(form.stem) && licensedHours(utterance).has(form.hour))) return false;
    return true;
  });
}

function actionsIn(text: string): Set<'create' | 'update' | 'delete'> {
  const hay = normalizeMatchText(text);
  const found = new Set<'create' | 'update' | 'delete'>();
  for (const kind of ['delete', 'create', 'update'] as const) {
    if (textHasAction(hay, kind)) found.add(kind);
  }
  return found;
}

function actionKind(stem: string): 'create' | 'update' | 'delete' | null {
  const text = normalizeMatchText(stem);
  for (const kind of ['delete', 'create', 'update'] as const) {
    if (ACTIONS[kind].some((item) => text.startsWith(item))) return kind;
  }
  return null;
}

function textHasAction(hay: string, kind: 'create' | 'update' | 'delete'): boolean {
  return ACTIONS[kind].some((stem) => phraseHits(hay, stem));
}

function sameActionAsUtterance(utterance: string, word: string): boolean {
  const kind = actionKind(word);
  return kind !== null && textHasAction(normalizeMatchText(utterance), kind);
}

function sameActionAsStems(stems: string[], word: string): boolean {
  const kind = actionKind(word);
  return kind !== null && stems.some((stem) => actionKind(stem) === kind);
}

function isNumericStem(stem: string): boolean {
  return /^\d{1,2}(?::\d{2})?$/.test(stem);
}

function clockHour(stem: string): number {
  return Number(stem.slice(0, stem.indexOf(':') >= 0 ? stem.indexOf(':') : stem.length));
}

function hourOf(clock: string): number {
  return Number(clock.slice(0, 2));
}

function numberTokenHits(hay: string, needle: string): boolean {
  let from = 0;
  while (from < hay.length) {
    const at = hay.indexOf(needle, from);
    if (at < 0) return false;
    const before = at > 0 ? hay[at - 1] : '';
    const after = hay[at + needle.length] ?? '';
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    from = at + 1;
  }
  return false;
}

function hourWordHits(hay: string, hour: number): boolean {
  if (!Number.isInteger(hour) || hour < 8 || hour > 23) return false;
  const forms = HOUR_FORMS.filter((item) => item.hour === hour).sort((a, b) => b.stem.length - a.stem.length);
  return wordsOf(hay).some((word) => {
    const form = forms.find((item) => word.startsWith(item.stem));
    if (!form) return false;
    const longer = HOUR_FORMS.find((item) => item.hour !== hour && item.stem.length > form.stem.length && word.startsWith(item.stem));
    return !longer;
  });
}

function wholeDayHits(hay: string): boolean {
  if (phraseHits(hay, 'весь день') || phraseHits(hay, 'цілий день')) return true;
  const wake = numberTokenHits(hay, CLOCK.wake) || numberTokenHits(hay, `${hourOf(CLOCK.wake)}:00`);
  return wake && numberTokenHits(hay, CLOCK.sleep);
}

function mentionedHours(text: string): number[] {
  const hay = normalizeMatchText(text).replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const hours = new Set<number>(ordinalHours(hay));
  for (const match of hay.matchAll(/(?:о|об)\s+(\d{1,2})(?!\d)/g)) {
    const hour = Number(match[1]);
    if (hour <= 23) hours.add(hour);
  }
  for (const match of hay.matchAll(/\d{1,2}:\d{2}/g)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > 0 && /\d/.test(hay[at - 1])) continue;
    const hour = Number(token.slice(0, token.indexOf(':')));
    if (hour <= 23) hours.add(hour);
  }
  return [...hours];
}

function ordinalHours(hay: string): number[] {
  const hours: number[] = [];
  for (const word of wordsOf(hay)) {
    const form = [...HOUR_FORMS].sort((a, b) => b.stem.length - a.stem.length).find((item) => word.startsWith(item.stem));
    if (!form) continue;
    const at = hay.indexOf(word);
    const lead = at > 0 ? hay.slice(0, at) : '';
    if (form.hour <= 7 && !/(?:о|об|з|до)\s+$/.test(lead)) continue;
    hours.push(form.hour);
  }
  return hours;
}

function hoursAfterNow(hay: string): number | null {
  const match = hay.match(/через\s+(\d{1,2}|[^\s]+)\s+годин/);
  if (!match) return null;
  const digits = Number(match[1]);
  if (Number.isInteger(digits) && digits > 0 && digits <= 24) return digits;
  const word = [...COUNT_WORDS].sort((a, b) => b.stem.length - a.stem.length).find((item) => match[1].startsWith(item.stem));
  return word ? word.value : null;
}

function isoDates(hay: string): string[] {
  return hay.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
}

function dateOfStem(stem: string): string | null {
  if (stem.includes('сьогодні') || stem === 'today') return CLOCK.today;
  if (stem.includes('завтра') || stem === 'tomorrow') return CLOCK.tomorrow;
  if (stem.startsWith('понед')) return weekdayYmd(1);
  if (stem.startsWith('вівтор')) return weekdayYmd(2);
  if (stem.startsWith('серед')) return weekdayYmd(3);
  if (stem.startsWith('субот')) return weekdayYmd(6);
  if (stem.startsWith('неділ')) return weekdayYmd(0);
  if (stem.includes("п'ят") || stem.includes('пятниц')) return weekdayYmd(5);
  if (stem === 'четвер' || stem.startsWith('четверг')) return weekdayYmd(4);
  return null;
}

function licensedDates(text: string): Set<string> {
  const dates = new Set<string>();
  const hay = normalizeMatchText(text);
  for (const word of dayWords(text)) {
    const dated = dateOfStem(word);
    if (dated) dates.add(dated);
  }
  for (const iso of isoDates(hay)) dates.add(iso);
  const undated = dates.size === 0;
  if (undated && (phraseHits(hay, 'кінця дня') || phraseHits(hay, 'зараз'))) dates.add(CLOCK.today);
  if (undated && mentionedHours(text).some((hour) => hour > hourOf(CLOCK.nowLocal))) dates.add(CLOCK.today);
  return dates;
}

function dayWords(text: string): string[] {
  return wordsOf(text).filter((word) => {
    if (HOUR_FORMS.some((form) => word.startsWith(form.stem) && word !== form.stem && /(?:ій|та|ої|у)$/.test(word))) return false;
    return DAY_STEMS.some((stem) => word.startsWith(stem) || stem.startsWith(word) && word.length >= 4);
  });
}

function weekdayYmd(target: number): string {
  const [year, month, day] = CLOCK.today.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const delta = (target - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function phraseHits(hay: string, needle: string): boolean {
  const parts = wordsOf(needle);
  if (!parts.length) return false;
  const words = wordsOf(hay);
  return words.some((_, index) => parts.every((part, offset) => words[index + offset]?.startsWith(part)));
}
