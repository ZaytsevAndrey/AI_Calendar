export const PHASE_SETUP_PATH = '/setup/phases';

export type PhaseSetupStep = 'sleep' | 'phases';

/** App nav stays hidden until wake/sleep are saved and phases exist. */
export function showsAppShell(pathname: string): boolean {
  return pathname !== PHASE_SETUP_PATH;
}

/** Day shape and skip are only on the second step, after wake and sleep are saved. */
export function phaseSetupOffersDayShape(step: PhaseSetupStep): boolean {
  return step === 'phases';
}
