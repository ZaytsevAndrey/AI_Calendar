import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isVoiceLog,
  redactSecrets,
  sanitizeVoiceLogLine,
  VoiceFileLogger,
} from './voice-file-logger';

describe('isVoiceLog', () => {
  it('keeps voice module loggers and /voice HTTP or exceptions', () => {
    expect(isVoiceLog('[llm:planner.round0] {}', 'VoiceAgentOrchestrator')).toBe(true);
    expect(isVoiceLog('REQUEST: POST /voice/turn | query: {}', 'HTTP')).toBe(true);
    expect(
      isVoiceLog(
        'voice.trace POST /voice/turn 201 118432ms | llm 1x 100ms | other 0x 0ms | gap 118332ms',
        'HTTP',
      ),
    ).toBe(true);
    expect(isVoiceLog('POST /voice/speak\nStatus: 500', 'Exception')).toBe(true);
    expect(isVoiceLog('REQUEST: GET /tasks', 'HTTP')).toBe(false);
    expect(isVoiceLog('boot', 'NestFactory')).toBe(false);
  });
});

describe('sanitizeVoiceLogLine', () => {
  it('drops bearer tokens and the headers blob', () => {
    const raw =
      'REQUEST: POST /voice/turn | body: {"text":"hi"} | headers: {"authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.sig"}';
    const clean = sanitizeVoiceLogLine(raw);
    expect(clean).toContain('body: {"text":"hi"}');
    expect(clean).not.toContain('eyJ');
    expect(clean).not.toContain('headers');
  });

  it('omits exception headers and clips a long speak response', () => {
    const raw = `POST /voice/speak\nBody: {"text":"ok"}\nHeaders: {"authorization":"Bearer abc.def.ghi"}`;
    expect(sanitizeVoiceLogLine(raw)).toContain('Headers: [omitted]');
    expect(sanitizeVoiceLogLine(raw)).not.toContain('abc.def.ghi');

    const wav = `| response: ${'A'.repeat(2500)}`;
    expect(sanitizeVoiceLogLine(wav).endsWith('…')).toBe(true);
    expect(sanitizeVoiceLogLine(wav).length).toBeLessThan(wav.length);
  });

  it('redacts quoted secrets that are not bearer tokens', () => {
    expect(redactSecrets('{"password":"secret","refreshToken":"r1"}')).toBe(
      '{"password":"[redacted]","refreshToken":"[redacted]"}',
    );
  });
});

describe('VoiceFileLogger', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'voice-log-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends voice lines and skips the rest', () => {
    const file = join(dir, 'voice-agent.log');
    const logger = new VoiceFileLogger(file);
    logger.log('REQUEST: GET /tasks', 'HTTP');
    logger.log('[llm:planner.round0] {"type":"final"}', 'VoiceAgentOrchestrator');
    logger.error('POST /voice/speak failed', 'at VoiceController.speak', 'Exception');

    const text = readFileSync(file, 'utf8');
    expect(text).toContain('voice file log started');
    expect(text).toContain('[llm:planner.round0]');
    expect(text).toContain('POST /voice/speak failed');
    expect(text).toContain('at VoiceController.speak');
    expect(text).not.toContain('GET /tasks');
  });
});
