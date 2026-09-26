import React from 'react';
import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import type { useVoiceTask } from '../hooks/useVoiceTask';

type VoiceController = ReturnType<typeof useVoiceTask>;

export function VoiceTaskSheet({ voice }: { voice: VoiceController }) {
  const { t } = useTranslation();
  const {
    isOpen,
    close,
    stage,
    transcript,
    clarifyingQuestion,
    pendingSummary,
    error,
    busyLabel,
    beginRecording,
    finishRecording,
    confirmCommand,
    isRecording,
    isWorking,
  } = voice;

  const primaryLabel = isRecording
    ? t('voice.stop')
    : stage === 'confirm'
      ? t('voice.confirm')
      : stage === 'clarifying'
        ? t('voice.answer')
        : t('voice.startSpeaking');

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title={t('voice.addByVoice')}
      maxWidthClass="max-w-md"
      footer={
        <>
          <button type="button" className="ui-btn-secondary" onClick={close} disabled={isWorking}>
            {t('common.cancel')}
          </button>
          {isRecording ? (
            <button type="button" className="ui-btn-danger" onClick={() => void finishRecording()}>
              {primaryLabel}
            </button>
          ) : stage === 'confirm' ? (
            <button
              type="button"
              className="ui-btn-primary"
              onClick={confirmCommand}
              disabled={isWorking}
            >
              {primaryLabel}
            </button>
          ) : (
            <button
              type="button"
              className="ui-btn-primary"
              onClick={() => void beginRecording()}
              disabled={isWorking}
            >
              <Mic className="h-4 w-4" aria-hidden />
              {primaryLabel}
            </button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {isRecording ? (
          <p className="flex items-center gap-2 font-medium text-ide-error">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-ide-error" />
            {t('voice.listeningStop')}
          </p>
        ) : null}
        {isWorking ? (
          <p className="flex items-center gap-2 text-ide-muted">
            <Spinner className="h-4 w-4" />
            {busyLabel}
          </p>
        ) : null}
        {pendingSummary && stage === 'confirm' ? (
          <p className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2">{pendingSummary}</p>
        ) : clarifyingQuestion && (stage === 'clarifying' || stage === 'recording_clarification') ? (
          <p className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2">
            {clarifyingQuestion}
          </p>
        ) : (
          <p className="text-ide-muted">{t('voice.hint')}</p>
        )}
        {transcript ? (
          <p className="text-ide-text">
            <span className="text-ide-muted">{t('voice.heard')} </span>
            {transcript}
          </p>
        ) : null}
        {error ? <p className="text-ide-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
