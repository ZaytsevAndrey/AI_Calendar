import { PCM_WAV_FFMPEG_ARGS, transcodeToPcmWav } from './audio-to-wav';

function silenceWav(seconds: number): Buffer {
  const samples = 16_000 * seconds;
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24);
  header.writeUInt32LE(32_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe('transcodeToPcmWav', () => {
  it('does not ask ffmpeg to strip silence', () => {
    expect(PCM_WAV_FFMPEG_ARGS.join(' ')).not.toMatch(/silenceremove|afftdn|highpass/i);
    expect(PCM_WAV_FFMPEG_ARGS).toEqual(
      expect.arrayContaining(['-t', '59', '-ac', '1', '-ar', '16000']),
    );
  });

  it('keeps a silent recording instead of deleting it', async () => {
    const wav = await transcodeToPcmWav(silenceWav(1));
    expect(wav.length).toBeGreaterThan(16_000);
  }, 15_000);
});
