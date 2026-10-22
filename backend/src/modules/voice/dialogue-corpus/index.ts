import './create.corpus';
import './update.corpus';
import './delete.corpus';
import './complete.corpus';
import './skip.corpus';
import './reschedule.corpus';
import './dialogue.corpus';
import './fast-create.corpus';
import { registeredScenarios, type DialogueScenario } from './define';

const GROCERY = /молоко|хліб|батон|кефір/iu;

/** Field values the matcher looks for in intent JSON, not in the spoken line. */
const JSON_NEEDLES = new Set(['urgent']);

function validate(list: readonly DialogueScenario[]): DialogueScenario[] {
  const sequences = new Map<string, string>();
  const missing: string[] = [];
  const grocery: string[] = [];
  for (const scenario of list) {
    const mode = scenario.mode ?? 'assistant';
    const lines = scenario.turns.map((turn) => turn.transcript?.trim() ?? '');
    const blob = lines.join('\n');
    if (GROCERY.test(blob)) grocery.push(scenario.id);
    const key = `${mode}\n${blob}`;
    const previous = sequences.get(key);
    if (previous) {
      throw new Error(`same situation twice: ${previous} and ${scenario.id}`);
    }
    sequences.set(key, scenario.id);
    for (const turn of scenario.turns) {
      const needle = turn.expect.nameIncludes?.toLowerCase();
      if (!needle || JSON_NEEDLES.has(needle) || blob.toLowerCase().includes(needle)) continue;
      missing.push(`${scenario.id} lacks ${needle}`);
    }
  }
  if (grocery.length || missing.length) {
    throw new Error([...grocery.map((id) => `grocery title in ${id}`), ...missing].join('\n'));
  }
  return [...list];
}

export const DIALOGUE_CORPUS: readonly DialogueScenario[] = validate(registeredScenarios());

export function corpusCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const scenario of DIALOGUE_CORPUS) {
    counts[scenario.corpus] = (counts[scenario.corpus] ?? 0) + 1;
  }
  return counts;
}
