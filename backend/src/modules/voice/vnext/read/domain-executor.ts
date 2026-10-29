import { VoiceAgentTools, type VoiceToolContext } from '../../voice-agent.tools';

/**
 * Arm A reads go through VoiceAgentTools, the same methods production uses.
 * The task and slot lists are the caller's snapshot. The external calendar
 * is probed first so a provider failure is not reported as an empty day.
 * VoiceAgentTools itself swallows external errors; this adapter does not.
 */
export function domainReadExecutor(
  tools: VoiceAgentTools,
  context: VoiceToolContext,
  probeExternal: () => Promise<void>,
) {
  const needsExternal = new Set(['get_now_next', 'get_day_agenda', 'find_free_gaps']);
  return async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    if (needsExternal.has(name)) {
      try {
        await probeExternal();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'provider_unavailable';
        return { error: message === 'timeout' ? 'provider_timeout' : 'provider_unavailable' };
      }
    }
    return tools.execute({ name, args }, context);
  };
}
