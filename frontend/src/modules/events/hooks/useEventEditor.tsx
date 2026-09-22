import { lazy, Suspense, useState } from 'react';
import {
  useCreateEventMutation,
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import { formValuesFromCreatePayload } from 'modules/tasks/task-wizard/buildPayload';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { Modal } from '../../../ui/Modal';
import { showErrorToast, showSuccessToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import { describeTaskToastDetail } from '../../../utils/formatDate';

const TaskForm = lazy(
  () => import(/* webpackChunkName: "task-form" */ 'modules/tasks/components/TaskForm'),
);

export type TaskOccurrenceContext = {
  startIso: string;
  endIso?: string;
  googleEventId?: string;
  calendarId?: string;
};

export type CreateTaskDefaults = {
  deadline?: string;
  earliestStartTime?: string;
  unscheduled?: boolean;
  scheduleIntent?: boolean;
};

export function useEventEditor() {
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [occurrence, setOccurrence] = useState<TaskOccurrenceContext | null>(null);
  const [createDefaults, setCreateDefaults] = useState<CreateTaskDefaults | undefined>();
  const [formPrefill, setFormPrefill] = useState<ReturnType<typeof formValuesFromCreatePayload> | undefined>();
  const { data: phases = [] } = useGetAllPhasesQuery();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [createEvent] = useCreateEventMutation();
  const [updateEvent] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();

  const close = () => {
    setOpen(false);
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
  };

  const openCreate = (defaults?: CreateTaskDefaults) => {
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(defaults);
    setFormPrefill(undefined);
    setOpen(true);
  };

  const openCreateFromPrefill = (payload: CreateTaskDTO) => {
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(undefined);
    setFormPrefill(formValuesFromCreatePayload(payload, timeZone));
    setOpen(true);
  };

  const openEdit = (event: TaskDTO, nextOccurrence?: TaskOccurrenceContext) => {
    setEditingEvent(event);
    setOccurrence(nextOccurrence ?? null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setOpen(true);
  };

  const openSchedule = (event: TaskDTO) => {
    setEditingEvent(event);
    setOccurrence(null);
    setCreateDefaults({ scheduleIntent: true });
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

  const canSkipOccurrence = ((): boolean => {
    if (!editingEvent || !occurrence?.startIso) return false;
    if (editingEvent.isFixedExternal || editingEvent.isUnscheduled) return false;
    if (editingEvent.eventType === 'fixed') return false;
    if (editingEvent.status === 'completed' || editingEvent.status === 'canceled') {
      return false;
    }
    if (occurrence.endIso && new Date(occurrence.endIso).getTime() <= Date.now()) {
      return false;
    }
    return true;
  })();

  const handleSkipOccurrence = () => {
    const task = editingEvent;
    const slot = occurrence;
    if (!task || !slot) return;
    close();
    void skipOccurrence({
      id: task.id,
      body: {
        occurrenceStart: slot.startIso,
        googleEventId: slot.googleEventId,
        googleEventCalendarId: slot.calendarId,
      },
    })
      .unwrap()
      .then(() => {
        showSuccessToast({ title: 'Occurrence skipped', detail: task.name });
      })
      .catch((err) => {
        showErrorToast({
          title: 'Could not skip occurrence',
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const editorModal = (
    <Modal
      open={open}
      onClose={close}
      title={
        editingEvent
          ? createDefaults?.scheduleIntent
            ? 'Schedule task'
            : 'Edit task'
          : createDefaults?.unscheduled
            ? 'Create unscheduled task'
            : 'Create task'
      }
      maxWidthClass="max-w-xl"
      footer={null}
    >
      <Suspense fallback={<div className="px-1 py-6 text-sm text-ide-muted">Loading…</div>}>
        <TaskForm
          key={
            editingEvent
              ? `${editingEvent.id}-${createDefaults?.scheduleIntent ? 'schedule' : 'edit'}`
              : formPrefill?.name ??
                `${createDefaults?.deadline ?? 'new'}-${createDefaults?.unscheduled ? 'unscheduled' : 'task'}`
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
          onSkipOccurrence={canSkipOccurrence ? handleSkipOccurrence : undefined}
          mode={editingEvent ? 'edit' : 'create'}
        />
      </Suspense>
    </Modal>
  );

  return { openCreate, openCreateFromPrefill, openEdit, openSchedule, createFromPayload, editorModal };
}
