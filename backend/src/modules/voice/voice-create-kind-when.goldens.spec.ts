import { CREATE_KIND_WHEN_MODULE } from './prompt-modules/kind-when';
import { buildVoiceCreateSystemPrompt } from './voice-parse.create.prompt';
import {
  buildVoiceParseResultLog,
} from './voice-parse-result-log.util';
import { normalizeVoiceParse } from './voice-parse.util';
import {
  CREATE_KIND_WHEN_GOLDEN_ANCHORS,
  CREATE_KIND_WHEN_GOLDENS,
} from './voice-create-kind-when.goldens';

const phaseId = '11111111-1111-4111-8111-111111111111';

describe('create kind/when goldens (§23.2)', () => {
  it('covers every first-match branch 1–6 at least once', () => {
    const branches = new Set(CREATE_KIND_WHEN_GOLDENS.map((g) => g.branch));
    expect([...branches].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('keeps create system prompt aligned with the kind/when decision tree', () => {
    const system = buildVoiceCreateSystemPrompt('uk');
    expect(system).toContain(CREATE_KIND_WHEN_MODULE);
    expect(CREATE_KIND_WHEN_MODULE).toMatch(/First match wins/);
    expect(CREATE_KIND_WHEN_MODULE).toMatch(
      /1\. Recurring[\s\S]*2\. Fixed[\s\S]*3\. Flexible preferred[\s\S]*4\. Flexible window[\s\S]*5\. Day only[\s\S]*6\. No day/,
    );
    // Documented examples stay in the prompt (calibration source for goldens).
    expect(CREATE_KIND_WHEN_MODULE).toContain('tomorrow at 15:00 dentist');
    expect(CREATE_KIND_WHEN_MODULE).toContain(
      'every Tuesday at 15:00 dentist',
    );
    expect(CREATE_KIND_WHEN_MODULE).toContain('around 3 go to the shop');
    expect(CREATE_KIND_WHEN_MODULE).toContain(
      'between 14 and 18 buy groceries',
    );
    expect(CREATE_KIND_WHEN_MODULE).toContain('meeting from 15 to 16');
    expect(CREATE_KIND_WHEN_MODULE).toContain('need to buy milk');
    expect(CREATE_KIND_WHEN_MODULE).toContain(
      'every morning stretch at 7',
    );
  });

  it.each(CREATE_KIND_WHEN_GOLDENS)(
    '$id (branch $branch): normalize preserves specialist contract',
    (golden) => {
      const result = normalizeVoiceParse(golden.llm, {
        validPhaseIds: new Set([phaseId]),
        alreadyClarified: false,
        transcript: golden.transcript,
        timeZone: CREATE_KIND_WHEN_GOLDEN_ANCHORS.timeZone,
        nowIso: CREATE_KIND_WHEN_GOLDEN_ANCHORS.nowIso,
        wakeTime: CREATE_KIND_WHEN_GOLDEN_ANCHORS.wakeTime,
        language: golden.language,
        defaultTaskDurationMinutes:
          CREATE_KIND_WHEN_GOLDEN_ANCHORS.defaultTaskDurationMinutes,
      });

      expect(result.understanding).toBe(golden.expect.understanding);
      expect(result.clarifyingQuestion).toBeNull();
      expect(result.task?.name).toBe(golden.expect.taskName);

      if (golden.expect.eventType !== undefined) {
        expect(result.task?.eventType).toBe(golden.expect.eventType);
      }
      if (golden.expect.estimatedTimeInMinutes !== undefined) {
        expect(result.task?.estimatedTimeInMinutes).toBe(
          golden.expect.estimatedTimeInMinutes,
        );
      }
      if (golden.expect.isRecurring !== undefined) {
        expect(result.task?.isRecurring).toBe(golden.expect.isRecurring);
      }
      if (golden.expect.recurrencePattern !== undefined) {
        expect(result.task?.recurrencePattern).toBe(
          golden.expect.recurrencePattern,
        );
      }
      if (golden.expect.recurrenceWeekDays !== undefined) {
        expect(result.task?.recurrenceWeekDays).toEqual(
          golden.expect.recurrenceWeekDays,
        );
      }
      if (golden.expect.isUnscheduled === true) {
        expect(result.task?.isUnscheduled).toBe(true);
      } else if (golden.expect.isUnscheduled === false) {
        expect(result.task?.isUnscheduled).toBeFalsy();
      }
      if (golden.expect.scheduledStartTime !== undefined) {
        expect(result.task?.scheduledStartTime ?? null).toBe(
          golden.expect.scheduledStartTime,
        );
      }
      if (golden.expect.scheduledEndTime !== undefined) {
        expect(result.task?.scheduledEndTime ?? null).toBe(
          golden.expect.scheduledEndTime,
        );
      }
      if (golden.expect.earliestStartTime !== undefined) {
        expect(result.task?.earliestStartTime ?? null).toBe(
          golden.expect.earliestStartTime,
        );
      }
      if (golden.expect.deadline !== undefined) {
        expect(result.task?.deadline ?? null).toBe(golden.expect.deadline);
      }

      const harvest = buildVoiceParseResultLog({
        parseId: golden.id,
        transcript: golden.transcript,
        timeZone: CREATE_KIND_WHEN_GOLDEN_ANCHORS.timeZone,
        nowIso: CREATE_KIND_WHEN_GOLDEN_ANCHORS.nowIso,
        routerIntent: 'create',
        sniffed: null,
        intent: 'create',
        specialistIntent: 'create',
        language: golden.language,
        result: { ...result, command: null },
      });
      expect(harvest.kind).toBe(golden.expect.kind);
      expect(harvest.taskName).toBe(golden.expect.taskName);
      expect(harvest.understanding).toBe(golden.expect.understanding);
    },
  );
});
