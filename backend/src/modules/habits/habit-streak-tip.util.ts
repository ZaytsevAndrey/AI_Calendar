import type { HabitAchievementId } from './habit-achievements.util';

/** Streak thresholds that trigger an AI tip (highest wins when several unlock). */
export const HABIT_STREAK_TIP_IDS = [
  'streak_100',
  'streak_30',
  'streak_7',
  'streak_3',
] as const;

export type HabitStreakTipId = (typeof HABIT_STREAK_TIP_IDS)[number];

const TIP_DAYS: Record<HabitStreakTipId, number> = {
  streak_3: 3,
  streak_7: 7,
  streak_30: 30,
  streak_100: 100,
};

const MAX_TIP_CHARS = 160;

function normalizeLanguage(language: string | null | undefined): 'en' | 'uk' {
  return language === 'uk' ? 'uk' : 'en';
}

function clipTip(value: string): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= MAX_TIP_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_TIP_CHARS - 1).trimEnd()}…`;
}

/** Highest newly unlocked streak id, or null. */
export function pickStreakTipId(
  newlyUnlocked: readonly HabitAchievementId[],
): HabitStreakTipId | null {
  for (const id of HABIT_STREAK_TIP_IDS) {
    if (newlyUnlocked.includes(id)) return id;
  }
  return null;
}

const FALLBACK_EN: Record<HabitStreakTipId, (name: string) => string> = {
  streak_3: (name) =>
    `${name}: three days in a row. Keep it light — showing up beats perfect.`,
  streak_7: (name) =>
    `A full week of ${name}. Future-you already owes you a quiet nod.`,
  streak_30: (name) =>
    `Thirty days of ${name}. That's not luck — that's a groove.`,
  streak_100: (name) =>
    `One hundred days of ${name}. Legendary isn't loud; it's just here again.`,
};

const FALLBACK_UK: Record<HabitStreakTipId, (name: string) => string> = {
  streak_3: (name) =>
    `${name}: три дні поспіль. Легко й стабільно — з'явитись важливіше за ідеал.`,
  streak_7: (name) =>
    `Цілий тиждень з «${name}». Майбутнє «я» вже киває вам дякую.`,
  streak_30: (name) =>
    `Тридцять днів «${name}». Це вже не випадковість — це ритм.`,
  streak_100: (name) =>
    `Сто днів «${name}». Легендарне не кричить — просто знову тут.`,
};

export function fallbackHabitStreakTip(
  habitName: string,
  tipId: HabitStreakTipId,
  language: string = 'en',
): string {
  const name = habitName.trim() || 'this habit';
  const lang = normalizeLanguage(language);
  const templates = lang === 'uk' ? FALLBACK_UK : FALLBACK_EN;
  return clipTip(templates[tipId](name));
}

export function habitStreakTipSystemPrompt(language: string = 'en'): string {
  const writeIn =
    normalizeLanguage(language) === 'uk'
      ? 'Write the tip in Ukrainian.'
      : 'Write the tip in English.';
  return [
    'You write one short celebratory tip after a habit streak unlock in a calendar app.',
    'Reply with JSON only: {"tip":"..."}',
    'One sentence, under 160 characters. Humor is OK. Warm, not preachy.',
    'No medical, diet, or clinical claims. No shame. No emojis.',
    'Mention the habit name naturally when it fits.',
    writeIn,
  ].join(' ');
}

export function habitStreakTipUserPayload(input: {
  name: string;
  description: string | null;
  tipId: HabitStreakTipId;
}): string {
  return JSON.stringify({
    habitName: input.name,
    habitDescription: input.description ?? '',
    streakDays: TIP_DAYS[input.tipId],
    achievementId: input.tipId,
  });
}

export function parseHabitStreakTip(
  raw: string,
  fallback: string,
): string {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { tip?: unknown };
    if (typeof parsed.tip !== 'string' || !parsed.tip.trim()) return fallback;
    return clipTip(parsed.tip);
  } catch {
    return fallback;
  }
}
