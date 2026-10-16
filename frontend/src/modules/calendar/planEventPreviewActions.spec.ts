import {
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
});
