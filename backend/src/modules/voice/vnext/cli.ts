/**
 * Dry-run prints counts. A live comparison is one exploratory pass.
 * npx ts-node --transpile-only src/modules/voice/vnext/cli.ts --arm A --dry-run
 * npx ts-node --transpile-only src/modules/voice/vnext/cli.ts --confirm-llm --provider deepseek
 */
import { EDGE_CASES } from './eval/edge-cases';
import { originalSemanticAnnotations } from './eval/catalog';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const arm = arg('--arm') ?? 'legacy';
  const live = process.argv.includes('--confirm-llm');
  if (live) {
    const { runLiveComparison } = await import('./eval/live-run');
    const code = await runLiveComparison(arg('--provider') ?? 'deepseek');
    process.exit(code);
  }
  if (!process.argv.includes('--dry-run')) {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'pass --dry-run or --confirm-llm', arm }));
    process.exit(2);
  }
  if (arm !== 'legacy' && arm !== 'A' && arm !== 'B') {
    console.error(JSON.stringify({ status: 'BLOCKED', reason: 'unknown_arm', arm }));
    process.exit(2);
  }
  console.log(JSON.stringify({
    status: 'dry-run',
    arm,
    originalCases: originalSemanticAnnotations().length,
    edgeCases: EDGE_CASES.length,
    modelCalls: 0,
    writes: 0,
  }));
}

void main();
