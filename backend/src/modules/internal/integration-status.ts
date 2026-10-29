export type IntegrationStatus = {
  key: string;
  label: string;
  group: 'auth' | 'llm' | 'speech' | 'push' | 'other';
  configured: boolean;
  detail?: string;
};

/** Present and non-empty. Values are never returned, only whether they are set. */
function has(env: NodeJS.ProcessEnv, ...keys: string[]): boolean {
  return keys.every((k) => Boolean((env[k] || '').trim()));
}

/** Which integrations the client API has keys for. Model and region names only, never secrets. */
export function integrationStatus(env: NodeJS.ProcessEnv = process.env): IntegrationStatus[] {
  const voiceProvider = (env.VOICE_LLM_PROVIDER || '').trim() || 'default';
  return [
    { key: 'google', label: 'Google OAuth / Calendar', group: 'auth', configured: has(env, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET') },
    { key: 'microsoft', label: 'Microsoft OAuth / Outlook', group: 'auth', configured: has(env, 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET') },
    { key: 'groq', label: 'Groq (LLM + Whisper STT)', group: 'llm', configured: has(env, 'GROQ_API_KEY'), detail: env.GROQ_PLANNER_MODEL || env.GROQ_LLM_MODEL || undefined },
    { key: 'gemini', label: 'Gemini planner', group: 'llm', configured: has(env, 'GEMINI_API_KEY'), detail: env.GEMINI_PLANNER_MODEL || undefined },
    { key: 'deepseek', label: 'DeepSeek planner', group: 'llm', configured: has(env, 'DEEPSEEK_API_KEY'), detail: env.DEEPSEEK_PLANNER_MODEL || undefined },
    { key: 'qwen', label: 'Qwen planner', group: 'llm', configured: has(env, 'QWEN_API_KEY'), detail: env.QWEN_PLANNER_MODEL || undefined },
    { key: 'openai', label: 'OpenAI', group: 'llm', configured: has(env, 'OPENAI_API_KEY') },
    { key: 'local-llm', label: 'Local LLM (LLM_BASE_URL)', group: 'llm', configured: has(env, 'LLM_BASE_URL'), detail: env.LLM_MODEL || undefined },
    { key: 'voice-provider', label: 'Voice LLM provider', group: 'llm', configured: true, detail: voiceProvider },
    { key: 'azure-speech', label: 'Azure Speech (STT/TTS)', group: 'speech', configured: has(env, 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'), detail: env.AZURE_SPEECH_REGION || undefined },
    { key: 'piper', label: 'Piper TTS', group: 'speech', configured: has(env, 'PIPER_URL') },
    { key: 'vapid', label: 'Web Push (VAPID)', group: 'push', configured: has(env, 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY') },
    { key: 'reminder-cron', label: 'Reminder cron secret', group: 'push', configured: has(env, 'REMINDER_CRON_SECRET') },
    { key: 'photon', label: 'Places search (Photon)', group: 'other', configured: has(env, 'PHOTON_URL') },
  ];
}
