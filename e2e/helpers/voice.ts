import { expect, type Page } from '@playwright/test';

/** Fake getUserMedia + MediaRecorder so voice tests never need a real mic. */
export async function mockVoiceCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class FakeMediaRecorder {
      state = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream?: unknown, options?: { mimeType?: string }) {
        if (options?.mimeType) this.mimeType = options.mimeType;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        const data = new Blob([new Uint8Array(512)], { type: this.mimeType });
        queueMicrotask(() => {
          this.ondataavailable?.({ data });
          this.onstop?.();
        });
      }
    }
    (FakeMediaRecorder as unknown as { isTypeSupported: () => boolean }).isTypeSupported = () => true;
    (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
    navigator.mediaDevices.getUserMedia = async () =>
      ({
        getTracks: () => [{ stop() {} }],
      }) as MediaStream;
  });
}

/** Reject getUserMedia so U-VOI-004 never needs a real permission prompt. */
export async function denyMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const err = new Error('Permission denied');
      err.name = 'NotAllowedError';
      throw err;
    };
  });
}

export async function stubVoiceApis(
  page: Page,
  parse: (body: Record<string, unknown>) => unknown,
  transcript = 'buy milk',
): Promise<void> {
  await page.route('**/voice/transcribe', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ transcript, language: 'en' }),
    });
  });
  await page.route('**/voice/parse-task', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(parse(body)),
    });
  });
}

export async function recordOnce(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Start speaking|Answer/ }).click();
  await expect(dialog.getByText(/Listening/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop' }).click();
}
