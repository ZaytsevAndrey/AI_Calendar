import type { VoiceParseResult } from './voice-parse.types';
import type { VoiceCommand } from './voice-command.types';
import { localYmd } from './voice-local-date.util';
import {
  INTENT_EVAL_ANCHORS,
  type IntentEvalExpect,
  type IntentEvalScenario,
} from './voice-intent-eval.scenarios';

export type IntentEvalActual = {
  understanding: VoiceParseResult['understanding'];
  clarifyingQuestion: string | null;
  commandKind: string | null;
  taskName: string | null;
  habitName: string | null;
  newHabitName: string | null;
  renameTo: string | null;
  patchPriority: string | null;
  spokenStartYmd: string | null;
};

export type IntentEvalMatchResult = {
  ok: boolean;
  failures: string[];
  actual: IntentEvalActual;
};

export function harvestIntentEvalActual(
  result: VoiceParseResult,
  timeZone = INTENT_EVAL_ANCHORS.timeZone,
): IntentEvalActual {
  const command = result.command ?? null;
  const commandKind = command && 'kind' in command ? command.kind : null;
  return {
    understanding: result.understanding,
    clarifyingQuestion: result.clarifyingQuestion,
    commandKind,
    taskName: readTaskName(command),
    habitName: readHabitName(command),
    newHabitName: readNewHabitName(command),
    renameTo: readRename(command),
    patchPriority: readPatchPriority(command),
    spokenStartYmd: readSpokenStartYmd(command, timeZone),
  };
}

export function matchIntentEvalScenario(
  scenario: IntentEvalScenario,
  result: VoiceParseResult,
  timeZone = INTENT_EVAL_ANCHORS.timeZone,
): IntentEvalMatchResult {
  const actual = harvestIntentEvalActual(result, timeZone);
  const failures: string[] = [];
  const exp = scenario.expect;

  if (actual.understanding !== exp.understanding) {
    failures.push(
      `understanding: expected ${exp.understanding}, got ${actual.understanding}`,
    );
  }

  if (exp.understanding === 'needs_clarification') {
    if (!actual.clarifyingQuestion?.trim()) {
      failures.push('clarifyingQuestion: expected a non-empty question');
    }
    return { ok: failures.length === 0, failures, actual };
  }

  assertCommandKind(exp, actual, failures);
  assertIncludes('taskName', exp.taskNameIncludes, actual.taskName, failures);
  assertIncludes('habitName', exp.habitNameIncludes, actual.habitName, failures);
  assertIncludes(
    'newHabitName',
    exp.newHabitNameIncludes,
    actual.newHabitName,
    failures,
  );
  assertIncludes('rename', exp.renameIncludes, actual.renameTo, failures);

  if (exp.patchPriority && actual.patchPriority !== exp.patchPriority) {
    failures.push(
      `patchPriority: expected ${exp.patchPriority}, got ${actual.patchPriority}`,
    );
  }
  if (exp.hasSpokenStart && !actual.spokenStartYmd) {
    failures.push('spokenStart: expected a scheduled start');
  }
  if (exp.scheduledYmd && actual.spokenStartYmd !== exp.scheduledYmd) {
    failures.push(
      `scheduledYmd: expected ${exp.scheduledYmd}, got ${actual.spokenStartYmd}`,
    );
  }

  return { ok: failures.length === 0, failures, actual };
}

function assertCommandKind(
  exp: IntentEvalExpect,
  actual: IntentEvalActual,
  failures: string[],
): void {
  if (exp.commandKind === undefined) return;
  if (exp.commandKind === null) {
    if (actual.commandKind) {
      failures.push(`commandKind: expected null, got ${actual.commandKind}`);
    }
    return;
  }
  if (actual.commandKind !== exp.commandKind) {
    failures.push(
      `commandKind: expected ${exp.commandKind}, got ${actual.commandKind}`,
    );
  }
}

function assertIncludes(
  label: string,
  needle: string | undefined,
  haystack: string | null,
  failures: string[],
): void {
  if (!needle) return;
  if (!haystack || !haystack.toLowerCase().includes(needle.toLowerCase())) {
    failures.push(`${label}: expected to include "${needle}", got ${haystack}`);
  }
}

function readTaskName(command: VoiceCommand | null): string | null {
  if (!command || !('taskName' in command)) return null;
  const name = (command as { taskName?: unknown }).taskName;
  return typeof name === 'string' ? name : null;
}

function readHabitName(command: VoiceCommand | null): string | null {
  if (!command) return null;
  if ('habitName' in command && typeof command.habitName === 'string') {
    return command.habitName;
  }
  return null;
}

function readNewHabitName(command: VoiceCommand | null): string | null {
  if (!command || command.kind !== 'habit_create') return null;
  return command.fields?.name ?? null;
}

function readRename(command: VoiceCommand | null): string | null {
  if (!command) return null;
  if (command.kind === 'update' && command.patch?.name) {
    return command.patch.name;
  }
  if (command.kind === 'habit_update' && command.patch?.name) {
    return command.patch.name;
  }
  return null;
}

function readPatchPriority(command: VoiceCommand | null): string | null {
  if (!command || command.kind !== 'update') return null;
  return command.patch?.priority ?? null;
}

function readSpokenStartYmd(
  command: VoiceCommand | null,
  timeZone: string,
): string | null {
  if (!command) return null;
  if (command.kind === 'window') {
    const iso =
      command.scheduledStartTime ||
      command.earliestStartTime ||
      command.deadline;
    return iso ? localYmd(iso, timeZone) : null;
  }
  if (command.kind === 'shift' || command.kind === 'move') {
    return command.start ? localYmd(command.start, timeZone) : null;
  }
  return null;
}
