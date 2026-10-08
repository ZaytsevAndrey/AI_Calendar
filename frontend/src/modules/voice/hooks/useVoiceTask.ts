import { useCallback, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useSkipOccurrenceMutation, useUpdateEventMutation, useDeleteEventMutation } from 'api/eventTasksApi';
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
import { SeriesMoveCancelled } from 'modules/schedule/seriesDragChoice';
import { resolveSpokenConflictOption } from 'modules/schedule/resolveSpokenConflictOption';
import i18n from 'i18n';
import { showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { executeVoiceCommand } from '../executeVoiceCommand';
import { VoiceSpeech } from '../speech';
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
  /** @deprecated Sufficient creates like complete; kept for call-site compat. */
  onSufficient?: (task: VoiceParsedTask) => void;
};

function requiresAlwaysConfirm(kind: VoiceCommandAction['kind']): boolean {
  return kind === 'cancel' || kind === 'delete' || kind === 'habit_delete';
}

export function useVoiceTask({ onComplete }: UseVoiceTaskOptions) {
  const { start, stop, cancel, error: recorderError, level: micLevel } = useAudioRecorder();
  const { data: userSettings } = useGetUserSettingsQuery();
  const confirmCommands = !!userSettings?.confirmVoiceCommands;
  const speakReplies = userSettings?.speakVoiceReplies !== false;
  const speechLang = userSettings?.language || i18n.language || 'en';
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [deleteTask] = useDeleteEventMutation();
  const dispatch = useDispatch();
  // Same IANA as the task form / engine, not the browser zone.
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [transcript, setTranscript] = useState('');
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [draftTask, setDraftTask] = useState<VoiceParsedTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState(() => i18n.t('voice.working'));
  const [pendingCommand, setPendingCommand] = useState<VoiceCommandAction | null>(null);
  const [heldConflict, setHeldConflict] = useState<SchedulingConflictDTO | null>(null);

  const maybeSpeak = useCallback(
    async (text: string | null | undefined) => {
      if (!speakReplies || !text?.trim()) return;
      await VoiceSpeech.speak(text, { lang: speechLang });
    },
    [speakReplies, speechLang],
  );

  const reset = useCallback(() => {
    VoiceSpeech.stop();
    cancel();
    setStage('idle');
    setTranscript('');
    setClarifyingQuestion(null);
    setDraftTask(null);
    setPendingCommand(null);
    setHeldConflict(null);
    setError(null);
  }, [cancel]);

  const close = useCallback(() => {
    const shouldCreate =
      (stage === 'clarifying' || stage === 'recording_clarification') &&
      Boolean(draftTask?.name);
    const payload = draftTask;
    reset();
    setIsOpen(false);
    if (shouldCreate && payload) {
      void onComplete(payload);
    }
  }, [draftTask, onComplete, reset, stage]);

  const open = useCallback(() => {
    VoiceSpeech.stop();
    cancel();
    setTranscript('');
    setPendingCommand(null);
    setError(null);
    const pending = getPendingConflictChoice();
    if (pending) {
      setHeldConflict(pending);
      const question = i18n.t('voice.pickConflictOption');
      setClarifyingQuestion(question);
      setStage('needs_conflict_choice');
      void maybeSpeak(question);
    } else {
      setHeldConflict(null);
      setClarifyingQuestion(null);
      setStage('idle');
    }
    setIsOpen(true);
  }, [cancel, maybeSpeak]);

  const runCommand = useCallback(
    async (command: VoiceCommandAction) => {
      setBusyLabel(i18n.t('voice.saving'));
      setStage('working');
      try {
        const waitConflict =
          command.kind === 'window' ? waitForScheduleConflict(12_000) : Promise.resolve(null);
        await executeVoiceCommand(command, { updateTask, skipOccurrence, deleteTask, dispatch });
        if (command.kind === 'window') {
          await waitConflict;
        }
        await maybeSpeak(command.summary);
        close();
      } catch (err) {
        if (err instanceof SeriesMoveCancelled) {
          close();
          return;
        }
        setError(extractApiErrorMessage(err));
        setStage('error');
      }
    },
    [close, deleteTask, dispatch, maybeSpeak, skipOccurrence, updateTask],
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
        const title = i18n.t('schedule.conflictApplied');
        showSuccessToast({ title });
        await maybeSpeak(title);
        close();
        return 'applied';
      } catch (err) {
        setError(extractApiErrorMessage(err));
        setStage('error');
        return 'error';
      }
    },
    [close, maybeSpeak, skipOccurrence, updateTask],
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
          await maybeSpeak(result.command.message);
          return;
        }
        if (confirmCommands || requiresAlwaysConfirm(result.command.kind)) {
          setPendingCommand(result.command);
          setStage('confirm');
          await maybeSpeak(result.command.summary);
          return;
        }
        await runCommand(result.command);
        return;
      }

      if (result.understanding === 'needs_clarification') {
        const question = result.clarifyingQuestion || i18n.t('voice.clarifyMore');
        setDraftTask(result.task?.name ? result.task : null);
        setClarifyingQuestion(question);
        setStage('clarifying');
        await maybeSpeak(question);
        return;
      }

      if (!result.task?.name) {
        const question = i18n.t('voice.askName');
        setDraftTask(null);
        setClarifyingQuestion(question);
        setStage('clarifying');
        await maybeSpeak(question);
        return;
      }

      // complete and sufficient both create through the normal placement path.
      const waitConflict = waitForScheduleConflict(12_000);
      await onComplete(result.task);
      await waitConflict;
      await maybeSpeak(result.task.name);
      setDraftTask(null);
      reset();
      setIsOpen(false);
    },
    [confirmCommands, maybeSpeak, onComplete, reset, runCommand, timeZone],
  );

  const beginRecording = useCallback(async () => {
    setError(null);
    VoiceSpeech.stop();
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
          const unclear = i18n.t('voice.conflictOptionUnclear');
          setError(unclear);
          setClarifyingQuestion(i18n.t('voice.pickConflictOption'));
          setHeldConflict(conflict);
          setStage('needs_conflict_choice');
          await maybeSpeak(unclear);
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
    maybeSpeak,
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
    micLevel,
    beginRecording,
    finishRecording,
    confirmCommand: () => {
      if (pendingCommand) void runCommand(pendingCommand);
    },
    isRecording: stage === 'recording' || stage === 'recording_clarification',
    isWorking: stage === 'working',
  };
}
