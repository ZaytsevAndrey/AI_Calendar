import {
  test,
  expect,
  openAs,
  apiJson,
  expectOk,
  uniqueName,
  expectMutationProgressToast,
} from '../helpers/fixtures';
import { mockVoiceCapture, stubVoiceApis, recordOnce, turnMicOff, typeOnce } from '../helpers/voice';

test.describe('P1 voice UI', () => {
  test('U-VOI-001 complete parse creates a task from the sheet', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => ({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Voice dentist',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        priority: 'medium',
      },
    }));
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    const sheet = page.getByRole('dialog', { name: 'Companion' });
    await expect(sheet).toBeVisible();
    await recordOnce(page);
    const preview = sheet.getByTestId('change-preview');
    await expect(preview.getByText('Voice dentist')).toBeVisible();
    await expect(preview.getByText('Create', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Voice dentist' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Voice dentist');
    await expect(sheet.getByText('Done just now')).toBeVisible();
    await expect(preview.getByText('Applied', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Voice dentist' }).first()).toBeVisible();
  });

  test('U-VOI-002 sufficient parse creates like complete', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => ({
      understanding: 'sufficient',
      clarifyingQuestion: null,
      task: {
        name: 'Voice draft',
        eventType: 'admin',
        estimatedTimeInMinutes: 45,
        priority: 'high',
      },
    }));
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    const sheet = page.getByRole('dialog', { name: 'Companion' });
    await recordOnce(page);
    await expect(sheet.getByTestId('change-preview').getByText('Voice draft')).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Voice draft');
    await expect(page.getByRole('heading', { name: 'Voice draft' }).first()).toBeVisible();
  });

  test('U-VOI-003 clarification is asked only once', async ({ page, auth }) => {
    // `/voice/turn` sends the follow-up as transcript (not clarificationAnswer).
    let userTurns = 0;
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => {
      userTurns += 1;
      if (userTurns >= 2) {
        return {
          understanding: 'complete',
          clarifyingQuestion: null,
          task: {
            name: 'Clarified walk',
            eventType: 'admin',
            estimatedTimeInMinutes: 30,
            priority: 'medium',
          },
        };
      }
      return {
        understanding: 'needs_clarification',
        clarifyingQuestion: 'What should I call this task?',
        task: null,
      };
    });
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('What should I call this task?')).toBeVisible();
    await recordOnce(page);
    await expect(sheet.getByTestId('change-preview').getByText('Clarified walk')).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Clarified walk');
    await expect(page.getByRole('heading', { name: 'Clarified walk' }).first()).toBeVisible();
    // Sheet stays open for follow-up; clarify line may remain in the thread.
  });

  test('U-VOI-006 completing a task shows a preview card, then Apply', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    const name = uniqueName('Voice done');
    const created = await apiJson(request, token, 'post', '/tasks', {
      name,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      priority: 'medium',
    });
    expectOk(created);

    await mockVoiceCapture(page);
    await stubVoiceApis(
      page,
      () => ({
        understanding: 'complete',
        clarifyingQuestion: null,
        task: null,
        command: {
          kind: 'complete',
          taskId: created.body.id as string,
          taskName: name,
          summary: `Mark "${name}" done?`,
        },
      }),
      'done',
    );
    await openAs(page, auth.onboarded, '/tasks');
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.getByRole('button', { name: 'Open Companion' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    const confirmCard = sheet.getByTestId('change-preview');
    await expect(confirmCard.getByText(name)).toBeVisible();
    await expect(confirmCard.getByText('Complete', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, name);
    await expect(page.getByRole('heading', { name })).toHaveCount(0);
    await expect(sheet.getByText('Done just now')).toBeVisible();
    await expect(confirmCard.getByText('Applied', { exact: true })).toBeVisible();
  });

  test('U-VOI-008 delete shows a preview card, then Apply', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    const name = uniqueName('Voice delete');
    const created = await apiJson(request, token, 'post', '/tasks', {
      name,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      priority: 'medium',
    });
    expectOk(created);

    await mockVoiceCapture(page);
    await stubVoiceApis(
      page,
      () => ({
        understanding: 'complete',
        clarifyingQuestion: null,
        task: null,
        command: {
          kind: 'delete',
          taskId: created.body.id as string,
          taskName: name,
          summary: `Delete "${name}"?`,
        },
      }),
      'delete task',
    );
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    const deleteCard = sheet.getByTestId('change-preview');
    await expect(deleteCard.getByText(name)).toBeVisible();
    await expect(deleteCard.getByText('Delete', { exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, name);
  });

  test('U-VOI-009 listening shows equalizer bars', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => ({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Equalizer task',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        priority: 'medium',
      },
    }));
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/Listening/)).toBeVisible();
    await expect(sheet.getByRole('img', { name: 'Microphone level' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet.getByTestId('change-preview').getByText('Equalizer task')).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Equalizer task');
  });

  test('U-VOI-011 typed message creates a task without STT', async ({ page, auth }) => {
    let transcribed = false;
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => ({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Typed milk',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        priority: 'medium',
      },
    }));
    // LIFO: this handler runs before the stub and flags any accidental STT call.
    await page.route('**/voice/transcribe', async (route) => {
      if (route.request().method() === 'POST') transcribed = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ transcript: 'should-not-run', language: 'en' }),
      });
    });
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    await turnMicOff(page);
    await typeOnce(page, 'buy milk typed');
    const sheet = page.getByRole('dialog', { name: 'Companion' });
    await expect(sheet.getByTestId('change-preview').getByText('Typed milk')).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Typed milk');
    await expect(page.getByRole('heading', { name: 'Typed milk' }).first()).toBeVisible();
    expect(transcribed).toBe(false);
  });

  test('U-VOI-012 mic off stops listening; typed still works', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await stubVoiceApis(page, () => ({
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Mic off typed',
        eventType: 'admin',
        estimatedTimeInMinutes: 20,
        priority: 'low',
      },
    }));
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(/Listening/)).toBeVisible();
    await turnMicOff(page);
    await expect(sheet.getByRole('button', { name: 'Done' })).toHaveCount(0);
    await typeOnce(page, 'create from keyboard');
    await expect(sheet.getByTestId('change-preview').getByText('Mic off typed')).toBeVisible();
    await sheet.getByRole('button', { name: 'Apply' }).click();
    await expectMutationProgressToast(page, 'Mic off typed');
    await expect(page.getByRole('heading', { name: 'Mic off typed' }).first()).toBeVisible();
  });

  test('U-VOI-010 Speak replies toggle is in Settings', async ({ page, auth }) => {
    await openAs(page, auth.onboarded, '/settings');
    const speak = page.getByRole('checkbox', { name: 'Speak replies' });
    await expect(speak).toBeVisible();
    // Shared e2e user may already be off from a prior run — normalize via UI.
    if (!(await speak.isChecked())) {
      await speak.click();
      await expect(page.getByText('Speak replies on')).toBeVisible();
    }
    await expect(speak).toBeChecked();
    await speak.click();
    await expect(page.getByText('Speak replies off')).toBeVisible();
  });

  test('U-VOI-007 voice create conflict offers sheet and spoken option', async ({ page, auth }) => {
    const taskId = 'voice-conflict-task';
    const jobId = 'voice-conflict-job';
    let spoken = 'add Voice conflict task';

    await mockVoiceCapture(page);
    await page.route('**/voice/transcribe', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ transcript: spoken, language: 'en' }),
      });
    });
    const legacyParse = {
      understanding: 'complete',
      clarifyingQuestion: null,
      task: {
        name: 'Voice conflict task',
        eventType: 'admin',
        estimatedTimeInMinutes: 30,
        priority: 'medium',
      },
      command: null,
    };
    await page.route('**/voice/parse-task', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(legacyParse),
      });
    });
    await page.route('**/voice/turn', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = route.request().postDataJSON() as { sessionId?: string };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: body.sessionId || 'e2e-session',
          outcome: 'legacy_parse',
          assistantMessage: '',
          intents: [],
          actions: [],
          plan: null,
          segments: [],
          clarifyCount: 0,
          legacyParse,
        }),
      });
    });
    await page.route('**/voice/session/**', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });
    await page.route('**/tasks', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: taskId,
          name: 'Voice conflict task',
          eventType: 'admin',
          estimatedTimeInMinutes: 30,
          priority: 'medium',
          status: 'todo',
          jobId,
        }),
      });
    });
    await page.route(`**/schedule-jobs/${jobId}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: jobId,
          status: 'completed',
          result: {
            conflicts: [
              {
                taskId,
                taskName: 'Voice conflict task',
                reason: 'preferred_on_fixed',
                options: ['place_on_top', 'move_new', 'leave_problematic'],
              },
            ],
          },
        }),
      });
    });
    await page.route(`**/tasks/${taskId}`, async (route) => {
      if (route.request().method() !== 'PATCH') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: taskId,
          name: 'Voice conflict task',
          scheduleState: 'none',
          scheduledStartTime: null,
          scheduledEndTime: null,
        }),
      });
    });

    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Open Companion' }).click();
    const voice = page.getByRole('dialog', { name: 'Companion' });
    await recordOnce(page);
    await expect(voice.getByTestId('change-preview').getByText('Voice conflict task')).toBeVisible();
    await voice.getByRole('button', { name: 'Apply' }).click();

    await expect(page.getByRole('dialog', { name: 'Schedule conflict' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('dialog', { name: 'Companion' })).toHaveCount(0);

    spoken = 'place this task elsewhere';
    const conflict = page.getByRole('dialog', { name: 'Schedule conflict' });
    await conflict.getByRole('button', { name: 'Answer by voice' }).click();
    await expect(voice.getByText(/How should we resolve the schedule conflict/)).toBeVisible();
    // Conflict answer re-opens the sheet and auto-starts Listening again.
    await recordOnce(page);

    await expectMutationProgressToast(page, 'Voice conflict task');
    await expect(page.getByRole('dialog', { name: 'Schedule conflict' })).toHaveCount(0);
  });
});
