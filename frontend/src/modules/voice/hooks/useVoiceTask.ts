import { useCallback, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useSkipOccurrenceMutation, useUpdateEventMutation, useDeleteEventMutation } from 'api/eventTasksApi';
import {
  VoiceApi,
  type DayPlanProposal,
  type VoiceAgentActionId,
  type VoiceCommandAction,
  type VoiceParseResult,
  type VoiceParsedTask,
  type VoiceWriteIntent,
} from 'api/voice.api';
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
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { executeVoiceIntents } from '../executeVoiceIntents';
import { VoiceSpeech } from '../speech';
import { useAudioRecorder } from './useAudioRecorder';

export type VoiceStage =
  | 'idle'
  | 'recording'
  | 'working'
  | 'speaking'
  | 'clarifying'
  | 'recording_clarification'
  | 'needs_conflict_choice'
  | 'confirm'
  | 'ready'
  | 'error';

export type VoiceThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

type UseVoiceTaskOptions = {
  onComplete: (task: VoiceParsedTask) => Promise<void>;
  onSufficient?: (task: VoiceParsedTask) => void;
};

function requiresAlwaysConfirm(kind: VoiceCommandAction['kind']): boolean {
  return kind === 'cancel' || kind === 'delete' || kind === 'habit_delete' || kind === 'end_series';
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `voice-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function msg(role: 'user' | 'assistant', text: string): VoiceThreadMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    text,
  };
}

export function useVoiceTask({ onComplete }: UseVoiceTaskOptions) {
  const { start, stop, cancel, error: recorderError, level: micLevel } = useAudioRecorder();
  const { data: userSettings } = useGetUserSettingsQuery();
  const confirmCommands = !!userSettings?.confirmVoiceCommands;
  const speakReplies = userSettings?.speakVoiceReplies !== false;
  const speechLang =
    userSettings?.speechLanguage || userSettings?.language || i18n.language || 'en';
  const [updateTask] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [deleteTask] = useDeleteEventMutation();
  const dispatch = useDispatch();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [transcript, setTranscript] = useState('');
  const [messages, setMessages] = useState<VoiceThreadMessage[]>([]);
  const [clarifyingQuestion, setClarifyingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState(() => i18n.t('voice.working'));
  const [pendingIntents, setPendingIntents] = useState<VoiceWriteIntent[] | null>(null);
  const [pendingSummary, setPendingSummary] = useState<string | null>(null);
  const [proposal, setProposal] = useState<DayPlanProposal | null>(null);
  const [actions, setActions] = useState<VoiceAgentActionId[]>([]);
  const [heldConflict, setHeldConflict] = useState<SchedulingConflictDTO | null>(null);
  /** When true, auto-listen after turns. Independent of typed messages. Default on. */
  const [micEnabled, setMicEnabledState] = useState(true);
  const finishingRef = useRef(false);
  const turnLockRef = useRef(false);
  const lastCreateKeyRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const micEnabledRef = useRef(true);

  const ensureSessionId = useCallback(() => {
    const existing = sessionIdRef.current;
    if (existing) return existing;
    const id = newSessionId();
    sessionIdRef.current = id;
    setSessionId(id);
    return id;
  }, []);

  const pushMessages = useCallback((...next: VoiceThreadMessage[]) => {
    setMessages((prev) => [...prev, ...next.filter((row) => row.text.trim())]);
  }, []);

  const speakAndStage = useCallback(
    async (text: string | null | undefined, nextAfterSpeak: VoiceStage) => {
      if (!speakReplies || !text?.trim()) {
        setStage(nextAfterSpeak);
        return;
      }
      setStage('speaking');
      await VoiceSpeech.speak(text, { lang: speechLang });
      setStage(nextAfterSpeak);
    },
    [speakReplies, speechLang],
  );

  const resetLocal = useCallback(() => {
    VoiceSpeech.stop();
    cancel();
    finishingRef.current = false;
    setStage('idle');
    setTranscript('');
    setClarifyingQuestion(null);
    setPendingIntents(null);
    setPendingSummary(null);
    setProposal(null);
    setActions([]);
    setHeldConflict(null);
    setError(null);
  }, [cancel]);

  const close = useCallback(() => {
    const id = sessionIdRef.current || sessionId;
    resetLocal();
    setMessages([]);
    sessionIdRef.current = null;
    setSessionId(null);
    setIsOpen(false);
    if (id) void VoiceApi.endSession(id).catch(() => undefined);
  }, [resetLocal, sessionId]);

  const dismissForConflictSheet = useCallback(() => {
    const id = sessionIdRef.current || sessionId;
    resetLocal();
    setMessages([]);
    sessionIdRef.current = null;
    setSessionId(null);
    setIsOpen(false);
    if (id) void VoiceApi.endSession(id).catch(() => undefined);
  }, [resetLocal, sessionId]);

  const finishRecordingRef = useRef<() => Promise<void>>(async () => undefined);

  const beginRecording = useCallback(async () => {
    setError(null);
    VoiceSpeech.stop();
    try {
      await start({
        silenceEnd: true,
        onSilenceEnd: () => {
          void finishRecordingRef.current();
        },
      });
      // Arm only after the mic is actually open (avoids a raced second finish).
      finishingRef.current = false;
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

  /** Auto-listen only when the mic toggle is on. */
  const maybeListen = useCallback(async () => {
    if (!micEnabledRef.current) return;
    await beginRecording();
  }, [beginRecording]);

  const stayReady = useCallback(
    async (opts?: { listen?: boolean }) => {
      setPendingIntents(null);
      setPendingSummary(null);
      setProposal(null);
      setClarifyingQuestion(null);
      setActions(['skip_speak']);
      setError(null);
      setStage('ready');
      // After a write, wait for an explicit mic tap — auto-listen often
      // catches TTS bleed / the same phrase again and creates a duplicate.
      if (opts?.listen === false) return;
      await maybeListen();
    },
    [maybeListen],
  );

  const open = useCallback(() => {
    VoiceSpeech.stop();
    cancel();
    setTranscript('');
    setPendingIntents(null);
    setPendingSummary(null);
    setProposal(null);
    setError(null);
    setMessages([]);
    micEnabledRef.current = true;
    setMicEnabledState(true);
    const id = newSessionId();
    sessionIdRef.current = id;
    setSessionId(id);
    const pending = getPendingConflictChoice();
    if (pending) {
      setHeldConflict(pending);
      const question = i18n.t('voice.pickConflictOption');
      setClarifyingQuestion(question);
      setStage('needs_conflict_choice');
      setIsOpen(true);
      void (async () => {
        await speakAndStage(question, 'needs_conflict_choice');
        await maybeListen();
      })();
    } else {
      setHeldConflict(null);
      setClarifyingQuestion(null);
      setStage('idle');
      setIsOpen(true);
      void maybeListen();
    }
  }, [cancel, maybeListen, speakAndStage]);

  const runIntents = useCallback(
    async (intents: VoiceWriteIntent[], summary?: string) => {
      setBusyLabel(i18n.t('voice.saving'));
      setStage('working');
      const hasCreate = intents.some((intent) => intent.type === 'create');
      try {
        const { conflict } = await executeVoiceIntents(intents, {
          updateTask,
          skipOccurrence,
          deleteTask,
          dispatch,
          onCreate: async (task) => {
            const key = [
              task.name.trim().toLowerCase(),
              task.earliestStartTime || '',
              task.deadline || '',
            ].join('|');
            if (lastCreateKeyRef.current === key) {
              return;
            }
            lastCreateKeyRef.current = key;
            window.setTimeout(() => {
              if (lastCreateKeyRef.current === key) lastCreateKeyRef.current = null;
            }, 15_000);
            await onComplete(task);
          },
        });
        if (summary) pushMessages(msg('assistant', summary));
        if (conflict) {
          dismissForConflictSheet();
          return;
        }
        await speakAndStage(summary, 'ready');
        await stayReady({ listen: !hasCreate });
      } catch (err) {
        if (err instanceof SeriesMoveCancelled) {
          await stayReady({ listen: !hasCreate });
          return;
        }
        setError(extractApiErrorMessage(err));
        setStage('error');
      }
    },
    [
      deleteTask,
      dismissForConflictSheet,
      dispatch,
      onComplete,
      pushMessages,
      skipOccurrence,
      speakAndStage,
      stayReady,
      updateTask,
    ],
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
        pushMessages(msg('assistant', title));
        await speakAndStage(title, 'ready');
        await stayReady();
        return 'applied';
      } catch (err) {
        setError(extractApiErrorMessage(err));
        setStage('error');
        return 'error';
      }
    },
    [pushMessages, skipOccurrence, speakAndStage, stayReady, updateTask],
  );

  const routeLegacyParse = useCallback(
    async (result: VoiceParseResult) => {
      if (result.command) {
        if (result.command.kind === 'refuse') {
          pushMessages(msg('assistant', result.command.message));
          setError(result.command.message);
          setStage('error');
          await speakAndStage(result.command.message, 'error');
          return;
        }
        const intent: VoiceWriteIntent = {
          type: 'command',
          summary: result.command.summary,
          command: result.command,
        };
        if (confirmCommands || requiresAlwaysConfirm(result.command.kind)) {
          setPendingIntents([intent]);
          setPendingSummary(result.command.summary);
          setActions(['confirm', 'cancel', 'skip_speak']);
          setStage('confirm');
          await speakAndStage(result.command.summary, 'confirm');
          return;
        }
        await runIntents([intent], result.command.summary);
        return;
      }

      if (result.understanding === 'needs_clarification' || !result.task?.name) {
        const question = result.clarifyingQuestion || i18n.t('voice.clarifyMore');
        setClarifyingQuestion(question);
        pushMessages(msg('assistant', question));
        setStage('clarifying');
        await speakAndStage(question, 'clarifying');
        await maybeListen();
        return;
      }

      {
        const createIntent: VoiceWriteIntent = {
          type: 'create',
          summary: result.task.name,
          task: result.task,
        };
        // Prefer server-shaped summary when present on a prior turn; legacy
        // parse only returns the task — build a short created line locally.
        const summary = i18n.t('voice.createdTask', { name: result.task.name });
        await runIntents([{ ...createIntent, summary }], summary);
      }
    },
    [confirmCommands, maybeListen, pushMessages, runIntents, speakAndStage],
  );

  const turnAndRoute = useCallback(
    async (text: string, actionId?: VoiceAgentActionId) => {
      const activeSession = ensureSessionId();
      setBusyLabel(i18n.t('voice.understanding'));
      setStage('working');
      if (text) pushMessages(msg('user', text));

      const result = await VoiceApi.turn({
        transcript: text || undefined,
        sessionId: activeSession,
        timeZone,
        clientNowIso: new Date().toISOString(),
        actionId,
      });

      setActions(result.actions?.length ? result.actions : []);
      setProposal(result.proposal);

      if (result.intents?.length && result.outcome === 'act') {
        await runIntents(result.intents, result.assistantMessage);
        return;
      }

      if (result.outcome === 'confirm') {
        setPendingIntents(result.intents?.length ? result.intents : null);
        // Server holds pending; client may only have proposal. Confirm via actionId.
        if (!result.intents?.length && result.proposal) {
          setPendingIntents([]); // marker that confirm goes to server
        }
        setPendingSummary(result.assistantMessage);
        setActions(
          result.actions?.length ? result.actions : ['confirm', 'cancel', 'skip_speak'],
        );
        if (result.assistantMessage) pushMessages(msg('assistant', result.assistantMessage));
        await speakAndStage(result.assistantMessage, 'confirm');
        return;
      }

      if (result.outcome === 'legacy_parse' && result.legacyParse) {
        await routeLegacyParse(result.legacyParse);
        return;
      }

      const assistantText = result.assistantMessage?.trim() || '';
      if (assistantText) pushMessages(msg('assistant', assistantText));

      if (result.outcome === 'clarify') {
        setClarifyingQuestion(assistantText || i18n.t('voice.clarifyMore'));
        await speakAndStage(assistantText, 'clarifying');
        await maybeListen();
        return;
      }

      if (result.outcome === 'refuse') {
        setError(assistantText || i18n.t('voice.agentRefuse'));
        await speakAndStage(assistantText, 'error');
        return;
      }

      // Empty answer = ignored noise; keep listening without TTS spam.
      setClarifyingQuestion(null);
      if (!assistantText) {
        await stayReady();
        return;
      }
      await speakAndStage(assistantText, 'ready');
      await maybeListen();
    },
    [
      ensureSessionId,
      maybeListen,
      pushMessages,
      routeLegacyParse,
      runIntents,
      speakAndStage,
      stayReady,
      timeZone,
    ],
  );

  /** Shared path after STT or a typed message (conflict choice or agent turn). */
  const processUserText = useCallback(
    async (spoken: string, opts: { wasConflictTurn: boolean }) => {
      setTranscript(spoken);
      const conflict = heldConflict ?? getPendingConflictChoice();
      if (conflict) {
        pushMessages(msg('user', spoken));
        const outcome = await applySpokenConflict(spoken, conflict);
        if (outcome === 'applied' || outcome === 'error') return;
        if (opts.wasConflictTurn) {
          const unclear = i18n.t('voice.conflictOptionUnclear');
          setError(unclear);
          setClarifyingQuestion(i18n.t('voice.pickConflictOption'));
          setHeldConflict(conflict);
          setStage('needs_conflict_choice');
          await speakAndStage(unclear, 'needs_conflict_choice');
          await maybeListen();
          return;
        }
      }
      await turnAndRoute(spoken);
    },
    [applySpokenConflict, heldConflict, maybeListen, pushMessages, speakAndStage, turnAndRoute],
  );

  const finishRecording = useCallback(async () => {
    if (finishingRef.current || turnLockRef.current) return;
    finishingRef.current = true;
    turnLockRef.current = true;
    const wasConflictTurn = stage === 'needs_conflict_choice' || Boolean(heldConflict);
    const wasClarifying = Boolean(clarifyingQuestion) && !wasConflictTurn;
    try {
      setBusyLabel(i18n.t('voice.transcribing'));
      setStage('working');
      const { base64, mimeType } = await stop();
      const activeSession = ensureSessionId();
      const { transcript: spoken } = await VoiceApi.transcribe(
        base64,
        mimeType,
        speechLang,
        activeSession,
      );
      setTranscript(spoken);

      // Server strips Whisper silence hallucinations («дякую», «thank you»).
      if (!spoken.trim()) {
        setError(null);
        if (wasConflictTurn) {
          setStage('needs_conflict_choice');
          await maybeListen();
        } else if (wasClarifying) {
          setStage('clarifying');
          await maybeListen();
        } else {
          await stayReady();
        }
        return;
      }

      await processUserText(spoken, { wasConflictTurn });
    } catch (err) {
      setError(extractApiErrorMessage(err));
      if (wasConflictTurn) setStage('needs_conflict_choice');
      else if (wasClarifying) setStage('clarifying');
      else setStage('error');
    } finally {
      turnLockRef.current = false;
      // Stay locked until beginRecording arms the next listen (or user taps mic).
    }
  }, [
    clarifyingQuestion,
    ensureSessionId,
    heldConflict,
    maybeListen,
    processUserText,
    speechLang,
    stage,
    stayReady,
    stop,
  ]);

  finishRecordingRef.current = finishRecording;

  /** Typed message: same turn path as speech; cancels an active recording. */
  const sendTypedMessage = useCallback(
    async (raw: string): Promise<boolean> => {
      const spoken = raw.trim();
      if (!spoken || turnLockRef.current) return false;
      VoiceSpeech.stop();
      cancel();
      finishingRef.current = true;
      turnLockRef.current = true;
      const wasConflictTurn = stage === 'needs_conflict_choice' || Boolean(heldConflict);
      const wasClarifying = Boolean(clarifyingQuestion) && !wasConflictTurn;
      try {
        setError(null);
        setBusyLabel(i18n.t('voice.understanding'));
        setStage('working');
        await processUserText(spoken, { wasConflictTurn });
        return true;
      } catch (err) {
        setError(extractApiErrorMessage(err));
        if (wasConflictTurn) setStage('needs_conflict_choice');
        else if (wasClarifying) setStage('clarifying');
        else setStage('error');
        return true;
      } finally {
        turnLockRef.current = false;
      }
    },
    [cancel, clarifyingQuestion, heldConflict, processUserText, stage],
  );

  const setMicEnabled = useCallback(
    async (on: boolean) => {
      micEnabledRef.current = on;
      setMicEnabledState(on);
      if (!on) {
        cancel();
        finishingRef.current = false;
        setStage((current) => {
          if (current !== 'recording' && current !== 'recording_clarification') return current;
          if (heldConflict) return 'needs_conflict_choice';
          if (clarifyingQuestion) return 'clarifying';
          return 'ready';
        });
        return;
      }
      if (turnLockRef.current) return;
      if (stage === 'working' || stage === 'speaking' || stage === 'confirm') return;
      await beginRecording();
    },
    [beginRecording, cancel, clarifyingQuestion, heldConflict, stage],
  );

  const runAction = useCallback(
    async (actionId: VoiceAgentActionId) => {
      if (actionId === 'skip_speak') {
        VoiceSpeech.stop();
        if (stage === 'speaking') {
          setStage(pendingSummary ? 'confirm' : clarifyingQuestion ? 'clarifying' : 'ready');
        }
        return;
      }
      if (actionId === 'cancel') {
        VoiceSpeech.stop();
        setPendingIntents(null);
        setPendingSummary(null);
        setProposal(null);
        await turnAndRoute('', 'cancel');
        return;
      }
      if (actionId === 'retry') {
        setError(null);
        micEnabledRef.current = true;
        setMicEnabledState(true);
        await beginRecording();
        return;
      }
      if (actionId === 'confirm') {
        VoiceSpeech.stop();
        if (pendingIntents && pendingIntents.length > 0) {
          const intents = pendingIntents;
          const summary = pendingSummary || undefined;
          setPendingIntents(null);
          setPendingSummary(null);
          setProposal(null);
          await runIntents(intents, summary);
          return;
        }
        // Server-held pending (day-plan / confirm)
        await turnAndRoute('', 'confirm');
      }
    },
    [
      beginRecording,
      clarifyingQuestion,
      pendingIntents,
      pendingSummary,
      runIntents,
      stage,
      turnAndRoute,
    ],
  );

  return {
    isOpen,
    open,
    close,
    stage,
    transcript,
    messages,
    clarifyingQuestion,
    pendingSummary,
    proposal,
    actions,
    error: error || recorderError,
    busyLabel,
    micLevel,
    micEnabled,
    setMicEnabled,
    beginRecording,
    finishRecording,
    sendTypedMessage,
    runAction,
    confirmCommand: () => {
      void runAction('confirm');
    },
    isRecording: stage === 'recording' || stage === 'recording_clarification',
    isWorking: stage === 'working',
    isSpeaking: stage === 'speaking',
  };
}
