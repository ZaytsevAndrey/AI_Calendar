import { ConsoleLogger } from '@nestjs/common';
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const VOICE_LOG_CONTEXTS = new Set([
  'VoiceAgentOrchestrator',
  'StructuredVoiceService',
  'VoiceService',
  'VoiceDayPlanner',
  'GroqClient',
  'AzureSttClient',
  'AzureTtsClient',
  'PiperSpeechService',
]);

const RESPONSE_KEEP = 2000;
const LINE_KEEP = 16000;

/**
 * backend/logs/voice-agent.log from src/, dist/, and dist/src/. The build nests output one level
 * deeper when it includes benchmark/, so the backend root is found by nest-cli.json, not by depth.
 */
export function defaultVoiceLogPath(start = __dirname): string {
  let dir = start;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'nest-cli.json'))) return join(dir, 'logs', 'voice-agent.log');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(start, '..', '..', 'logs', 'voice-agent.log');
}

export function isVoiceLog(message: string, context?: string): boolean {
  if (context && VOICE_LOG_CONTEXTS.has(context)) return true;
  if (context === 'HTTP' || context === 'Exception') {
    return /\/voice(?:[/?\s]|$)/.test(message);
  }
  return false;
}

export function redactSecrets(text: string): string {
  return text
    .replace(
      /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi,
      'Bearer [redacted]',
    )
    .replace(
      /("(?:authorization|cookie|set-cookie|password|refreshToken|accessToken)"\s*:\s*")[^"]*"/gi,
      '$1[redacted]"',
    );
}

/** Drop auth headers and clip binary speak responses before the line hits disk. */
export function sanitizeVoiceLogLine(text: string): string {
  let out = text.replace(/\s*\|\s*headers:\s*\{[\s\S]*$/i, '');
  out = out.replace(/\nHeaders:\s*\{[\s\S]*$/i, '\nHeaders: [omitted]');
  out = redactSecrets(out);
  // Recorded audio is not readable in a log line; keep only its size.
  out = out.replace(/("audioBase64"\s*:\s*")([^"]*)"/g, (_match, key: string, data: string) => `${key}[${data.length} chars omitted]"`);
  const marker = '| response:';
  const idx = out.indexOf(marker);
  if (idx >= 0 && out.length - (idx + marker.length) > RESPONSE_KEEP) {
    out = `${out.slice(0, idx + marker.length + RESPONSE_KEEP)}…`;
  }
  if (out.length > LINE_KEEP) out = `${out.slice(0, LINE_KEEP)}…`;
  return out;
}

function asText(message: unknown): string {
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(message);
  } catch {
    return String(message);
  }
}

function splitParams(
  level: string,
  params: unknown[],
): { context?: string; stack?: string } {
  const last = params.length ? params[params.length - 1] : undefined;
  const context = typeof last === 'string' ? last : undefined;
  if (level !== 'ERROR') return { context };
  const stackCandidate = params.length >= 2 ? params[params.length - 2] : undefined;
  if (
    typeof stackCandidate === 'string' &&
    stackCandidate !== context &&
    (stackCandidate.includes('\n') || /^\s*at /.test(stackCandidate))
  ) {
    return { context, stack: stackCandidate };
  }
  return { context };
}

/**
 * Nest console logger that also appends voice-agent lines to a file.
 * The dev console buffer is only a few dozen rows, so planner and speak
 * traces scroll away. Auth material is stripped before the write.
 */
export class VoiceFileLogger extends ConsoleLogger {
  constructor(private readonly filePath = defaultVoiceLogPath()) {
    super();
    mkdirSync(dirname(this.filePath), { recursive: true });
    this.write('LOG', 'VoiceFileLogger', 'voice file log started');
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(message, ...optionalParams);
    this.persist('LOG', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(message, ...optionalParams);
    this.persist('WARN', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...optionalParams);
    this.persist('ERROR', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(message, ...optionalParams);
    this.persist('DEBUG', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(message, ...optionalParams);
    this.persist('VERBOSE', message, optionalParams);
  }

  private persist(level: string, message: unknown, optionalParams: unknown[]): void {
    const text = asText(message);
    const { context, stack } = splitParams(level, optionalParams);
    if (!isVoiceLog(text, context)) return;
    this.write(level, context, text, stack);
  }

  private write(
    level: string,
    context: string | undefined,
    message: string,
    stack?: string,
  ): void {
    const ctx = context ? ` [${context}]` : '';
    let line = `${new Date().toISOString()} ${level}${ctx} ${sanitizeVoiceLogLine(message)}`;
    if (stack) line += `\n${sanitizeVoiceLogLine(stack)}`;
    try {
      appendFileSync(this.filePath, `${line}\n`);
    } catch {
      // Console already has the line.
    }
  }
}
