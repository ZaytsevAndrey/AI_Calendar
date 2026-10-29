/**
 * Rejudge a saved turns.jsonl with the current scorer.
 * Does not rewrite the original verdicts.
 *
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase478-rescore.ts docs/voice-vnext/runs/phase478-deepseek-frozen
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LIVE_CONVERSATIONS, LIVE_SINGLES } from './phase477-fixtures';
import { conversationSucceeded, judgeTurn, PHASE478_SCORER, type TurnExpect } from './phase477-score';

const dir = process.argv[2];
if (!dir) {
  console.error('pass a run directory');
  process.exit(2);
}

const expectOf = new Map<string, TurnExpect[]>();
const zoneOf = new Map<string, string>();
for (const row of LIVE_SINGLES) {
  expectOf.set(row.id, [row.expect]);
  if (row.zone) zoneOf.set(row.id, row.zone);
}
for (const row of LIVE_CONVERSATIONS) {
  expectOf.set(row.id, row.turns.map((turn) => turn.expect));
  if (row.zone) zoneOf.set(row.id, row.zone);
}

type Saved = {
  id: string;
  kind: string;
  transcript: Array<{
    outcome: string;
    blocked: string[];
    intents: unknown;
    serverWrites: number;
    assistantMessage: string;
    draftNames: string[];
    pendingCount: number;
  }>;
};

const rows = readFileSync(join(dir, 'turns.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Saved);
let singleSemantic = 0;
let singleSafety = 0;
let singleCompletion = 0;
let perTurn = 0;
let conversations = 0;
let conversationSuccess = 0;
let unsafe = 0;
let unnecessary = 0;
const categories: Record<string, number> = {};
const failures: unknown[] = [];

for (const row of rows) {
  const expects = expectOf.get(row.id) ?? [];
  const verdicts = row.transcript.map((turn, index) => judgeTurn({ ...turn, timeZone: zoneOf.get(row.id) ?? 'Europe/Kyiv' }, expects[index] ?? { outcomes: ['clarify'] }));
  if (row.kind === 'single') {
    singleSemantic += verdicts.filter((item) => item.semantic).length;
    singleSafety += verdicts.filter((item) => item.safety).length;
    singleCompletion += verdicts.filter((item) => item.completion).length;
  } else {
    conversations += 1;
    if (conversationSucceeded(verdicts) && verdicts.length === expects.length) conversationSuccess += 1;
  }
  perTurn += verdicts.filter((item) => item.completion).length;
  unsafe += verdicts.filter((item) => !item.safety).length;
  verdicts.forEach((verdict, index) => {
    if (!verdict.category) return;
    categories[verdict.category] = (categories[verdict.category] ?? 0) + 1;
    if (verdict.category === 'model_unnecessary_clarification') unnecessary += 1;
    failures.push({ id: row.id, turn: index, category: verdict.category, safety: verdict.safety, detail: verdict.detail });
  });
}

const summary = {
  scorer: PHASE478_SCORER,
  note: 'Rescore of saved transcripts with the duration-aware scorer. Original turns.jsonl verdicts were not rewritten.',
  scenarios: rows.length,
  singleCompletion,
  singleSemantic,
  singleSafety,
  perTurnSuccess: perTurn,
  conversationSuccess,
  conversations,
  unsafeTurns: unsafe,
  unnecessaryClarification: unnecessary,
  categories,
};
writeFileSync(join(dir, 'rescored-summary.json'), JSON.stringify(summary, null, 2));
writeFileSync(join(dir, 'rescored-failures.json'), JSON.stringify(failures, null, 2));
console.log(JSON.stringify(summary));
