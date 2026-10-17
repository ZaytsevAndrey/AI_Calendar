import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import type { useVoiceTask } from '../hooks/useVoiceTask';
import { VoiceAudioVisual } from './VoiceAudioVisual';
import { localHm } from 'utils/ianaDateTime';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';

type VoiceController = ReturnType<typeof useVoiceTask>;

export function VoiceTaskSheet({ voice }: { voice: VoiceController }) {
  const { t } = useTranslation();
  const phone = usePhoneLayout();
  const { data: settings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(settings?.timeZone);
  const {
    isOpen,
    close,
    stage,
    messages,
    clarifyingQuestion,
    pendingSummary,
    proposal,
    actions,
    error,
    busyLabel,
    micLevel,
    micEnabled,
    setMicEnabled,
    beginRecording,
    finishRecording,
    sendTypedMessage,
    runAction,
    confirmCommand,
    isRecording,
    isWorking,
    isSpeaking,
  } = voice;
  const threadRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!isOpen) setDraft('');
  }, [isOpen]);

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isRecording, isWorking, isSpeaking, clarifyingQuestion, pendingSummary, proposal]);

  const visualMode = isRecording ? 'listening' : isSpeaking ? 'speaking' : 'idle';
  const showSkipSpeak = isSpeaking || actions.includes('skip_speak');
  const showConfirm = stage === 'confirm' || actions.includes('confirm');
  const showCancel = stage === 'confirm' || actions.includes('cancel');
  const showRetry = stage === 'error' || Boolean(error) || actions.includes('retry');
  const showStartSpeak =
    micEnabled &&
    !isRecording &&
    !isWorking &&
    !isSpeaking &&
    !showConfirm &&
    (stage === 'ready' || stage === 'idle' || stage === 'clarifying');
  const canType = !isWorking && !isSpeaking && !showConfirm;
  const canSend = canType && draft.trim().length > 0;

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    void sendTypedMessage(text).then((accepted) => {
      if (accepted) setDraft('');
    });
  };

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={t('voice.agentTitle')}
      maxWidthClass={phone ? 'max-w-none' : 'max-w-lg'}
      zIndexClass="z-[1400]"
      bodyOverflowHidden
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <button type="button" className="ui-btn-secondary" onClick={close} disabled={isWorking}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className={micEnabled ? 'ui-btn-primary' : 'ui-btn-secondary'}
            aria-pressed={micEnabled}
            aria-label={micEnabled ? t('voice.micOn') : t('voice.micOff')}
            title={micEnabled ? t('voice.micOn') : t('voice.micOff')}
            disabled={isWorking || isSpeaking || showConfirm}
            onClick={() => void setMicEnabled(!micEnabled)}
          >
            {micEnabled ? (
              <Mic className="h-4 w-4" aria-hidden />
            ) : (
              <MicOff className="h-4 w-4" aria-hidden />
            )}
            {micEnabled ? t('voice.micOn') : t('voice.micOff')}
          </button>
          {showSkipSpeak ? (
            <button
              type="button"
              className="ui-btn-secondary"
              onClick={() => void runAction('skip_speak')}
            >
              {t('voice.skipSpeak')}
            </button>
          ) : null}
          {showCancel ? (
            <button
              type="button"
              className="ui-btn-secondary"
              onClick={() => void runAction('cancel')}
              disabled={isWorking}
            >
              {t('voice.dismissTurn')}
            </button>
          ) : null}
          {isRecording ? (
            <button
              type="button"
              className="ui-btn-secondary text-xs opacity-80"
              onClick={() => void finishRecording()}
            >
              {t('voice.stop')}
            </button>
          ) : null}
          {showConfirm ? (
            <button
              type="button"
              className="ui-btn-primary"
              onClick={confirmCommand}
              disabled={isWorking}
            >
              {t('voice.confirm')}
            </button>
          ) : null}
          {showRetry && !isRecording ? (
            <button
              type="button"
              className="ui-btn-primary"
              onClick={() => void runAction('retry')}
              disabled={isWorking}
            >
              <Mic className="h-4 w-4" aria-hidden />
              {t('common.retry')}
            </button>
          ) : null}
          {showStartSpeak && !showRetry ? (
            <button
              type="button"
              className="ui-btn-primary"
              onClick={() => void beginRecording()}
            >
              <Mic className="h-4 w-4" aria-hidden />
              {t('voice.startSpeaking')}
            </button>
          ) : null}
        </div>
      }
    >
      <div
        className={`flex flex-col gap-3 text-sm ${phone ? 'min-h-[78dvh]' : 'min-h-[22rem]'}`}
      >
        <VoiceAudioVisual
          mode={visualMode}
          level={micLevel}
          label={
            isSpeaking
              ? t('voice.speakingLabel')
              : isRecording
                ? t('voice.equalizerLabel')
                : t('voice.agentTitle')
          }
        />

        {isRecording ? (
          <p className="text-center text-xs font-medium text-ide-error">{t('voice.listeningSilence')}</p>
        ) : isSpeaking ? (
          <p className="text-center text-xs font-medium text-ide-accentBlue">{t('voice.speaking')}</p>
        ) : isWorking ? (
          <p className="flex items-center justify-center gap-2 text-ide-muted">
            <Spinner className="h-4 w-4" />
            {busyLabel}
          </p>
        ) : null}

        {isSpeaking ? (
          <p className="text-center text-xs text-ide-muted">{t('voice.micGated')}</p>
        ) : null}

        <div
          ref={threadRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-ide-border bg-ide-bg/50 px-3 py-2"
          aria-live="polite"
        >
          {messages.length === 0 && !isRecording && !isWorking ? (
            <p className="text-ide-muted">{t('voice.agentHint')}</p>
          ) : null}
          {messages.map((row) => (
            <div
              key={row.id}
              className={
                row.role === 'user'
                  ? 'ml-8 rounded-xl bg-ide-surface px-3 py-2 text-ide-text'
                  : 'mr-8 rounded-xl border border-ide-border bg-ide-surface px-3 py-2 text-ide-text'
              }
            >
              <p className="text-[10px] font-medium uppercase tracking-wide text-ide-muted">
                {row.role === 'user' ? t('voice.you') : t('voice.agent')}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{row.text}</p>
            </div>
          ))}
        </div>

        {proposal?.items?.length ? (
          <div className="rounded-xl border border-ide-border bg-ide-surface px-3 py-2">
            <p className="text-xs font-medium text-ide-muted">
              {t('voice.dayPlanTitle', { day: proposal.day })}
            </p>
            <ul className="mt-2 space-y-1.5">
              {proposal.items.map((item) => (
                <li
                  key={`${item.taskId}-${item.start}`}
                  className="flex items-baseline justify-between gap-2 text-sm text-ide-text"
                >
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="shrink-0 text-xs text-ide-muted">
                    {localHm(item.start, timeZone)}–{localHm(item.end, timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pendingSummary && stage === 'confirm' && !proposal?.items?.length ? (
          <p className="rounded-xl border border-ide-border bg-ide-surface px-3 py-2">{pendingSummary}</p>
        ) : null}

        {clarifyingQuestion &&
        (stage === 'clarifying' || stage === 'recording_clarification' || stage === 'needs_conflict_choice') &&
        !messages.some((row) => row.role === 'assistant' && row.text === clarifyingQuestion) ? (
          <p className="rounded-xl border border-ide-border bg-ide-surface px-3 py-2">
            {clarifyingQuestion}
          </p>
        ) : null}

        {error ? <p className="text-ide-error">{error}</p> : null}

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submitDraft();
          }}
        >
          <label className="sr-only" htmlFor="voice-typed-message">
            {t('voice.typePlaceholder')}
          </label>
          <input
            id="voice-typed-message"
            type="text"
            className="ui-input min-w-0 flex-1"
            value={draft}
            disabled={!canType}
            placeholder={t('voice.typePlaceholder')}
            autoComplete="off"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="ui-btn-primary shrink-0 px-3"
            disabled={!canSend}
            aria-label={t('voice.send')}
            title={t('voice.send')}
          >
            <Send className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </div>
    </Modal>
  );
}
