import { test, expect, openAs } from '../helpers/fixtures';
import { denyMicrophone, mockVoiceCapture, recordOnce } from '../helpers/voice';

test.describe('P2 voice UI', () => {
  test('U-VOI-004 mic permission denied stays in the sheet', async ({ page, auth }) => {
    await denyMicrophone(page);
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: 'Start speaking' }).click();
    await expect(
      sheet.getByText('Microphone permission is required. Allow it in the browser, then try again.'),
    ).toBeVisible();
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  });

  test('U-VOI-005 transcribe failure surfaces in the sheet', async ({ page, auth }) => {
    await mockVoiceCapture(page);
    await page.route('**/voice/transcribe', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Could not transcribe audio' }),
      });
    });
    await openAs(page, auth.onboarded, '/tasks');
    await page.getByRole('button', { name: 'Add task by voice' }).click();
    await recordOnce(page);
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Could not transcribe audio')).toBeVisible();
    await expect(sheet).toBeVisible();
  });
});
