import apiCall from 'modules/common/utils/apiCall';
import type { CreateTaskDTO } from './tasks.api';

export type VoiceUnderstanding = 'complete' | 'sufficient' | 'needs_clarification';

export type VoiceParsedTask = CreateTaskDTO;

export type VoiceParseResult = {
  understanding: VoiceUnderstanding;
  clarifyingQuestion: string | null;
  task: VoiceParsedTask | null;
};

export type TranscribeVoiceResult = {
  transcript: string;
  language?: string;
};

export const VoiceApi = {
  transcribe: async (audioBase64: string, mimeType: string): Promise<TranscribeVoiceResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/transcribe',
      data: { audioBase64, mimeType },
    });
    if (!response) throw new Error('No response from server');
    return response.data as TranscribeVoiceResult;
  },

  parseTask: async (body: {
    transcript: string;
    timeZone: string;
    clientNowIso?: string;
    previousTranscript?: string;
    clarificationAnswer?: string;
  }): Promise<VoiceParseResult> => {
    const response = await apiCall({
      method: 'POST',
      url: '/voice/parse-task',
      data: body,
    });
    if (!response) throw new Error('No response from server');
    return response.data as VoiceParseResult;
  },
};
