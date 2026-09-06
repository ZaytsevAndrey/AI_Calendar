import React, { useState } from 'react';
import {
  useCreateEventMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import EventForm from 'modules/events/components/EventForm';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

export function useEventEditor() {
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const { data: phases = [] } = useGetAllPhasesQuery();
  const [createEvent, createEventState] = useCreateEventMutation();
  const [updateEvent, updateEventState] = useUpdateEventMutation();

  const close = () => {
    setOpen(false);
    setEditingEvent(null);
  };

  const openCreate = () => {
    setEditingEvent(null);
    setOpen(true);
  };

  const openEdit = (event: TaskDTO) => {
    setEditingEvent(event);
    setOpen(true);
  };

  const submit = async (data: CreateTaskDTO | UpdateTaskDTO) => {
    const cleanData = { ...data };
    if ((cleanData as { phaseId?: string }).phaseId === '') {
      delete (cleanData as { phaseId?: string }).phaseId;
    }
    try {
      if (editingEvent) {
        await updateEvent({ id: editingEvent.id, body: cleanData as UpdateTaskDTO }).unwrap();
        showSuccessToast('Event updated.');
      } else {
        await createEvent(cleanData as CreateTaskDTO).unwrap();
        showSuccessToast('Event created.');
      }
      close();
    } catch (err) {
      showErrorToast(extractApiErrorMessage(err));
    }
  };

  const isSaving = createEventState.isLoading || updateEventState.isLoading;

  const editorModal = (
    <Modal
      open={open}
      onClose={close}
      title={editingEvent ? 'Edit event' : 'Create event'}
      maxWidthClass="max-w-xl"
      footer={null}
    >
      <div className="p-4 pt-0 sm:p-6 sm:pt-0">
        <EventForm
          key={editingEvent?.id ?? 'new'}
          initialData={editingEvent || undefined}
          phases={phases}
          onSubmit={submit}
          isSubmitting={isSaving}
          onCancel={close}
          mode={editingEvent ? 'edit' : 'create'}
        />
      </div>
    </Modal>
  );

  return { openCreate, openEdit, editorModal };
}
