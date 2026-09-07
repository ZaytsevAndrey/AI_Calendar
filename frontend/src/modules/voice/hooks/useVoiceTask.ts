import { useCallback, useState } from 'react';
import { VoiceApi, type VoiceParsedTask } from 'api/voice.api';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { useAudioRecorder } from './useAudioRecorder';

export type VoiceStage =
  | 'idle'
  | 'recording'
  | 'working'
  | 'clarifying'
  | 'recording_clarification'
  | 'error';

type UseVoiceTaskOptions = {
  onComplete: (task: VoiceParsedTask) => Promise<void>;
  onSufficient: (task: VoiceParsedTask) => void;
};

export function useVoiceTask({ onComplete, onSufficient }: UseVoiceTaskOptions) {
  const { start, stop, cancel, error: recorderError } = useAudioRecorder();
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [transcript, setTranscript] = useState('');
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState('Working…');

  const reset = useCallback(() => {
    cancel();
    setStage('idle');
    setTranscript('');
    setClarifyingQuestion(null);
    setError(null);
  }, [cancel]);

  const close = useCallback(() => {
    reset();
    setIsOpen(false);
  }, [reset]);

  const open = useCallback(() => {
    reset();
    setIsOpen(true);
  }, [reset]);

  const parseAndRoute = useCallback(
    async (text: string, clarification?: { previous: string; answer: string }) => {
      setBusyLabel('Understanding…');
      setStage('working');
      const result = await VoiceApi.parseTask({
        transcript: clarification?.answer ?? text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        clientNowIso: new Date().toISOString(),
        previousTranscript: clarification?.previous,
        clarificationAnswer: clarification?.answer,
      });

      if (result.understanding === 'needs_clarification') {
        setClarifyingQuestion(result.clarifyingQuestion || 'Could you add a bit more detail?');
        setStage('clarifying');
        return;
      }

      if (!result.task?.name) {
        setClarifyingQuestion('What should I call this task?');
        setStage('clarifying');
        return;
      }

      if (result.understanding === 'complete') {
        await onComplete(result.task);
        close();
        return;
      }

      close();
      onSufficient(result.task);
    },
    [close, onComplete, onSufficient],
  );

  const beginRecording = useCallback(async () => {
    setError(null);
    try {
      await start();
      setStage((current) => (current === 'clarifying' ? 'recording_clarification' : 'recording'));
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Microphone permission is required. Allow it in the browser, then try again.');
      } else if (message === 'unsupported') {
        setError('This browser cannot record audio. Try Chrome on Android, or Safari 14.3+.');
      } else {
        setError('Could not start the microphone.');
      }
      setStage('error');
    }
  }, [start]);

  const finishRecording = useCallback(async () => {
    const previousTranscript = transcript;
    const answering = Boolean(clarifyingQuestion);
    try {
      setBusyLabel('Transcribing…');
      setStage('working');
      const { base64, mimeType } = await stop();
      const { transcript: spoken } = await VoiceApi.transcribe(base64, mimeType);
      setTranscript(spoken);
      if (answering) {
        await parseAndRoute(spoken, { previous: previousTranscript, answer: spoken });
      } else {
        await parseAndRoute(spoken);
      }
    } catch (err) {
      setError(extractApiErrorMessage(err));
      setStage(answering ? 'clarifying' : 'error');
    }
  }, [clarifyingQuestion, parseAndRoute, stop, transcript]);

  return {
    isOpen,
    open,
    close,
    stage,
    transcript,
    clarifyingQuestion,
    error: error || recorderError,
    busyLabel,
    beginRecording,
    finishRecording,
    isRecording: stage === 'recording' || stage === 'recording_clarification',
    isWorking: stage === 'working',
  };
}
