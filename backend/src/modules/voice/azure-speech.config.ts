import { ConfigService } from '@nestjs/config';

/** Same Speech resource for transcription and synthesis. */
export function azureSpeechCredentials(
  config: ConfigService,
): { key: string; region: string } | null {
  const key = config.get<string>('AZURE_SPEECH_KEY')?.trim() || '';
  const region = (config.get<string>('AZURE_SPEECH_REGION') || '')
    .trim()
    .toLowerCase();
  if (!key || !/^[a-z0-9]+$/.test(region)) return null;
  return { key, region };
}
