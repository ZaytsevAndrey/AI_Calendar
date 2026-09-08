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
import { describeTaskToastDetail } from '../../../utils/formatDate';

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
  const [createEvent] = useCreateEventMutation();
  const [updateEvent] = useUpdateEventMutation();

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

  const submit = (data: CreateTaskDTO | UpdateTaskDTO) => {
    const cleanData = cleanPayload(data);
    const editing = editingEvent;
    close();
    const request = editing
      ? updateEvent({ id: editing.id, body: cleanData as UpdateTaskDTO }).unwrap()
      : createEvent(cleanData as CreateTaskDTO).unwrap();
    void request
      .then(() => {
        showSuccessToast({
          title: editing ? 'Task updated' : 'Task created',
          detail: describeTaskToastDetail(editing ? { ...editing, ...cleanData } : cleanData),
        });
      })
      .catch((err) => {
        showErrorToast({
          title: editing ? 'Could not update task' : 'Could not create task',
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const createFromPayload = async (data: CreateTaskDTO) => {
    const cleanData = cleanPayload(data) as CreateTaskDTO;
    await createEvent(cleanData).unwrap();
    showSuccessToast({
      title: 'Task created',
      detail: describeTaskToastDetail(cleanData),
    });
  };

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
          isSubmitting={false}
          onCancel={close}
          mode={editingEvent ? 'edit' : 'create'}
        />
      </div>
    </Modal>
  );

  return { openCreate, openCreateFromPrefill, openEdit, createFromPayload, editorModal };
}
