import type { VoiceWriteIntent } from '../../voice-agent.types';

/**
 * Payload a future client would send after the user confirms a preview.
 * This repository has no voice Apply screen. The production controller does not call arm A.
 */
export type FrontendApplyRequest = {
  sessionId: string;
  intents: VoiceWriteIntent[];
};

export function frontendApplyRequest(sessionId: string, intents: VoiceWriteIntent[]): FrontendApplyRequest {
  return {
    sessionId,
    intents: intents.map((intent) => intent.type === 'create'
      ? { type: 'create', summary: intent.summary, task: intent.task }
      : { type: 'command', summary: intent.summary, command: intent.command }),
  };
}
