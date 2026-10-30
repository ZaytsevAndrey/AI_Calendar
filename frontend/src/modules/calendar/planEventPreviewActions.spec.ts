import {
  canCompleteFromPreview,
  canUndoDoneFromPreview,
  planEventPreviewEditTarget,
  isEventPreviewSeries,
  planEventPreviewDelete,
  planEventPreviewDeleteMutation,
  planEventPreviewEdit,
} from './planEventPreviewActions';

describe('planEventPreviewActions', () => {
  describe('isEventPreviewSeries', () => {
    it('is true for recurring app tasks', () => {
      expect(isEventPreviewSeries({ taskIsRecurring: true })).toBe(true);
    });

    it('is true for Google recurring instances', () => {
      expect(
        isEventPreviewSeries({ recurringEventId: 'series-master-id' }),
      ).toBe(true);
    });

    it('is false for one-off events', () => {
      expect(isEventPreviewSeries({})).toBe(false);
      expect(
        isEventPreviewSeries({ taskIsRecurring: false, recurringEventId: null }),
      ).toBe(false);
    });
  });

  describe('planEventPreviewEdit', () => {
    it('opens a series menu for repeating items', () => {
      expect(planEventPreviewEdit({ taskIsRecurring: true })).toBe('series_menu');
      expect(
        planEventPreviewEdit({ recurringEventId: 'master' }),
      ).toBe('series_menu');
    });

    it('opens the editor directly for one-offs', () => {
      expect(planEventPreviewEdit({})).toBe('direct');
    });
  });

  describe('planEventPreviewDelete', () => {
    it('confirms Google delete when there is no linked task', () => {
      expect(
        planEventPreviewDelete({
          hasLinkedTask: false,
          recurringEventId: 'master',
        }),
      ).toBe('confirm_google');
    });

    it('opens a series menu for linked recurring tasks', () => {
      expect(
        planEventPreviewDelete({
          hasLinkedTask: true,
          taskIsRecurring: true,
        }),
      ).toBe('series_menu');
      expect(
        planEventPreviewDelete({
          hasLinkedTask: true,
          recurringEventId: 'master',
        }),
      ).toBe('series_menu');
    });

    it('confirms a one-off task delete', () => {
      expect(
        planEventPreviewDelete({
          hasLinkedTask: true,
          taskIsRecurring: false,
        }),
      ).toBe('confirm_task');
    });
  });

  describe('planEventPreviewDeleteMutation', () => {
    it('maps scopes to calendar mutations', () => {
      expect(planEventPreviewDeleteMutation('occurrence')).toEqual({
        kind: 'skip_occurrence',
      });
      expect(planEventPreviewDeleteMutation('series')).toEqual({
        kind: 'end_series_from',
      });
      expect(planEventPreviewDeleteMutation('all')).toEqual({
        kind: 'delete_task',
      });
    });
  });

  describe('canCompleteFromPreview', () => {
    it('allows one-off app todos', () => {
      expect(
        canCompleteFromPreview({
          isRecurring: false,
          isFixedExternal: false,
          status: 'todo',
        }),
      ).toBe(true);
    });

    it('allows a series day: that day gets its own completion', () => {
      expect(
        canCompleteFromPreview({
          isRecurring: true,
          isFixedExternal: false,
          status: 'todo',
        }),
      ).toBe(true);
    });

    it('a completed one-off can be undone, a series cannot be undone as a whole', () => {
      expect(canUndoDoneFromPreview({ isRecurring: false, isFixedExternal: false, status: 'completed' })).toBe(true);
      expect(canUndoDoneFromPreview({ isRecurring: false, isFixedExternal: false, status: 'todo' })).toBe(false);
      expect(canUndoDoneFromPreview({ isRecurring: true, isFixedExternal: false, status: 'completed' })).toBe(false);
    });

    it('rejects external, completed, canceled, and null', () => {
      expect(canCompleteFromPreview(null)).toBe(false);
      expect(
        canCompleteFromPreview({
          isRecurring: false,
          isFixedExternal: true,
          status: 'todo',
        }),
      ).toBe(false);
      expect(
        canCompleteFromPreview({
          isRecurring: false,
          isFixedExternal: false,
          status: 'completed',
        }),
      ).toBe(false);
      expect(
        canCompleteFromPreview({
          isRecurring: false,
          isFixedExternal: false,
          status: 'canceled',
        }),
      ).toBe(false);
    });
  });
});

describe('planEventPreviewEditTarget', () => {
  it('a one-off or no chosen scope opens the ordinary editor', () => {
    expect(planEventPreviewEditTarget({ taskIsRecurring: false, scope: 'occurrence', hasOccurrence: true })).toEqual({ kind: 'task' });
    expect(planEventPreviewEditTarget({ taskIsRecurring: true, hasOccurrence: true })).toEqual({ kind: 'task' });
  });

  it('«this day» and «this and following» open the occurrence editor with that scope', () => {
    expect(planEventPreviewEditTarget({ taskIsRecurring: true, scope: 'occurrence', hasOccurrence: true })).toEqual({
      kind: 'occurrence',
      scope: 'occurrence',
    });
    expect(planEventPreviewEditTarget({ taskIsRecurring: true, scope: 'series', hasOccurrence: true })).toEqual({
      kind: 'occurrence',
      scope: 'following',
    });
  });

  it('a one-day scope without a known day is refused, not widened to the series', () => {
    expect(planEventPreviewEditTarget({ taskIsRecurring: true, scope: 'occurrence', hasOccurrence: false })).toEqual({
      kind: 'unsupported',
    });
  });

  it('«entire series» opens the series editor', () => {
    expect(planEventPreviewEditTarget({ taskIsRecurring: true, scope: 'all', hasOccurrence: true })).toEqual({ kind: 'series' });
  });
});
