import { spawn } from 'child_process';

/**
 * Azure short-audio REST accepts at most 60 seconds.
 * The cap drops only the tail past 59 seconds. It does not strip silence.
 */
export const PCM_WAV_FFMPEG_ARGS = [
  '-hide_banner',
  '-loglevel',
  'error',
  '-i',
  'pipe:0',
  '-t',
  '59',
  '-ac',
  '1',
  '-ar',
  '16000',
  '-f',
  'wav',
  '-acodec',
  'pcm_s16le',
  'pipe:1',
];

function ffmpegBinary(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) return fromEnv;
  const bundled = require('ffmpeg-static') as string | null;
  if (bundled) return bundled;
  return 'ffmpeg';
}

/** Whole recording to 16 kHz mono PCM WAV. Silence stays in the file. */
export function transcodeToPcmWav(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBinary(), PCM_WAV_FFMPEG_ARGS, {
      windowsHide: true,
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(err).toString('utf8').trim().slice(0, 400);
        reject(new Error(detail || `ffmpeg exited ${code}`));
        return;
      }
      const wav = Buffer.concat(out);
      if (wav.length < 44) {
        reject(new Error('Converted audio is empty'));
        return;
      }
      resolve(wav);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}
