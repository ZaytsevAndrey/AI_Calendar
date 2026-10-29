/**
 * Phase 4.7.7 live DeepSeek evaluation.
 * Default is dry-run and makes zero model calls.
 *
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase477-cli.ts --dry-run
 * npx ts-node --transpile-only src/modules/voice/vnext/eval/phase477-cli.ts --allow-paid-calls --budget-usd 2 --max-calls 400 --output docs/voice-vnext/runs/phase477-deepseek
 */
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import { phase477Plan, runPhase477 } from './phase477-run';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  loadEnv({ path: join(__dirname, '../../../../../.env') });
  const paid = process.argv.includes('--allow-paid-calls');
  const dry = process.argv.includes('--dry-run') || !paid;
  const group = arg('--group');
  const limit = arg('--limit');
  const ids = arg('--ids');
  const suiteArg = arg('--suite');
  const suite = suiteArg === 'holdout' ? 'holdout' : suiteArg === 'fresh' ? 'fresh' : suiteArg === 'adversarial' ? 'adversarial' : suiteArg === 'independent' ? 'independent' : 'frozen';
  const plan = phase477Plan({
    group: group === 'single' || group === 'conversation' ? group : 'all',
    limit: limit ? Number(limit) : undefined,
    ids: ids ? ids.split(',').map((id) => id.trim()).filter(Boolean) : undefined,
    suite,
  });
  if (dry) {
    console.log(JSON.stringify({
      status: 'dry-run',
      modelCalls: 0,
      writes: 0,
      keyPresent: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
      plan,
    }));
    return;
  }
  const budget = Number(arg('--budget-usd') ?? '2');
  const maxCalls = Number(arg('--max-calls') ?? '400');
  const output = arg('--output');
  if (!output || output.includes('phase473') || output.includes('phase474') || output.includes('phase475') || output.includes('phase476')) {
    console.error(JSON.stringify({ status: 'blocked', reason: 'output must be a new phase477 directory', modelCalls: 0 }));
    process.exit(2);
  }
  const result = await runPhase477({
    outputDir: join(__dirname, '../../../../../..', output),
    budgetUsd: budget,
    maxCalls,
    limit: limit ? Number(limit) : undefined,
    ids: ids ? ids.split(',').map((id) => id.trim()).filter(Boolean) : undefined,
    group: group === 'single' || group === 'conversation' ? group : 'all',
    suite,
    resume: !process.argv.includes('--no-resume'),
  });
  console.log(JSON.stringify({ status: result.status, modelCalls: result.modelCalls, usd: result.usd, file: result.file }));
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ status: 'error', modelCalls: 0, message: message.replace(/sk-[A-Za-z0-9]+/g, '[redacted]') }));
  process.exit(1);
});
