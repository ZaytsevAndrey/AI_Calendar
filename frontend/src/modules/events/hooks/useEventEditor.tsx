import React, { useState } from 'react';
import {
  useCreateEventMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import TaskForm from 'modules/tasks/components/TaskForm';
import type { TaskFormValues } from 'modules/tasks/task-wizard/schema';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

export type CreateTaskDefaults = {
  deadline?: string;
  earliestStartTime?: string;
  formPrefill?: TaskFormValues;
};

export function useEventEditor() {
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [createDefaults, setCreateDefaults] = useState<CreateTaskDefaults | undefined>();
  const { data: phases = [] } = useGetAllPhasesQuery();
  const [createEvent, createEventState] = useCreateEventMutation();
  const [updateEvent, updateEventState] = useUpdateEventMutation();

  const close = () => {
    setOpen(false);
    setEditingEvent(null);
    setCreateDefaults(undefined);
  };

  const openCreate = (defaults?: CreateTaskDefaults) => {
    setEditingEvent(null);
    setCreateDefaults(defaults);
    setOpen(true);
  };

  const openCreateFromPrefill = (formPrefill: TaskFormValues) => {
    openCreate({ formPrefill });
  };

  const openEdit = (event: TaskDTO) => {
    setEditingEvent(event);
    setOpen(true);
  };

  const cleanPayload = (data: CreateTaskDTO | UpdateTaskDTO): CreateTaskDTO | UpdateTaskDTO => {
    const cleanData = { ...data };
    if ((cleanData as { phaseId?: string }).phaseId === '') {
      delete (cleanData as { phaseId?: string }).phaseId;
    }
    if (!cleanData.timeZone) {
      cleanData.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    return cleanData;
  };

  const submit = async (data: CreateTaskDTO | UpdateTaskDTO) => {
    const cleanData = cleanPayload(data);
    try {
      if (editingEvent) {
        await updateEvent({ id: editingEvent.id, body: cleanData as UpdateTaskDTO }).unwrap();
        showSuccessToast('Task updated.');
      } else {
        await createEvent(cleanData as CreateTaskDTO).unwrap();
        showSuccessToast('Task created.');
      }
      close();
    } catch (err) {
      showErrorToast(extractApiErrorMessage(err));
    }
  };

  const createFromPayload = async (data: CreateTaskDTO) => {
    await createEvent(cleanPayload(data) as CreateTaskDTO).unwrap();
    showSuccessToast('Task created.');
  };

  const isSaving = createEventState.isLoading || updateEventState.isLoading;

  const editorModal = (
    <Modal
      open={open}
      onClose={close}
      title={editingEvent ? 'Edit task' : 'Create task'}
      maxWidthClass="max-w-xl"
      footer={null}
    >
      <div>
        <TaskForm
          key={
            editingEvent?.id ??
            createDefaults?.formPrefill?.name ??
            createDefaults?.deadline ??
            'new'
          }
          initialData={editingEvent || undefined}
          createDefaults={createDefaults}
          phases={phases}
          onSubmit={submit}
          isSubmitting={isSaving}
          onCancel={close}
          mode={editingEvent ? 'edit' : 'create'}
        />
      </div>
    </Modal>
  );

  return { openCreate, openCreateFromPrefill, openEdit, createFromPayload, editorModal };
}
