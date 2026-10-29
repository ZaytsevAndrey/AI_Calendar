export type Overview = {
  generatedAt: string;
  users: { total: number; new7d: number; new30d: number; active24h: number; active7d: number; blocked: number };
  tasks: { total: number; created7d: number; byStatus: Record<string, number> };
  voice: {
    dailyTokenLimit: number;
    tokensToday: number;
    tokens7d: number;
    users7d: number;
    turns24h: number;
    errorRate24h: number;
    p50Ms24h: number;
    p95Ms24h: number;
  };
  ops: {
    pendingGoogleWrites: number;
    failedScheduleJobs24h: number;
    errors24h: { server: number; client: number };
    pushSubscribers: number;
    remindersSent24h: number;
  };
  series: Array<{ day: string; signups: number; voiceTokens: number; voiceUsers: number; voiceTurns: number; voiceErrors: number }>;
};

export type UserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastActiveAt: string | null;
  isBlocked: boolean;
  providers: string[];
  tasks: number;
  voiceTokens7d: number;
  timeZone: string | null;
  language: string | null;
};

export type UserList = { page: number; pageSize: number; total: number; items: UserRow[] };

export type TurnRow = {
  id: string;
  userId: string | null;
  email: string | null;
  traceId?: string;
  method?: string;
  path: string;
  statusCode: number;
  totalMs: number;
  llmCalls: number;
  llmMs?: number;
  tokens: number;
  failedSteps?: number;
  errorCode: string | null;
  createdAt: string;
};

export type VoiceStep = {
  kind: 'llm' | 'other';
  name: string;
  via: string;
  ms: number;
  ok: boolean;
  component?: string;
  segment?: number;
  tokens?: number;
  decision?: string;
  errorCode?: string;
  reason?: string;
  valid?: boolean;
  outcome?: string;
};

export type TurnDetail = TurnRow & { steps: VoiceStep[] };

export type UserDetail = {
  user: UserRow & { updatedAt: string | null; isEmailVerified: boolean; hasGoogleLogin: boolean };
  settings: { timeZone: string | null; language: string | null; speechLanguage: string | null } | null;
  identities: Array<{ provider: string; email: string | null; createdAt: string | null; isRegistrationIdentity: boolean }>;
  tasks: { byStatus: Record<string, number>; scheduled: number };
  voice: { dailyTokenLimit: number; tokensToday: number; series: Array<{ day: string; tokens: number }>; recentTurns: TurnRow[] };
  jobs: Array<{ id: string; status: string; progressStage: string | null; errorMessage: string | null; createdAt: string; updatedAt: string }>;
  pendingGoogleWrites: Array<{ id: string; operation: string; attempts: number; lastError: string | null; enqueuedAt: string | null }>;
  push: { subscriptions: number; remindersSent7d: number };
};

export type VoiceSummary = {
  days: number;
  dailyTokenLimit: number;
  totals: { tokens: number; turns: number; errors: number; users: number; p50Ms: number; p95Ms: number };
  series: Array<{ day: string; tokens: number; users: number; turns: number; errors: number }>;
  topUsers: Array<{ userId: string; email: string | null; tokens: number; turns: number }>;
  models: Array<{ via: string; calls: number; failed: number; tokens: number; p50Ms: number; p95Ms: number }>;
  routes: Array<{ path: string; turns: number; errors: number; p50Ms: number; p95Ms: number }>;
  errorCodes: Array<{ code: string; count: number }>;
};

export type Integration = { key: string; label: string; group: string; configured: boolean; detail?: string };

export type Health = {
  status: 'ok' | 'degraded' | 'down';
  checks: Array<{ key: string; ok: boolean }>;
  clientApi:
    | {
        reachable: true;
        latencyMs: number;
        nodeEnv: string;
        node: string;
        commit: string | null;
        startedAt: string;
        uptimeSec: number;
        memoryMb: { rss: number; heapUsed: number; heapTotal: number };
        integrations: Integration[];
        error: null;
      }
    | { reachable: false; error: string };
  adminApi: { nodeEnv: string; node: string; commit: string | null; uptimeSec: number; memoryMb: { rss: number; heapUsed: number } };
  database: { type: string; ok: boolean; latencyMs: number; error: string | null };
  queues: {
    pendingGoogleWrites: number;
    oldestGoogleWriteAt: string | null;
    maxGoogleWriteAttempts: number;
    scheduleJobsActive: number;
    scheduleJobsStuck: number;
    scheduleJobsFailed24h: number;
  };
  errors24h: { server: number; client: number };
};

export type ScheduleJobRow = {
  id: string;
  userId: string;
  email: string | null;
  status: string;
  progressStage: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  durationMs: number;
};

export type GoogleWriteRow = {
  id: string;
  userId: string;
  email: string | null;
  taskId: string | null;
  operation: string;
  attempts: number;
  lastError: string | null;
  enqueuedAt: string;
};

export type ErrorEntry = {
  at: string;
  method: string;
  path: string;
  status: number;
  code: string | null;
  message: string;
  userId: string | null;
};
