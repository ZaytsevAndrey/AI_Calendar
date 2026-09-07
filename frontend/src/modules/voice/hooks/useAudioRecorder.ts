import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToBase64, pickRecorderMimeType, recorderMimeToContentType } from '../audio';

const MAX_MS = 60_000;

type RecorderStatus = 'idle' | 'recording' | 'stopping';

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  const clearStopTimer = () => {
    if (stopTimerRef.current != null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      clearStopTimer();
      recorderRef.current?.stop();
      cleanupStream();
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio. Try Chrome on Android, or Safari 14.3+.');
      throw new Error('unsupported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    try {
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        cleanupStream();
        setStatus('idle');
        stopResolverRef.current?.(blob);
        stopResolverRef.current = null;
      };
      recorderRef.current = recorder;
      recorder.start();
      setStatus('recording');
      stopTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          recorderRef.current.stop();
          setStatus('stopping');
        }
      }, MAX_MS);
    } catch (err) {
      cleanupStream();
      throw err;
    }
  }, []);

  const stop = useCallback(async (): Promise<{ base64: string; mimeType: string }> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      throw new Error('Not recording');
    }
    clearStopTimer();
    setStatus('stopping');
    const blob = await new Promise<Blob>((resolve) => {
      stopResolverRef.current = resolve;
      recorder.stop();
    });
    if (!blob.size) {
      throw new Error('No audio captured. Try again.');
    }
    const base64 = await blobToBase64(blob);
    return {
      base64,
      mimeType: recorderMimeToContentType(blob.type || recorder.mimeType),
    };
  }, []);

  const cancel = useCallback(() => {
    clearStopTimer();
    stopResolverRef.current = null;
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.onstop = () => {
        cleanupStream();
        setStatus('idle');
      };
      recorderRef.current.stop();
    } else {
      cleanupStream();
      setStatus('idle');
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  return { status, error, setError, start, stop, cancel };
}
