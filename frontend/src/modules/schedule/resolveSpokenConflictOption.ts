import type { ConflictOptionId } from './conflictChoiceBus';

const RULES: { id: ConflictOptionId; re: RegExp }[] = [
  {
    id: 'skip_occurrence',
    re: /\b(skip(?:\s+(?:it|this|occurrence|today))?|пропусти(?:ти)?|пропустить)\b/iu,
  },
  {
    id: 'place_on_top',
    re: /\b(on\s+top|second\s+layer|keep\s+(?:this|my)\s+time|поверх|другий\s+шар|залиш(?:и)?\s+(?:цей\s+)?час)\b/iu,
  },
  {
    id: 'leave_problematic',
    re: /\b(leave|park|problematic|inbox|залиши|паркуй|проблем)\b/iu,
  },
  {
    id: 'move_other',
    re: /\b(move\s+(?:the\s+)?other|other\s+task|інш[уюа]|друг[уюа]\s+задач)\b/iu,
  },
  {
    id: 'move_new',
    re: /\b(place\s+(?:this\s+)?(?:task\s+)?elsewhere|move\s+(?:me|new|mine|this)|reschedule\s+me|another\s+time|elsewhere|інший\s+час|перенеси\s+мене|в\s+інше\s+місце)\b/iu,
  },
];

const ORDINALS: { re: RegExp; index: number }[] = [
  { re: /\b(?:1|first|перш(?:ий|а|е)?|первый)\b/iu, index: 0 },
  { re: /\b(?:2|second|друг(?:ий|а|е)?|второй)\b/iu, index: 1 },
  { re: /\b(?:3|third|трет(?:ій|я|є)?|третий)\b/iu, index: 2 },
  { re: /\b(?:4|fourth|четверт(?:ий|а)?|четвёртый|четвертый)\b/iu, index: 3 },
];

/**
 * Map a spoken phrase to a structured conflict option id offered by the sheet.
 */
export function resolveSpokenConflictOption(
  transcript: string,
  options: ConflictOptionId[],
): ConflictOptionId | null {
  const text = transcript.replace(/\s+/g, ' ').trim();
  if (!text || !options.length) return null;

  for (const rule of RULES) {
    if (options.includes(rule.id) && rule.re.test(text)) return rule.id;
  }

  for (const ordinal of ORDINALS) {
    if (!ordinal.re.test(text)) continue;
    const pick = options[ordinal.index];
    if (pick) return pick;
  }

  return null;
}
