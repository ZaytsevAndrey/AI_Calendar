import React from 'react';
import { Mic } from 'lucide-react';
import { Modal } from '../../../ui/Modal';
import { Spinner } from '../../../ui/Spinner';
import type { useVoiceTask } from '../hooks/useVoiceTask';

type VoiceController = ReturnType<typeof useVoiceTask>;

export function VoiceTaskSheet({ voice }: { voice: VoiceController }) {
  const {
    isOpen,
    close,
    stage,
    transcript,
    clarifyingQuestion,
    error,
    busyLabel,
    beginRecording,
    finishRecording,
    isRecording,
    isWorking,
  } = voice;

  const primaryLabel = isRecording
    ? 'Stop'
    : stage === 'clarifying'
      ? 'Answer'
      : 'Start speaking';

  return (
    <Modal
      open={isOpen}
      onClose={close}
      title="Add task by voice"
      maxWidthClass="max-w-md"
      footer={
        <>
          <button type="button" className="ui-btn-secondary" onClick={close} disabled={isWorking}>
            Cancel
          </button>
          {isRecording ? (
            <button type="button" className="ui-btn-danger" onClick={() => void finishRecording()}>
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
            Listening… tap Stop when you are done.
          </p>
        ) : null}
        {isWorking ? (
          <p className="flex items-center gap-2 text-ide-muted">
            <Spinner className="h-4 w-4" />
            {busyLabel}
          </p>
        ) : null}
        {clarifyingQuestion && (stage === 'clarifying' || stage === 'recording_clarification') ? (
          <p className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2">
            {clarifyingQuestion}
          </p>
        ) : (
          <p className="text-ide-muted">
            Speak in Ukrainian, English, or Russian. Example: “Tomorrow at 3pm dentist for 40
            minutes”.
          </p>
        )}
        {transcript ? (
          <p className="text-ide-text">
            <span className="text-ide-muted">Heard: </span>
            {transcript}
          </p>
        ) : null}
        {error ? <p className="text-ide-error">{error}</p> : null}
      </div>
    </Modal>
  );
}
