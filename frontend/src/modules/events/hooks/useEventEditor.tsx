import React, { useState } from 'react';
import {
  useCreateEventMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import TaskForm from 'modules/tasks/components/TaskForm';
import { formValuesFromCreatePayload } from 'modules/tasks/task-wizard/buildPayload';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { describeTaskToastDetail } from '../../../utils/formatDate';

export type CreateTaskDefaults = {
  deadline?: string;
  earliestStartTime?: string;
};

export function useEventEditor() {
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [createDefaults, setCreateDefaults] = useState<CreateTaskDefaults | undefined>();
  const [formPrefill, setFormPrefill] = useState<ReturnType<typeof formValuesFromCreatePayload> | undefined>();
  const { data: phases = [] } = useGetAllPhasesQuery();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [createEvent] = useCreateEventMutation();
  const [updateEvent] = useUpdateEventMutation();

  const close = () => {
    setOpen(false);
    setEditingEvent(null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
  };

  const openCreate = (defaults?: CreateTaskDefaults) => {
    setEditingEvent(null);
    setCreateDefaults(defaults);
    setFormPrefill(undefined);
    setOpen(true);
  };

  const openCreateFromPrefill = (payload: CreateTaskDTO) => {
    setEditingEvent(null);
    setCreateDefaults(undefined);
    setFormPrefill(formValuesFromCreatePayload(payload, timeZone));
    setOpen(true);
  };

  const openEdit = (event: TaskDTO) => {
    setEditingEvent(event);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setOpen(true);
  };

  const cleanPayload = (data: CreateTaskDTO | UpdateTaskDTO): CreateTaskDTO | UpdateTaskDTO => {
    const cleanData = { ...data };
    if ((cleanData as { phaseId?: string }).phaseId === '') {
      delete (cleanData as { phaseId?: string }).phaseId;
    }
    if (!cleanData.timeZone) {
      cleanData.timeZone = timeZone;
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
            formPrefill?.name ??
            createDefaults?.deadline ??
            'new'
          }
          initialData={editingEvent || undefined}
          createDefaults={
            formPrefill
              ? { formPrefill }
              : createDefaults
          }
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
