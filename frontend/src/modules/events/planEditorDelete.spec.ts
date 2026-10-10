import { planEditorDelete } from './planEditorDelete';

describe('planEditorDelete', () => {
  it('confirms one-off delete for non-recurring tasks', () => {
    expect(planEditorDelete({ isRecurring: false }, null)).toEqual({
      kind: 'confirm_one_off',
    });
  });

  it('confirms entire series when recurring has no occurrence context', () => {
    expect(planEditorDelete({ isRecurring: true }, null)).toEqual({
      kind: 'confirm_entire_series',
    });
    expect(planEditorDelete({ isRecurring: true }, {})).toEqual({
      kind: 'confirm_entire_series',
    });
  });

  it('asks series scope when recurring has an opened occurrence', () => {
    expect(
      planEditorDelete({ isRecurring: true }, { startIso: '2026-10-10T09:00:00.000Z' }),
    ).toEqual({ kind: 'ask_series_scope' });
  });
});
