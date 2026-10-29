import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { TaskDTO } from 'api/tasks.api';
import { Modal } from '../../../ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
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
        footer={
          <Button
            type="button"
            variant="secondary"
            size={dialogButtonSize}
            className="w-full sm:w-auto"
            onClick={onClose}
            icon={X}
          >
            {t('common.close')}
          </Button>
        }
      >
        {groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-ide-muted">
            {t('schedule.problematicEmpty')}
          </p>
        ) : (
          <>
            <p className="mb-4 text-sm text-ide-muted">{t('schedule.problematicIntro')}</p>
            <div className="flex flex-col gap-5">
              {groups.map((group) => (
                <section key={group.ymd ?? 'none'}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ide-muted">
                    {group.ymd
                      ? formatCivilYmd(group.ymd) ?? group.ymd
                      : t('schedule.problematicNoDayGroup')}
                  </h3>
                  <ul className="flex flex-col gap-3">
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
