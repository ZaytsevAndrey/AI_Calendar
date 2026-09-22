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
    await expect(page.getByRole('heading', { name: 'Voice dentist' })).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Clarified walk' })).toBeVisible();
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
});
