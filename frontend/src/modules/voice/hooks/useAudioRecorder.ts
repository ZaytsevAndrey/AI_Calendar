import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToBase64, pickRecorderMimeType, recorderMimeToContentType } from '../audio';

const MAX_MS = 60_000;

type RecorderStatus = 'idle' | 'recording' | 'stopping';

export function useAudioRecorder() {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopLevelMeter = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    setLevel(0);
  };

  const startLevelMeter = (stream: MediaStream) => {
    stopLevelMeter();
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        const node = analyserRef.current;
        if (!node) return;
        node.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        setLevel(Math.min(1, rms * 3.5));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Equalizer is decorative; recording still works without it.
    }
  };

  const cleanupStream = () => {
    stopLevelMeter();
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
      startLevelMeter(stream);
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
    stopLevelMeter();
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

  return { status, error, setError, level, start, stop, cancel };
}
