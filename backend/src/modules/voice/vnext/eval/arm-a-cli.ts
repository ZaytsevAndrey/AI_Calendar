/**
 * Phase 4.4 arm A evaluation command.
 * Default is dry-run and makes zero LLM calls.
 *
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/arm-a-cli.ts --dry-run
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/arm-a-cli.ts --allow-paid-calls --budget-usd 5 --output docs/voice-vnext/runs/phase44
 */
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { armAEvaluationPlan, runArmAEvaluation } from './arm-a-live';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnv({ path: join(__dirname, '../../../../../.env') });
  const paid = process.argv.includes('--allow-paid-calls');
  const dry = process.argv.includes('--dry-run') || !paid;
  if (paid && process.argv.includes('--dry-run')) {
    console.error(JSON.stringify({ status: 'blocked', reason: 'pass only one of --dry-run or --allow-paid-calls', modelCalls: 0 }));
    process.exit(2);
  }
  if (dry) {
    const plan = armAEvaluationPlan();
    console.log(JSON.stringify({
      status: 'dry-run',
      modelCalls: 0,
      writes: 0,
      keyPresent: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      plan,
    }));
    return;
  }
  const budget = Number(arg('--budget-usd'));
  const limit = arg('--limit');
  const ids = arg('--ids');
  const completeGold = process.argv.includes('--complete-gold');
  const model = arg('--model');
  if (completeGold && model && model !== 'deepseek-flash') {
    console.error(JSON.stringify({ status: 'blocked', reason: 'deepseek_only', modelCalls: 0 }));
    process.exit(2);
  }
  const result = await runArmAEvaluation({
    allowPaidCalls: true,
    model,
    limit: limit ? Number(limit) : undefined,
    budgetUsd: Number.isFinite(budget) ? budget : undefined,
    output: arg('--output') ?? (completeGold ? 'docs/voice-vnext/runs/phase473-deepseek' : undefined),
    heldOut: process.argv.includes('--held-out'),
    completeGold,
    ids: ids ? ids.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean) : undefined,
  });
  console.log(JSON.stringify(result));
  if (result.status === 'blocked' || result.modelCalls === 0 && result.status !== 'complete') process.exit(2);
}

void main();
