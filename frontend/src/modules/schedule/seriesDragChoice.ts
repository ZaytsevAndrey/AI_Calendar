export type SeriesDragScope = 'occurrence' | 'series';

export class SeriesMoveCancelled extends Error {
  constructor() {
    super('Series move cancelled');
    this.name = 'SeriesMoveCancelled';
  }
}

type SeriesDragAsker = (taskName: string) => Promise<SeriesDragScope | null>;

let asker: SeriesDragAsker | null = null;

export function registerSeriesDragAsker(next: SeriesDragAsker | null): void {
  asker = next;
}

export function askSeriesDragScope(taskName: string): Promise<SeriesDragScope | null> {
  if (!asker) return Promise.resolve(null);
  return asker(taskName);
}
