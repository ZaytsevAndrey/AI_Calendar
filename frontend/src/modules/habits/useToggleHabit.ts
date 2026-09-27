import { useCheckInHabitMutation, useUncheckHabitMutation } from 'api/habitsApi';
import type { HabitAchievementId } from 'api/habits.api';
import i18n from 'i18n';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

function isStreakAchievement(id: HabitAchievementId): boolean {
  return id.startsWith('streak_');
}

export function useToggleHabit() {
  const [checkIn, { isLoading: checking }] = useCheckInHabitMutation();
  const [uncheck, { isLoading: unchecking }] = useUncheckHabitMutation();

  const toggle = async (habitId: string, date: string, currentlyDone: boolean) => {
    try {
      if (currentlyDone) {
        await uncheck({ id: habitId, date }).unwrap();
      } else {
        const result = await checkIn({ id: habitId, date }).unwrap();
        let tipShown = false;
        for (const id of result.newlyUnlocked ?? []) {
          const useTip =
            !tipShown && Boolean(result.streakTip) && isStreakAchievement(id);
          showSuccessToast({
            title: useTip
              ? i18n.t('habits.streakTipTitle')
              : i18n.t('habits.achievements.unlocked'),
            detail: useTip
              ? result.streakTip
              : i18n.t(`habits.achievements.${id}`),
          });
          if (useTip) tipShown = true;
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
