import React, { useState } from 'react';
import {
  useCreateHabitMutation,
  useDeleteHabitMutation,
  useGetHabitsQuery,
  useUpdateHabitMutation,
} from 'api/habitsApi';
import type { CreateHabitDTO, HabitDTO, UpdateHabitDTO } from 'api/habits.api';
import HabitCard from 'modules/habits/components/HabitCard';
import HabitForm from 'modules/habits/components/HabitForm';
import { Modal } from '../../ui/Modal';
import { showErrorToast, showSuccessToast } from 'utils/toast';
import { extractApiErrorMessage } from 'utils/extractApiErrorMessage';

const HabitsPage: React.FC = () => {
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
        showSuccessToast({ title: 'Habit updated', detail: payload.name || editing.name });
      } else {
        const created = await createHabit(payload as CreateHabitDTO).unwrap();
        showSuccessToast({ title: 'Habit added', detail: created.name });
      }
      closeForm();
    } catch (err) {
      showErrorToast({
        title: editing ? 'Could not update habit' : 'Could not create habit',
        detail: extractApiErrorMessage(err),
      });
    }
  };

  const confirmDelete = async () => {
    const habit = deleteConfirm ?? editing;
    if (!habit) return;
    try {
      await deleteHabit(habit.id).unwrap();
      showSuccessToast({ title: 'Habit deleted', detail: habit.name });
      setDeleteConfirm(null);
      closeForm();
    } catch (err) {
      showErrorToast({
        title: 'Could not delete habit',
        detail: extractApiErrorMessage(err),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="page-shell-fill">
        <div className="flex flex-1 items-center justify-center text-sm text-ide-muted">
          Loading habits…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-shell-fill">
        <div className="rounded-xl border border-ide-error bg-ide-error/10 px-4 py-6 text-center text-ide-error">
          Could not load habits
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell-fill">
      <header className="page-head shrink-0">
        <div>
          <h1 className="page-title">Habits</h1>
          <p className="page-lead">
            Daily yes/no check-ins. Today and yesterday only. Streaks and points stay here — they
            do not affect your calendar.
          </p>
        </div>
        <button type="button" onClick={openCreate} className="ui-btn-primary w-full sm:w-auto">
          Add habit
        </button>
      </header>

      {habits.length > 0 ? (
        <div className="mb-4 flex shrink-0 flex-wrap gap-3 text-sm text-ide-muted">
          <span className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2 text-ide-text">
            Today {doneToday}/{habits.length}
          </span>
          <span className="rounded-lg border border-ide-border bg-ide-surface px-3 py-2 text-ide-text">
            {totalPoints} points
          </span>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {habits.length === 0 ? (
          <div className="empty-list">
            No habits yet. Add one — for example Exercise or No smoking.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {habits.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                today={data?.today ?? ''}
                yesterday={data?.yesterday ?? ''}
                onEdit={openEdit}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={showForm}
        onClose={closeForm}
        title={editing ? 'Edit habit' : 'New habit'}
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
        title="Delete habit"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDeleteConfirm(null)}
              className="ui-btn-secondary w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmDelete()}
              className="ui-btn-danger w-full sm:w-auto"
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-ide-text">
          Delete &quot;{deleteConfirm?.name}&quot; and all of its check-ins? This cannot be undone.
        </p>
      </Modal>
    </div>
  );
};

export default HabitsPage;
