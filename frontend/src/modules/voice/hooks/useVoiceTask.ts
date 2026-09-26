import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useSkipOccurrenceMutation, useUpdateEventMutation } from 'api/eventTasksApi';
import { VoiceApi, type VoiceCommandAction, type VoiceParsedTask } from 'api/voice.api';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import {
  getPendingConflictChoice,
  notifyConflictChoiceConsumed,
  waitForScheduleConflict,
  type SchedulingConflictDTO,
} from 'modules/schedule/conflictChoiceBus';
import { applyConflictOption } from 'modules/schedule/applyConflictOption';
import { resolveSpokenConflictOption } from 'modules/schedule/resolveSpokenConflictOption';
import i18n from 'i18n';
import { showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { executeVoiceCommand } from '../executeVoiceCommand';
import { useAudioRecorder } from './useAudioRecorder';

export type VoiceStage =
  | 'idle'
  | 'recording'
  | 'working'
  | 'clarifying'
  | 'recording_clarification'
  | 'needs_conflict_choice'
  | 'confirm'
  | 'error';

type UseVoiceTaskOptions = {
  onComplete: (task: VoiceParsedTask) => Promise<void>;
  onSufficient: (task: VoiceParsedTask) => void;
};

export function useVoiceTask({ onComplete, onSufficient }: UseVoiceTaskOptions) {
  const { start, stop, cancel, error: recorderError } = useAudioRecorder();
  const { data: userSettings } = useGetUserSettingsQuery();
  const confirmCommands = !!userSettings?.confirmVoiceCommands;
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const dispatch = useDispatch();
  // Same IANA as the task form / engine, not the browser zone.
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [transcript, setTranscript] = useState('');
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState(() => i18n.t('voice.working'));
  const [pendingCommand, setPendingCommand] = useState<VoiceCommandAction | null>(null);
  const [heldConflict, setHeldConflict] = useState<SchedulingConflictDTO | null>(null);

  const reset = useCallback(() => {
    cancel();
    setStage('idle');
    setTranscript('');
    setClarifyingQuestion(null);
    setPendingCommand(null);
    setHeldConflict(null);
    setError(null);
  }, [cancel]);

  const close = useCallback(() => {
    reset();
    setIsOpen(false);
  }, [reset]);

  const open = useCallback(() => {
    cancel();
    setTranscript('');
    setPendingCommand(null);
    setError(null);
    const pending = getPendingConflictChoice();
    if (pending) {
      setHeldConflict(pending);
      setClarifyingQuestion(i18n.t('voice.pickConflictOption'));
      setStage('needs_conflict_choice');
    } else {
      setHeldConflict(null);
      setClarifyingQuestion(null);
      setStage('idle');
    }
    setIsOpen(true);
  }, [cancel]);

  const runCommand = useCallback(
    async (command: VoiceCommandAction) => {
      setBusyLabel(i18n.t('voice.saving'));
      setStage('working');
      try {
        const waitConflict =
          command.kind === 'window' ? waitForScheduleConflict(12_000) : Promise.resolve(null);
        await executeVoiceCommand(command, { updateTask, skipOccurrence, dispatch });
        if (command.kind === 'window') {
          await waitConflict;
        }
        close();
      } catch (err) {
        setError(extractApiErrorMessage(err));
        setStage('error');
      }
    },
    [close, dispatch, skipOccurrence, updateTask],
  );

  const applySpokenConflict = useCallback(
    async (spoken: string, conflict: SchedulingConflictDTO): Promise<'applied' | 'unclear' | 'error'> => {
      const optionId = resolveSpokenConflictOption(spoken, conflict.options);
      if (!optionId) return 'unclear';
      setBusyLabel(i18n.t('voice.saving'));
      setStage('working');
      try {
        await applyConflictOption(conflict, optionId, {
          updateTask: (id, body) => updateTask({ id, body }).unwrap(),
          skipOccurrence: (id, body) => skipOccurrence({ id, body }).unwrap(),
        });
        notifyConflictChoiceConsumed(conflict.taskId);
        showSuccessToast({ title: i18n.t('schedule.conflictApplied') });
        close();
        return 'applied';
      } catch (err) {
        setError(extractApiErrorMessage(err));
        setStage('error');
        return 'error';
      }
    },
    [close, skipOccurrence, updateTask],
  );

  const parseAndRoute = useCallback(
    async (text: string, clarification?: { previous: string; answer: string }) => {
      setBusyLabel(i18n.t('voice.understanding'));
      setStage('working');
      const result = await VoiceApi.parseTask({
        transcript: clarification?.answer ?? text,
        timeZone,
        clientNowIso: new Date().toISOString(),
        previousTranscript: clarification?.previous,
        clarificationAnswer: clarification?.answer,
      });

      if (result.command) {
        if (result.command.kind === 'refuse') {
          setError(result.command.message);
          setStage('error');
          return;
        }
        if (confirmCommands) {
          setPendingCommand(result.command);
          setStage('confirm');
          return;
        }
        await runCommand(result.command);
        return;
      }

      if (result.understanding === 'needs_clarification') {
        setClarifyingQuestion(result.clarifyingQuestion || i18n.t('voice.clarifyMore'));
        setStage('clarifying');
        return;
      }

      if (!result.task?.name) {
        setClarifyingQuestion(i18n.t('voice.askName'));
        setStage('clarifying');
        return;
      }

      if (result.understanding === 'complete') {
        const waitConflict = waitForScheduleConflict(12_000);
        await onComplete(result.task);
        await waitConflict;
        close();
        return;
      }

      close();
      onSufficient(result.task);
    },
    [close, confirmCommands, onComplete, onSufficient, runCommand, timeZone],
  );

  const beginRecording = useCallback(async () => {
    setError(null);
    try {
      await start();
      setStage((current) =>
        current === 'clarifying' || current === 'needs_conflict_choice'
          ? 'recording_clarification'
          : 'recording',
      );
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const message = err instanceof Error ? err.message : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError(i18n.t('voice.micPermission'));
      } else if (message === 'unsupported') {
        setError(i18n.t('voice.micUnsupported'));
      } else {
        setError(i18n.t('voice.micFailed'));
      }
      setStage('error');
    }
  }, [start]);

  const finishRecording = useCallback(async () => {
    const previousTranscript = transcript;
    const wasConflictTurn = stage === 'needs_conflict_choice' || Boolean(heldConflict);
    const wasClarifying = Boolean(clarifyingQuestion) && !wasConflictTurn;
    try {
      setBusyLabel(i18n.t('voice.transcribing'));
      setStage('working');
      const { base64, mimeType } = await stop();
      const { transcript: spoken } = await VoiceApi.transcribe(base64, mimeType);
      setTranscript(spoken);

      const conflict = heldConflict ?? getPendingConflictChoice();
      if (conflict) {
        const outcome = await applySpokenConflict(spoken, conflict);
        if (outcome === 'applied' || outcome === 'error') return;
        if (wasConflictTurn) {
          setError(i18n.t('voice.conflictOptionUnclear'));
          setClarifyingQuestion(i18n.t('voice.pickConflictOption'));
          setHeldConflict(conflict);
          setStage('needs_conflict_choice');
          return;
        }
      }

      if (wasClarifying) {
        await parseAndRoute(spoken, { previous: previousTranscript, answer: spoken });
      } else {
        await parseAndRoute(spoken);
      }
    } catch (err) {
      setError(extractApiErrorMessage(err));
      if (wasConflictTurn) setStage('needs_conflict_choice');
      else if (wasClarifying) setStage('clarifying');
      else setStage('error');
    }
  }, [
    applySpokenConflict,
    clarifyingQuestion,
    heldConflict,
    parseAndRoute,
    stage,
    stop,
    transcript,
  ]);

  return {
    isOpen,
    open,
    close,
    stage,
    transcript,
    clarifyingQuestion,
    pendingSummary: pendingCommand?.summary ?? null,
    error: error || recorderError,
    busyLabel,
    beginRecording,
    finishRecording,
    confirmCommand: () => {
      if (pendingCommand) void runCommand(pendingCommand);
    },
    isRecording: stage === 'recording' || stage === 'recording_clarification',
    isWorking: stage === 'working',
  };
}
