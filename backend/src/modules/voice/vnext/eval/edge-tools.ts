import type { ToolExecutor } from '../broker/read-broker';
import type { EdgeCase } from './edge-cases';

const USER = 'user-1';

/** Synthetic reads for one fixture. A timeout stays an error. Another user's row is not returned. */
export function edgeTool(edge: EdgeCase): ToolExecutor {
  return async (name, args) => {
    if (edge.id === 'edge-tool-timeout' && name === 'find_free_gaps') {
      throw new Error('timeout');
    }
    const day = typeof args.day === 'string' ? args.day : undefined;
    if (name === 'get_now_next') return { now: edge.nowIso, current: null, next: null, scope: 'now' };
    if (name === 'get_day_agenda') return { day, items: [], count: 0, scope: 'day' };
    if (name === 'find_free_gaps') return { day, gaps: [], scope: 'day' };
    if (name === 'list_unscheduled' || name === 'list_problematic' || name === 'list_reminders') {
      return { items: [], scope: 'open' };
    }
    if (name === 'match_task') {
      const query = String(args.query ?? '').trim().toLocaleLowerCase();
      const matches = edge.entities.filter((entity) =>
        entity.userId === USER
        && entity.status === 'open'
        && entity.name.trim().toLocaleLowerCase() === query);
      return { matches: matches.map((entity) => ({ id: entity.id, name: entity.name, type: entity.type })) };
    }
    if (name === 'get_task') {
      const id = String(args.taskId ?? '');
      const found = edge.entities.find((entity) => entity.id === id && entity.userId === USER);
      if (!found) return { error: 'not_found' };
      return { id: found.id, name: found.name, type: found.type };
    }
    return { error: 'unknown_tool' };
  };
}
