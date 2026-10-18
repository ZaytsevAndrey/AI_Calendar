import { test, expect, openAs, uniqueName } from '../helpers/fixtures';
import { mockVoiceCapture, stubAgentTurns, turnMicOff, typeOnce } from '../helpers/voice';

function createIntent(name: string) {
  return {
    type: 'create',
    summary: `Created ${name}.`,
    task: { name, eventType: 'admin', estimatedTimeInMinutes: 30, priority: 'medium' },
  };
}

function tomorrowYmd(): string {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function planItem(day: string, itemId: string, name: string, source: string, hour: number) {
  const hh = String(hour).padStart(2, '0');
  return {
    itemId,
    taskId: source === 'new' ? null : itemId,
    source,
    name,
    start: `${day}T${hh}:00:00.000Z`,
    end: `${day}T${hh}:30:00.000Z`,
    durationMinutes: 30,
  };
}

async function openCompanion(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Open Companion' }).click();
  await turnMicOff(page);
  return page.getByRole('dialog', { name: 'Companion' });
}

test.describe('P1 Companion agent: multi-intent and day plan', () => {
  test('U-VOI-013 one utterance with two writes shows both cards, applies them and reports', async ({
    page,
    auth,
  }) => {
    const first = uniqueName('Multi bread');
    const second = uniqueName('Multi call');
    const intents = [createIntent(first), createIntent(second)];
    await mockVoiceCapture(page);
    const { turns } = await stubAgentTurns(page, (body) => {
      if (body.actionId === 'confirm') {
        return { outcome: 'act', assistantMessage: 'Created both.', intents };
      }
      if (body.actionId === 'report') return {};
      return {
        outcome: 'confirm',
        assistantMessage: `Create ${first}. Create ${second}.`,
        actions: ['confirm', 'cancel'],
        intents,
        segments: [
          { summary: first, status: 'ready' },
          { summary: second, status: 'ready' },
        ],
      };
    });

    await openAs(page, auth.onboarded, '/tasks');
    const sheet = await openCompanion(page);
    await typeOnce(page, 'buy bread and call mom');

    const preview = sheet.getByTestId('change-preview');
    await expect(preview.getByText(first)).toBeVisible();
    await expect(preview.getByText(second)).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByRole('heading', { name: first }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: second }).first()).toBeVisible();
    await expect
      .poll(() => turns.find((turn) => turn.actionId === 'report')?.executionReport?.results.map((row) => row.status))
      .toEqual(['applied', 'applied']);
    await expect(sheet.getByText('Done just now')).toBeVisible();
    await expect(sheet.getByText('Applied', { exact: true })).toHaveCount(2);
  });

  test('U-VOI-014 day plan: interview, build, voice edit highlights the change, apply', async ({
    page,
    auth,
  }) => {
    const day = tomorrowYmd();
    const gym = uniqueName('Plan gym');
    const first = planItem(day, 'a', 'Plan taxes', 'unscheduled', 7);
    const second = planItem(day, 'b', 'Plan email', 'flexible', 9);
    const added = planItem(day, 'new:1', gym, 'new', 15);
    const plan = (revision: number, extra: Record<string, unknown> = {}) => ({
      day,
      stage: 'review',
      revision,
      items: [first, second],
      unplaced: [],
      changedItemIds: [],
      ...extra,
    });

    await mockVoiceCapture(page);
    const { turns } = await stubAgentTurns(page, (body) => {
      if (body.actionId === 'build_plan') {
        return { outcome: 'confirm', assistantMessage: 'Here is the plan.', actions: ['confirm', 'cancel'], plan: plan(1) };
      }
      if (body.actionId === 'confirm') {
        return { outcome: 'act', assistantMessage: 'Applying the plan.', intents: [createIntent(gym)] };
      }
      if (body.actionId === 'report') return {};
      if (body.transcript === 'add gym in the afternoon') {
        return {
          outcome: 'confirm',
          assistantMessage: 'Added gym.',
          actions: ['confirm', 'cancel'],
          plan: plan(2, {
            items: [first, second, added],
            unplaced: [{ itemId: 'c', name: 'Plan long essay', reason: 'no_room' }],
            changedItemIds: ['new:1', 'c'],
          }),
        };
      }
      return {
        outcome: 'clarify',
        assistantMessage: 'What matters most tomorrow?',
        actions: ['build_plan', 'cancel'],
        plan: { day, stage: 'interview', revision: 0, items: [], unplaced: [], changedItemIds: [] },
      };
    });

    await openAs(page, auth.onboarded, '/tasks');
    const sheet = await openCompanion(page);
    await typeOnce(page, 'plan tomorrow with me');

    await expect(sheet.getByText(`Planning ${day}`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Make plan' }).click();

    const preview = sheet.getByTestId('change-preview');
    await expect(preview.getByText(`Plan for ${day}`)).toBeVisible();
    await expect(preview.getByText('Plan taxes')).toBeVisible();
    await expect(preview.locator('[data-changed="true"]')).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Apply' })).toBeVisible();

    await typeOnce(page, 'add gym in the afternoon');
    const changed = preview.locator('[data-changed="true"]');
    await expect(changed).toHaveCount(1);
    await expect(changed).toContainText(gym);
    await expect(changed).toContainText('Changed');
    await expect(preview.getByText('Did not fit')).toBeVisible();
    await expect(preview.getByText('Plan long essay')).toBeVisible();

    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('heading', { name: gym }).first()).toBeVisible();
    await expect.poll(() => turns.map((turn) => turn.actionId ?? 'text')).toEqual([
      'text',
      'build_plan',
      'text',
      'confirm',
      'report',
    ]);
    await expect(sheet.getByTestId('change-preview')).toHaveCount(0);
  });

  test('U-VOI-015 closing the sheet discards the plan draft', async ({ page, auth }) => {
    const day = tomorrowYmd();
    await mockVoiceCapture(page);
    const { turns, endedSessions } = await stubAgentTurns(page, () => ({
      outcome: 'confirm',
      assistantMessage: 'Here is the plan.',
      actions: ['confirm', 'cancel'],
      plan: {
        day,
        stage: 'review',
        revision: 1,
        items: [planItem(day, 'a', 'Draft only', 'unscheduled', 8)],
        unplaced: [],
        changedItemIds: [],
      },
    }));

    await openAs(page, auth.onboarded, '/tasks');
    const sheet = await openCompanion(page);
    await typeOnce(page, 'plan tomorrow');
    await expect(sheet.getByTestId('change-preview').getByText('Draft only')).toBeVisible();

    await sheet.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Companion' })).toHaveCount(0);
    await expect.poll(() => endedSessions).toEqual([turns[0].sessionId]);

    const reopened = await openCompanion(page);
    await expect(reopened.getByTestId('change-preview')).toHaveCount(0);
    await expect(reopened.getByText('Draft only')).toHaveCount(0);
  });
});
