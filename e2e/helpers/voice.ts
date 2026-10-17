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
    // Instant TTS so Speak replies does not stall Playwright.
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      cancel() {},
      pause() {},
      resume() {},
      speak(utterance: { onend?: (() => void) | null; onerror?: (() => void) | null }) {
        queueMicrotask(() => utterance.onend?.());
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
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
  await page.route('**/voice/turn', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const legacyParse = parse(body);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: body.sessionId || 'e2e-session',
        outcome: 'legacy_parse',
        assistantMessage: '',
        intents: [],
        actions: [],
        proposal: null,
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
}

/** Finish one auto-started recording (sheet begins Listening on open). */
export async function recordOnce(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Listening/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
}

/** Turn the mic off (default is on) so typed turns are not raced by silence-end. */
export async function turnMicOff(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Mic on' }).click();
  await expect(dialog.getByRole('button', { name: 'Mic off' })).toBeVisible();
  await expect(dialog.getByText(/Listening/)).toHaveCount(0);
}

/** Send a typed message through the voice sheet composer. */
export async function typeOnce(page: Page, text: string): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Type a message…').fill(text);
  await dialog.getByRole('button', { name: 'Send' }).click();
}
