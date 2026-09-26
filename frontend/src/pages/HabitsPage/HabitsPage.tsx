import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useCreateHabitMutation,
  useDeleteHabitMutation,
  useGetHabitsQuery,
  useUpdateHabitMutation,
} from 'api/habitsApi';
import type { CreateHabitDTO, HabitDTO, UpdateHabitDTO } from 'api/habits.api';
import HabitGrid from 'modules/habits/components/HabitGrid';
import HabitForm from 'modules/habits/components/HabitForm';
import { Modal } from '../../ui/Modal';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

const HabitsPage: React.FC = () => {
  const { t } = useTranslation();
  const { data, isLoading, error } = useGetHabitsQuery();
  const [createHabit, { isLoading: isCreating }] = useCreateHabitMutation();
  const [updateHabit, { isLoading: isUpdating }] = useUpdateHabitMutation();
  const [deleteHabit, { isLoading: isDeleting }] = useDeleteHabitMutation();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<HabitDTO | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<HabitDTO | null>(null);

  const habits = data?.habits ?? [];
  const doneToday = habits.filter((habit) => habit.checkedToday).length;
  const totalPoints = habits.reduce((sum, habit) => sum + habit.points, 0);

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (habit: HabitDTO) => {
    setEditing(habit);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const handleSubmit = async (payload: CreateHabitDTO | UpdateHabitDTO) => {
    try {
      if (editing) {
        await updateHabit({ id: editing.id, habit: payload }).unwrap();
        showSuccessToast({ title: t('habits.updated'), detail: payload.name || editing.name });
      } else {
        const created = await createHabit(payload as CreateHabitDTO).unwrap();
        showSuccessToast({ title: t('habits.added'), detail: created.name });
      }
      closeForm();
    } catch (err) {
      showErrorToast({
        title: editing ? t('habits.updateFailed') : t('habits.createFailed'),
        detail: extractApiErrorMessage(err),
      });
    }
  };

  const confirmDelete = async () => {
    const habit = deleteConfirm ?? editing;
    if (!habit) return;
    try {
      await deleteHabit(habit.id).unwrap();
      showSuccessToast({ title: t('habits.deleted'), detail: habit.name });
      setDeleteConfirm(null);
      closeForm();
    } catch (err) {
      showErrorToast({
        title: t('habits.deleteFailed'),
        detail: extractApiErrorMessage(err),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="page-shell-fill">
        <div className="flex flex-1 items-center justify-center text-sm text-ide-muted">
          {t('habits.loading')}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell-fill">
        <div className="rounded-xl border border-ide-error bg-ide-error/10 px-4 py-6 text-center text-ide-error">
          {t('habits.loadError')}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-fill">
      <header className="page-head shrink-0">
        <div>
          <h1 className="page-title">{t('habits.title')}</h1>
          <p className="page-lead">{t('habits.lead')}</p>
        </div>
        <button type="button" onClick={openCreate} className="ui-btn-primary max-md:hidden">
          {t('habits.add')}
        </button>
        <button type="button" onClick={openCreate} className="ui-icon-btn text-ide-link md:hidden">
          <Plus className="h-4 w-4" aria-hidden />
          <span className="sr-only">{t('habits.add')}</span>
        </button>
      </header>

      {habits.length > 0 ? (
        <div className="mb-4 flex shrink-0 flex-wrap gap-3 text-sm text-ide-muted">
          <span className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2 text-ide-text">
            {t('habits.todayCount', { done: doneToday, total: habits.length })}
          </span>
          <span className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2 text-ide-text">
            {t('habits.points', { count: totalPoints })}
          </span>
        </div>
      ) : null}

      <div className="page-scroll">
        {habits.length === 0 ? (
          <div className="empty-list">{t('habits.empty')}</div>
        ) : (
          <HabitGrid
            habits={habits}
            today={data?.today ?? ''}
            editableFrom={data?.editableFrom ?? ''}
            editableTo={data?.editableTo ?? ''}
            onEdit={openEdit}
          />
        )}
      </div>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editing ? t('habits.editTitle') : t('habits.newTitle')}
        maxWidthClass="max-w-lg"
      >
        <HabitForm
          key={editing?.id ?? 'new'}
          initialData={editing}
          onSubmit={(payload) => void handleSubmit(payload)}
          isSubmitting={isCreating || isUpdating}
          onCancel={closeForm}
          onDelete={editing ? () => setDeleteConfirm(editing) : undefined}
          isDeleting={isDeleting}
        />
      </Modal>

      <Modal
        open={Boolean(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
        title={t('habits.deleteTitle')}
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              className="ui-btn-secondary w-full sm:w-auto"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              className="ui-btn-danger w-full sm:w-auto"
              disabled={isDeleting}
            >
              {isDeleting ? t('common.deleting') : t('common.delete')}
            </button>
          </>
        }
      >
        <p className="text-ide-text">
          {t('habits.deleteConfirm', { name: deleteConfirm?.name ?? '' })}
        </p>
      </Modal>
    </div>
  );
};

export default HabitsPage;
