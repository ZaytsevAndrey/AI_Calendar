import { useCallback, useEffect, useRef, useState } from 'react';
import { blobToBase64, pickRecorderMimeType, recorderMimeToContentType } from '../audio';

const MAX_MS = 60_000;
/** Require speech energy before silence can end the utterance. */
const SPEECH_THRESHOLD = 0.045;
// Long enough that "Створи…. [pause] З'їздити…" stays one utterance.
const SILENCE_MS = 2800;
const MIN_SPEECH_MS = 350;
/** Ignore trailing room / TTS bleed right after the mic opens. */
const LISTEN_GRACE_MS = 1600;

type RecorderStatus = 'idle' | 'recording' | 'stopping';

type StartOptions = {
  /** When true, stop automatically after sustained silence following speech. */
  silenceEnd?: boolean;
  onSilenceEnd?: () => void;
};

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
  const silenceEndRef = useRef(false);
  const onSilenceEndRef = useRef<(() => void) | null>(null);
  const heardSpeechRef = useRef(false);
  const speechStartedAtRef = useRef<number | null>(null);
  const silenceSinceRef = useRef<number | null>(null);
  const autoStoppingRef = useRef(false);
  const listenArmedAtRef = useRef<number>(0);

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
    heardSpeechRef.current = false;
    speechStartedAtRef.current = null;
    silenceSinceRef.current = null;
    autoStoppingRef.current = false;
    listenArmedAtRef.current = performance.now() + LISTEN_GRACE_MS;
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
        const nextLevel = Math.min(1, rms * 3.5);
        setLevel(nextLevel);

        if (silenceEndRef.current && recorderRef.current?.state === 'recording') {
          const now = performance.now();
          if (now < listenArmedAtRef.current) {
            // Warm-up: do not arm speech/silence yet.
          } else if (nextLevel >= SPEECH_THRESHOLD) {
            if (!heardSpeechRef.current) {
              heardSpeechRef.current = true;
              speechStartedAtRef.current = now;
            }
            silenceSinceRef.current = null;
          } else if (heardSpeechRef.current && speechStartedAtRef.current != null) {
            if (now - speechStartedAtRef.current >= MIN_SPEECH_MS) {
              if (silenceSinceRef.current == null) silenceSinceRef.current = now;
              else if (
                now - silenceSinceRef.current >= SILENCE_MS &&
                !autoStoppingRef.current
              ) {
                autoStoppingRef.current = true;
                silenceEndRef.current = false;
                const end = onSilenceEndRef.current;
                onSilenceEndRef.current = null;
                end?.();
              }
            }
          }
        }

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

  const start = useCallback(async (options?: StartOptions) => {
    setError(null);
    silenceEndRef.current = Boolean(options?.silenceEnd);
    onSilenceEndRef.current = options?.onSilenceEnd ?? null;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot record audio. Try Chrome on Android, or Safari 14.3+.');
      throw new Error('unsupported');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    streamRef.current = stream;
    try {
      const mimeType = pickRecorderMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 })
          : new MediaRecorder(stream, { audioBitsPerSecond: 128_000 });
      } catch {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      }
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
      // Timeslice keeps short WebM blobs valid for Whisper (empty/corrupt without it).
      recorder.start(250);
      startLevelMeter(stream);
      setStatus('recording');
      stopTimerRef.current = window.setTimeout(() => {
        if (recorderRef.current?.state === 'recording') {
          if (silenceEndRef.current && onSilenceEndRef.current) {
            onSilenceEndRef.current();
          } else {
            recorderRef.current.stop();
            setStatus('stopping');
          }
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
    // Prevent a second silence/Done callback from racing the same blob.
    silenceEndRef.current = false;
    onSilenceEndRef.current = null;
    autoStoppingRef.current = true;
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
    silenceEndRef.current = false;
    onSilenceEndRef.current = null;
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
