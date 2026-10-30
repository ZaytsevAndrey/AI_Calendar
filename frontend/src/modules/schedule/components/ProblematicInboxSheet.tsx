import React, { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDTO } from 'api/tasks.api';
import { Modal } from '../../../ui/Modal';
import { formatCivilYmd } from '../../../utils/formatDate';
import type { ParkDayHint } from '../parkDayHints';
import { todayYmdInZone } from '../problematicDays';
import { markProblematicHandled } from '../problematicSeatWatch';
import {
  groupProblematicByDay,
  problematicItems,
  type ProblematicItem,
} from '../problematicItems';
import { MoveOccurrenceSheet } from './MoveOccurrenceSheet';
import { ProblematicItemCard } from './ProblematicItemCard';
import { useMotionPresence } from '../../calendar/motion/useMotionPresence';

type Props = {
  open: boolean;
  tasks: TaskDTO[];
  timeZone: string;
  dayHints?: Record<string, ParkDayHint>;
  onClose: () => void;
  onEdit: (task: TaskDTO) => void;
};

/** Parked tasks grouped by the day that did not fit; each card is one day. */
export function ProblematicInboxSheet({
  open,
  tasks,
  timeZone,
  dayHints = {},
  onClose,
  onEdit,
}: Props) {
  const { t } = useTranslation();
  const [moveTarget, setMoveTarget] = useState<{
    task: TaskDTO;
    occurrenceYmd: string;
  } | null>(null);

  const todayYmd = todayYmdInZone(timeZone);
  const groups = useMemo(
    () => groupProblematicByDay(problematicItems(tasks, dayHints, todayYmd)),
    [tasks, dayHints, todayYmd],
  );

  // A card that gets a slot flies from this list to the grid (calendar/motion).
  const listRef = useRef<HTMLDivElement>(null);
  useMotionPresence(listRef, { resetKey: open ? 'open' : 'closed' });

  const edit = (item: ProblematicItem) => {
    // A new clock saved from the form seats it: the user's own doing.
    markProblematicHandled(item.task.id);
    onEdit(item.task);
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('schedule.problematicTitle')}
        maxWidthClass="max-w-md"
      >
        {groups.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-ide-muted">
            {t('schedule.problematicEmpty')}
          </p>
        ) : (
          <>
            <p className="mb-4 text-body-sm text-ide-muted">{t('schedule.problematicIntro')}</p>
            <div ref={listRef} className="flex flex-col gap-5" data-motion-scroll>
              {groups.map((group) => (
                <section key={group.ymd ?? 'none'}>
                  <h3 className="mb-2 text-body-sm font-medium text-ide-muted">
                    {group.ymd
                      ? formatCivilYmd(group.ymd) ?? group.ymd
                      : t('schedule.problematicNoDayGroup')}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {group.items.map((item) => (
                      <ProblematicItemCard
                        key={item.key}
                        item={item}
                        timeZone={timeZone}
                        todayYmd={todayYmd}
                        onMove={(picked, ymd) =>
                          setMoveTarget({ task: picked.task, occurrenceYmd: ymd })
                        }
                        onEdit={edit}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </Modal>
      <MoveOccurrenceSheet
        target={moveTarget}
        timeZone={timeZone}
        onClose={() => setMoveTarget(null)}
        onDone={() => setMoveTarget(null)}
      />
    </>
  );
}
