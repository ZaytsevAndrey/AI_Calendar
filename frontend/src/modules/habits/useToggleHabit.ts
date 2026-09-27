import { useCheckInHabitMutation, useUncheckHabitMutation } from 'api/habitsApi';
import i18n from 'i18n';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

export function useToggleHabit() {
  const [checkIn, { isLoading: checking }] = useCheckInHabitMutation();
  const [uncheck, { isLoading: unchecking }] = useUncheckHabitMutation();

  const toggle = async (habitId: string, date: string, currentlyDone: boolean) => {
    try {
      if (currentlyDone) {
        await uncheck({ id: habitId, date }).unwrap();
      } else {
        const result = await checkIn({ id: habitId, date }).unwrap();
        for (const id of result.newlyUnlocked ?? []) {
          showSuccessToast({
            title: i18n.t('habits.achievements.unlocked'),
            detail: i18n.t(`habits.achievements.${id}`),
          });
        }
      }
    } catch (err) {
      showErrorToast({
        title: currentlyDone ? i18n.t('habits.clearFailed') : i18n.t('habits.checkInFailed'),
        detail: extractApiErrorMessage(err),
      });
    }
  };

  return { toggle, busy: checking || unchecking };
}
