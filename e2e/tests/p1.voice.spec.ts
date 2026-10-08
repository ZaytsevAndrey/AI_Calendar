import { test, expect, openAs, apiJson, expectOk, uniqueName } from '../helpers/fixtures';
import { mockVoiceCapture, stubVoiceApis, recordOnce } from '../helpers/voice';

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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await expect(page.getByRole('dialog').getByText('Add task by voice')).toBeVisible();
    await recordOnce(page);
    await expect(page.getByText('Task created')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Voice dentist' }).first()).toBeVisible();
  });

  test('U-VOI-002 sufficient parse opens the wizard prefilled', async ({ page, auth }) => {
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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    const wizard = page.getByRole('dialog');
    await expect(wizard.getByRole('textbox', { name: /Name/ })).toHaveValue('Voice draft');
    await expect(wizard.getByLabel(/Duration/)).toHaveValue('45');
  });

  test('U-VOI-003 clarification is asked only once', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await stubVoiceApis(page, (body) => {
      if (body.clarificationAnswer) {
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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('What should I call this task?')).toBeVisible();
    await recordOnce(page);
    await expect(page.getByText('Task created')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clarified walk' }).first()).toBeVisible();
    await expect(page.getByText('What should I call this task?')).toHaveCount(0);
  });

  test('U-VOI-006 voice complete follows the confirmation setting', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    const turnedOff = await apiJson(request, token, 'patch', '/user-settings', {
      confirmVoiceCommands: false,
    });
    expectOk(turnedOff);

    const immediateName = uniqueName('Voice done');
    const immediate = await apiJson(request, token, 'post', '/tasks', {
      name: immediateName,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      priority: 'medium',
    });
    expectOk(immediate);

    const confirmedName = uniqueName('Voice confirm');
    const confirmed = await apiJson(request, token, 'post', '/tasks', {
      name: confirmedName,
      eventType: 'admin',
      estimatedTimeInMinutes: 30,
      priority: 'medium',
    });
    expectOk(confirmed);

    let command = {
      taskId: immediate.body.id as string,
      taskName: immediateName,
    };
    await mockVoiceCapture(page);
    await stubVoiceApis(
      page,
      () => ({
        understanding: 'complete',
        clarifyingQuestion: null,
        task: null,
        command: {
          kind: 'complete',
          taskId: command.taskId,
          taskName: command.taskName,
          summary: `Mark "${command.taskName}" done?`,
        },
      }),
      'done',
    );
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    await expect(page.getByText('Task completed')).toBeVisible();

    const turnedOn = await apiJson(request, token, 'patch', '/user-settings', {
      confirmVoiceCommands: true,
    });
    expectOk(turnedOn);
    command = { taskId: confirmed.body.id as string, taskName: confirmedName };
    await page.reload();
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(`Mark "${confirmedName}" done?`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Task completed')).toBeVisible();

    const restored = await apiJson(request, token, 'patch', '/user-settings', {
      confirmVoiceCommands: false,
    });
    expectOk(restored);
  });

  test('U-VOI-008 delete always asks to confirm', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    const settings = await apiJson(request, token, 'patch', '/user-settings', {
      confirmVoiceCommands: false,
    });
    expectOk(settings);

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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText(`Delete "${name}"?`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Task deleted')).toBeVisible();
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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: /Start speaking|Answer/ }).click();
    await expect(sheet.getByText('Listening…', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('img', { name: 'Microphone level' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Stop' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
  });

  test('U-VOI-010 Speak replies toggle is in Settings', async ({ page, auth, request }) => {
    const token = auth.onboarded.access_token;
    const primed = await apiJson(request, token, 'patch', '/user-settings', {
      speakVoiceReplies: true,
    });
    expectOk(primed);

    await openAs(page, auth.onboarded, '/settings');
    const speak = page.getByRole('checkbox', { name: 'Speak replies' });
    await expect(speak).toBeVisible();
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
    await page.route('**/voice/parse-task', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          understanding: 'complete',
          clarifyingQuestion: null,
          task: {
            name: 'Voice conflict task',
            eventType: 'admin',
            estimatedTimeInMinutes: 30,
            priority: 'medium',
          },
          command: null,
        }),
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
                options: ['move_new', 'leave_problematic'],
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
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    const voice = page.getByRole('dialog', { name: 'Add task by voice' });
    await voice.getByRole('button', { name: /Start speaking|Answer/ }).click();
    await expect(voice.getByText('Listening…', { exact: true })).toBeVisible();
    await voice.getByRole('button', { name: 'Stop' }).click();

    await expect(page.getByRole('dialog', { name: 'Schedule conflict' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('dialog', { name: 'Add task by voice' })).toHaveCount(0);

    spoken = 'place this task elsewhere';
    const conflict = page.getByRole('dialog', { name: 'Schedule conflict' });
    await conflict.getByRole('button', { name: 'Answer by voice' }).click();
    await expect(voice.getByText(/How should we resolve the schedule conflict/)).toBeVisible();
    await voice.getByRole('button', { name: /Answer|Start speaking/ }).click();
    await expect(voice.getByText('Listening…', { exact: true })).toBeVisible();
    await voice.getByRole('button', { name: 'Stop' }).click();

    await expect(page.getByText('Conflict choice applied')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Schedule conflict' })).toHaveCount(0);
  });
});
