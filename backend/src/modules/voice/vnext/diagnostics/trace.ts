import type { RepairObserver } from '../repair/repair';

export type BenchmarkTrace = {
  scenarioId: string;
  branch: string;
  model: string;
  modelParameters: Record<string, string | number | boolean>;
  clock: string;
  timezone: string;
  llmCalls: Array<{
    requestMetadata: { systemChars: number; userChars: number };
    rawResponse: string;
    parsedResponse: unknown;
    tokenUsage: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    error?: string;
  }>;
  toolExecutions: Array<{
    request: { requestId: string; name: string; args: Record<string, unknown> };
    result: unknown;
    error: string | null;
  }>;
  schemaValidation: Array<{ valid: boolean; errors: Array<{ code: string; path: string; detail: string }> }>;
  semanticOperations: unknown[];
  referenceResolution: unknown[];
  dependencyResolution: unknown[];
  adapterResults: unknown[];
  policyDecisions: unknown[];
  previewPayload: unknown;
  finalResponse: unknown;
  blocked: string[];
  evaluatorVerdict?: string;
  evaluatorReasons?: string[];
};

export function emptyTrace(input: Pick<BenchmarkTrace, 'scenarioId' | 'branch' | 'model' | 'modelParameters' | 'clock' | 'timezone'>): BenchmarkTrace {
  return {
    ...input,
    llmCalls: [],
    toolExecutions: [],
    schemaValidation: [],
    semanticOperations: [],
    referenceResolution: [],
    dependencyResolution: [],
    adapterResults: [],
    policyDecisions: [],
    previewPayload: null,
    finalResponse: null,
    blocked: [],
  };
}

export function redactSecrets(text: string): string {
  return text
    .replace(/(^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]+/g, '$1[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

export function traceObserver(trace: BenchmarkTrace): RepairObserver {
  return {
    call(input) {
      let parsed: unknown = null;
      if (input.text) {
        try {
          parsed = JSON.parse(input.text) as unknown;
        } catch {
          parsed = null;
        }
      }
      trace.llmCalls.push({
        requestMetadata: { systemChars: input.systemChars, userChars: input.userChars },
        rawResponse: redactSecrets(input.text),
        parsedResponse: parsed,
        tokenUsage: { inputTokens: input.inputTokens, outputTokens: input.outputTokens },
        latencyMs: input.latencyMs,
        ...(input.error ? { error: redactSecrets(input.error) } : {}),
      });
    },
    validation(valid, errors) {
      trace.schemaValidation.push({
        valid,
        errors: errors.map((error) => ({ code: error.code, path: error.path, detail: error.detail })),
      });
    },
  };
}
