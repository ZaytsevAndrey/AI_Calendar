import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HabitAchievementsMap } from 'api/habits.api';
import { unlockedAchievementIds } from '../habitAchievements';

type HabitAchievementBadgesProps = {
  achievements: HabitAchievementsMap | null | undefined;
  className?: string;
};

const HabitAchievementBadges: React.FC<HabitAchievementBadgesProps> = ({
  achievements,
  className = '',
}) => {
  const { t } = useTranslation();
  const ids = unlockedAchievementIds(achievements);
  if (ids.length === 0) return null;

  return (
    <ul
      className={`flex flex-wrap gap-1 ${className}`.trim()}
      aria-label={t('habits.achievements.badgesAria')}
    >
      {ids.map((id) => (
        <li
          key={id}
          className="rounded border border-ide-border bg-ide-surface px-1.5 py-0.5 text-[10px] font-medium text-ide-text"
        >
          {t(`habits.achievements.${id}`)}
        </li>
      ))}
    </ul>
  );
};

export default HabitAchievementBadges;
