import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import type { useVoiceTask } from '../hooks/useVoiceTask';
import { VoiceAudioVisual } from './VoiceAudioVisual';
import { CompanionPanel } from './CompanionPanel';
import { ChangePreviewCards } from './ChangePreviewCards';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';

type VoiceController = ReturnType<typeof useVoiceTask>;

function CompanionModeSwitch({ voice }: { voice: VoiceController }) {
  const { t } = useTranslation();
  const { companionMode, setCompanionMode, isWorking } = voice;
  const options = [
    { id: 'assistant' as const, label: t('voice.modeCompanion'), hint: t('voice.modeCompanionHint') },
    { id: 'fast_create' as const, label: t('voice.modeFastCreate'), hint: t('voice.modeFastCreateHint') },
  ];
  return (
    <div
      role="group"
      aria-label={t('voice.modeLabel')}
      className="inline-flex w-full rounded-md border border-ide-border bg-ide-surface p-0.5"
    >
      {options.map((option) => {
        const selected = companionMode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            className={`min-w-0 flex-1 rounded px-2 py-1 text-xs font-medium ${
              selected ? 'bg-ide-selection text-ide-text' : 'text-ide-muted hover:bg-white/5'
            }`}
            aria-pressed={selected}
            title={option.hint}
            disabled={isWorking}
            onClick={() => setCompanionMode(option.id)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MicToggle({ voice, primary }: { voice: VoiceController; primary?: boolean }) {
  const { t } = useTranslation();
  const { micEnabled, setMicEnabled, isWorking } = voice;
  return (
    <button
      type="button"
      className={primary && micEnabled ? 'ui-btn-primary' : 'ui-btn-secondary'}
      aria-pressed={micEnabled}
      aria-label={micEnabled ? t('voice.micOn') : t('voice.micOff')}
      title={micEnabled ? t('voice.micOn') : t('voice.micOff')}
      disabled={isWorking}
      onClick={() => void setMicEnabled(!micEnabled)}
    >
      {micEnabled ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
      <span className="sr-only">{micEnabled ? t('voice.micOn') : t('voice.micOff')}</span>
    </button>
  );
}

function CompanionFooter({
  voice,
  showConfirm,
  showBuildPlan,
  showRetry,
  showSkipSpeak,
}: {
  voice: VoiceController;
  showConfirm: boolean;
  showBuildPlan: boolean;
  showRetry: boolean;
  showSkipSpeak: boolean;
}) {
  const { t } = useTranslation();
  const {
    close,
    micEnabled,
    setMicEnabled,
    finishRecording,
    runAction,
    confirmCommand,
    isRecording,
    isWorking,
    isSpeaking,
    plan,
  } = voice;

  if (isRecording && plan) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button type="button" className="ui-btn-secondary" onClick={() => void runAction('cancel')}>
          {t('voice.dismissTurn')}
        </button>
        <button type="button" className="ui-btn-secondary" onClick={() => void finishRecording()}>
          {t('voice.stop')}
        </button>
        {showConfirm ? (
          <button type="button" className="ui-btn-primary" onClick={confirmCommand}>
            {t('voice.apply')}
          </button>
        ) : null}
        {showBuildPlan ? (
          <button type="button" className="ui-btn-primary" onClick={() => void runAction('build_plan')}>
            {t('voice.buildPlan')}
          </button>
        ) : null}
      </div>
    );
  }

  if (showConfirm) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="ui-btn-secondary"
          onClick={() => void runAction('cancel')}
          disabled={isWorking}
        >
          {t('voice.dismissTurn')}
        </button>
        {plan ? <MicToggle voice={voice} /> : null}
        <button type="button" className="ui-btn-primary" onClick={confirmCommand} disabled={isWorking}>
          {t('voice.apply')}
        </button>
      </div>
    );
  }

  if (showBuildPlan && !isSpeaking) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="ui-btn-secondary"
          onClick={() => void runAction('cancel')}
          disabled={isWorking}
        >
          {t('voice.dismissTurn')}
        </button>
        <MicToggle voice={voice} />
        <button
          type="button"
          className="ui-btn-primary"
          onClick={() => void runAction('build_plan')}
          disabled={isWorking}
        >
          {t('voice.buildPlan')}
        </button>
      </div>
    );
  }

  if (showRetry) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button type="button" className="ui-btn-secondary" onClick={close} disabled={isWorking}>
          {t('common.close')}
        </button>
        <button
          type="button"
          className="ui-btn-primary"
          onClick={() => void runAction('retry')}
          disabled={isWorking}
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (isSpeaking || showSkipSpeak) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button type="button" className="ui-btn-secondary" onClick={() => void runAction('skip_speak')}>
          {t('voice.skipSpeak')}
        </button>
      </div>
    );
  }

  if (isRecording) {
    return (
      <div className="flex w-full flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          className="ui-btn-secondary"
          aria-pressed={micEnabled}
          aria-label={micEnabled ? t('voice.micOn') : t('voice.micOff')}
          title={micEnabled ? t('voice.micOn') : t('voice.micOff')}
          onClick={() => void setMicEnabled(!micEnabled)}
        >
          {micEnabled ? <Mic className="h-4 w-4" aria-hidden /> : <MicOff className="h-4 w-4" aria-hidden />}
        </button>
        <button type="button" className="ui-btn-primary" onClick={() => void finishRecording()}>
          {t('voice.stop')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <button type="button" className="ui-btn-secondary" onClick={close} disabled={isWorking}>
        {t('common.close')}
      </button>
      <MicToggle voice={voice} primary />
    </div>
  );
}

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
    pendingIntents,
    plan,
    lastRun,
    actions,
    error,
    busyLabel,
    micLevel,
    sendTypedMessage,
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
  }, [messages, isRecording, isWorking, isSpeaking, clarifyingQuestion, pendingSummary, plan, pendingIntents, lastRun]);

  const visualMode = isRecording ? 'listening' : isSpeaking ? 'speaking' : 'idle';
  const showSkipSpeak = isSpeaking || actions.includes('skip_speak');
  const showConfirm = stage === 'confirm' || actions.includes('confirm');
  const showBuildPlan = actions.includes('build_plan');
  const showRetry = stage === 'error' || Boolean(error) || actions.includes('retry');
  const canType = !isWorking && !isSpeaking && (!showConfirm || plan != null);
  const canSend = canType && draft.trim().length > 0;
  const showPlan = plan != null;
  const showIntentPreview =
    !showPlan && showConfirm && pendingIntents != null && pendingIntents.length > 0;
  const showLastRun = !showPlan && !showConfirm && lastRun != null;
  const showPreview = showPlan || showIntentPreview;

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    void sendTypedMessage(text).then((accepted) => {
      if (accepted) setDraft('');
    });
  };

  const footer = (
    <CompanionFooter
      voice={voice}
      showConfirm={showConfirm}
      showBuildPlan={showBuildPlan}
      showRetry={showRetry}
      showSkipSpeak={showSkipSpeak}
    />
  );

  const body = (
    <div
      className={`flex h-full min-h-0 flex-col gap-3 text-sm ${phone ? 'min-h-[78dvh]' : ''}`}
    >
      <CompanionModeSwitch voice={voice} />

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

      {isSpeaking ? <p className="text-center text-xs text-ide-muted">{t('voice.micGated')}</p> : null}

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

      {showPlan ? <ChangePreviewCards plan={plan} timeZone={timeZone} /> : null}
      {showIntentPreview ? <ChangePreviewCards intents={pendingIntents} timeZone={timeZone} /> : null}
      {showLastRun && lastRun ? (
        <ChangePreviewCards
          intents={lastRun.intents}
          statuses={lastRun.statuses}
          timeZone={timeZone}
          title={t('voice.lastRunTitle')}
        />
      ) : null}

      {pendingSummary && stage === 'confirm' && !showPreview ? (
        <p className="rounded-xl border border-ide-border bg-ide-surface px-3 py-2">{pendingSummary}</p>
      ) : null}

      {clarifyingQuestion &&
      (stage === 'clarifying' || stage === 'recording_clarification' || stage === 'needs_conflict_choice') &&
      !messages.some((row) => row.role === 'assistant' && row.text === clarifyingQuestion) ? (
        <p className="rounded-xl border border-ide-border bg-ide-surface px-3 py-2">{clarifyingQuestion}</p>
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
  );

  if (phone) {
    return (
      <Modal
        open={isOpen}
        onClose={close}
        title={t('voice.agentTitle')}
        maxWidthClass="max-w-none"
        zIndexClass="z-[1400]"
        bodyOverflowHidden
        footer={footer}
      >
        {body}
      </Modal>
    );
  }

  return (
    <CompanionPanel
      open={isOpen}
      onClose={close}
      title={t('voice.agentTitle')}
      zIndexClass="z-[1400]"
      footer={footer}
    >
      {body}
    </CompanionPanel>
  );
}
