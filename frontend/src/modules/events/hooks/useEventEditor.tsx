import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { showErrorToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';

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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [occurrence, setOccurrence] = useState<TaskOccurrenceContext | null>(null);
  const [createDefaults, setCreateDefaults] = useState<CreateTaskDefaults | undefined>();
  const [formPrefill, setFormPrefill] = useState<ReturnType<typeof formValuesFromCreatePayload> | undefined>();
  const [afterCreate, setAfterCreate] = useState<(() => Promise<void>) | null>(null);
  const { data: phases = [] } = useGetAllPhasesQuery();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [createEvent, createState] = useCreateEventMutation();
  const [updateEvent, updateState] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const isSubmitting =
    localSubmitting || createState.isLoading || updateState.isLoading;

  const close = () => {
    if (isSubmitting) return;
    setOpen(false);
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
  };

  const openCreate = (defaults?: CreateTaskDefaults) => {
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(defaults);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setOpen(true);
  };

  const openCreateFromPrefill = (
    payload: CreateTaskDTO,
    options?: { afterCreate?: () => Promise<void> },
  ) => {
    setEditingEvent(null);
    setOccurrence(null);
    setCreateDefaults(undefined);
    setFormPrefill(formValuesFromCreatePayload(payload, timeZone));
    setAfterCreate(() => options?.afterCreate ?? null);
    setOpen(true);
  };

  const openEdit = (event: TaskDTO, nextOccurrence?: TaskOccurrenceContext) => {
    setEditingEvent(event);
    setOccurrence(nextOccurrence ?? null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setOpen(true);
  };

  const openSchedule = (event: TaskDTO) => {
    setEditingEvent(event);
    setOccurrence(null);
    setCreateDefaults({ scheduleIntent: true });
    setFormPrefill(undefined);
    setAfterCreate(null);
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
    if (isSubmitting) return;
    const cleanData = cleanPayload(data);
    const editing = editingEvent;
    const onCreated = afterCreate;
    setLocalSubmitting(true);
    const request = editing
      ? updateEvent({ id: editing.id, body: cleanData as UpdateTaskDTO }).unwrap()
      : createEvent(cleanData as CreateTaskDTO).unwrap();
    void request
      .then(async () => {
        // Progress toast (save → place → sync) comes from eventTasksApi.onQueryStarted.
        if (!editing && onCreated) {
          await onCreated();
        }
        setLocalSubmitting(false);
        setOpen(false);
        setEditingEvent(null);
        setOccurrence(null);
        setCreateDefaults(undefined);
        setFormPrefill(undefined);
        setAfterCreate(null);
      })
      .catch((err) => {
        setLocalSubmitting(false);
        showErrorToast({
          title: editing ? t('tasks.toast.updateFailed') : t('tasks.toast.createFailed'),
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const createFromPayload = async (data: CreateTaskDTO) => {
    const cleanData = cleanPayload(data) as CreateTaskDTO;
    // Progress toast from eventTasksApi.onQueryStarted.
    await createEvent(cleanData).unwrap();
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
      .catch((err) => {
        showErrorToast({
          title: t('tasks.toast.skipFailed'),
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const editorTitle = editingEvent
    ? createDefaults?.scheduleIntent
      ? t('tasks.editor.schedule')
      : t('tasks.editor.edit')
    : createDefaults?.unscheduled
      ? t('tasks.editor.createUnscheduled')
      : t('tasks.editor.create');

  const editorModal = (
    <Modal
      open={open}
      onClose={close}
      title={editorTitle}
      maxWidthClass="max-w-xl"
      footer={null}
    >
      <Suspense fallback={<div className="px-1 py-6 text-sm text-ide-muted">{t('common.loading')}</div>}>
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
          isSubmitting={isSubmitting}
          onCancel={close}
          onSkipOccurrence={canSkipOccurrence ? handleSkipOccurrence : undefined}
          mode={editingEvent ? 'edit' : 'create'}
        />
      </Suspense>
    </Modal>
  );

  return { openCreate, openCreateFromPrefill, openEdit, openSchedule, createFromPayload, editorModal };
}
