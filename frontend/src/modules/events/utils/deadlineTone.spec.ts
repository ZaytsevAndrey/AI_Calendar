import { deadlineTone, deadlineToneClass, deadlineToneLabel } from './deadlineTone';

describe('deadlineTone', () => {
  const now = Date.parse('2026-09-21T12:00:00.000Z');

  it('marks overdue, today, soon, and none', () => {
    expect(deadlineTone('2026-09-20T12:00:00.000Z', now)).toBe('overdue');
    expect(deadlineTone('2026-09-21T20:00:00.000Z', now)).toBe('today');
    expect(deadlineTone('2026-09-23T12:00:00.000Z', now)).toBe('soon');
    expect(deadlineTone('2026-09-28T12:00:00.000Z', now)).toBe('none');
    expect(deadlineTone(undefined, now)).toBe('none');
    expect(deadlineTone('not-a-date', now)).toBe('none');
  });
});

describe('deadlineTone copy', () => {
  it('maps tones to highlight classes and labels', () => {
    expect(deadlineToneClass('overdue')).toContain('text-ide-error');
    expect(deadlineToneClass('today')).toContain('text-ide-warn');
    expect(deadlineToneClass('soon')).toContain('text-ide-warn');
    expect(deadlineToneClass('none')).toBe('');
    expect(deadlineToneLabel('overdue')).toBe('Overdue · ');
    expect(deadlineToneLabel('today')).toBe('Due soon · ');
    expect(deadlineToneLabel('soon')).toBe('Approaching · ');
    expect(deadlineToneLabel('none')).toBe('');
  });
});
