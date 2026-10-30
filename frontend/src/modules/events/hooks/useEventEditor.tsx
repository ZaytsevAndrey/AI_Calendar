import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useCreateEventMutation,
  useDeleteEventMutation,
  useEndSeriesFromMutation,
  useSkipOccurrenceMutation,
  useUpdateEventMutation,
} from 'api/eventTasksApi';
import { useGetAllPhasesQuery } from 'api/phasesApi';
import { useGetUserSettingsQuery } from 'api/userSettingsApi';
import { CreateTaskDTO, TaskDTO, UpdateTaskDTO } from 'api/tasks.api';
import {
  type DayReminderDTO,
  type WriteDayReminderDTO,
  useCreateDayReminderMutation,
  useDeleteDayReminderMutation,
  useUpdateDayReminderMutation,
} from 'api/dayReminders.api';
import { ReminderForm } from 'modules/day-reminders/ReminderForm';
import { localYmd } from 'utils/ianaDateTime';
import { formValuesFromCreatePayload } from 'modules/tasks/task-wizard/buildPayload';
import { resolveIanaTimeZone } from 'modules/user-settings/ianaTimeZones';
import { SeriesDeleteHost } from 'modules/schedule/components/SeriesDeleteHost';
import { askSeriesDeleteScope } from 'modules/schedule/seriesDragChoice';
import { Trash2, X } from 'lucide-react';
import { Modal } from '../../../ui/Modal';
import { Button } from 'ui/Button';
import { dialogButtonSize } from 'ui/controlSize';
import { showErrorToast } from '../../../utils/toast';
import { extractApiErrorMessage } from '../../../utils/extractApiErrorMessage';
import {
  keyAfterFailure,
  keyForSubmission,
  newRequestKey,
  type SubmissionKey,
} from '../../../utils/requestKey';
import { planEditorDelete } from '../planEditorDelete';

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

export type EditorActionsMode = 'full' | 'editOnly';

export function useEventEditor() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TaskDTO | null>(null);
  const [editingReminder, setEditingReminder] = useState<DayReminderDTO | null>(null);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [occurrence, setOccurrence] = useState<TaskOccurrenceContext | null>(null);
  const [actionsMode, setActionsMode] = useState<EditorActionsMode>('full');
  const [createDefaults, setCreateDefaults] = useState<CreateTaskDefaults | undefined>();
  const [formPrefill, setFormPrefill] = useState<ReturnType<typeof formValuesFromCreatePayload> | undefined>();
  const [afterCreate, setAfterCreate] = useState<(() => Promise<void>) | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    entireSeries: boolean;
  }>({ open: false, entireSeries: false });
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: phases = [] } = useGetAllPhasesQuery();
  const { data: userSettings } = useGetUserSettingsQuery();
  const timeZone = resolveIanaTimeZone(userSettings?.timeZone);
  const [createEvent, createState] = useCreateEventMutation();
  const [updateEvent, updateState] = useUpdateEventMutation();
  const [skipOccurrence] = useSkipOccurrenceMutation();
  const [endSeriesFrom] = useEndSeriesFromMutation();
  const [deleteEvent] = useDeleteEventMutation();
  const [createReminder, createReminderState] = useCreateDayReminderMutation();
  const [updateReminder, updateReminderState] = useUpdateDayReminderMutation();
  const [deleteReminder, deleteReminderState] = useDeleteDayReminderMutation();
  const [localSubmitting, setLocalSubmitting] = useState(false);
  const isSubmitting =
    localSubmitting ||
    createState.isLoading ||
    updateState.isLoading ||
    createReminderState.isLoading ||
    updateReminderState.isLoading;
  const isReminderDeleting = deleteReminderState.isLoading;

  // One create operation per opened form and content: a retry after an error
  // or a lost response reuses the key, so the server returns the first task.
  const createKeyRef = useRef<SubmissionKey>({ key: newRequestKey(), body: null });
  /** Key of `createFromPayload`: the same payload again is a retry (AUD-024). */
  const payloadKeyRef = useRef<SubmissionKey>({ key: newRequestKey(), body: null });
  const formDirtyRef = useRef(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const handleDirtyChange = useCallback((dirty: boolean) => {
    formDirtyRef.current = dirty;
  }, []);

  const close = () => {
    if (isSubmitting || isDeleting || isReminderDeleting) return;
    formDirtyRef.current = false;
    setDiscardOpen(false);
    setOpen(false);
    setEditingEvent(null);
    setEditingReminder(null);
    setCreatingReminder(false);
    setOccurrence(null);
    setActionsMode('full');
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setDeleteConfirm({ open: false, entireSeries: false });
  };

  const openCreate = (defaults?: CreateTaskDefaults) => {
    createKeyRef.current = { key: newRequestKey(), body: null };
    setEditingEvent(null);
    setEditingReminder(null);
    setCreatingReminder(false);
    setOccurrence(null);
    setActionsMode('full');
    setCreateDefaults(defaults);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setOpen(true);
  };

  const openEditReminder = (reminder: DayReminderDTO) => {
    setEditingEvent(null);
    setCreatingReminder(false);
    setEditingReminder(reminder);
    setOccurrence(null);
    setActionsMode('full');
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setOpen(true);
  };

  const openCreateFromPrefill = (
    payload: CreateTaskDTO,
    options?: { afterCreate?: () => Promise<void> },
  ) => {
    createKeyRef.current = { key: newRequestKey(), body: null };
    setEditingEvent(null);
    setEditingReminder(null);
    setCreatingReminder(false);
    setOccurrence(null);
    setActionsMode('full');
    setCreateDefaults(undefined);
    setFormPrefill(formValuesFromCreatePayload(payload, timeZone));
    setAfterCreate(() => options?.afterCreate ?? null);
    setOpen(true);
  };

  const openEdit = (
    event: TaskDTO,
    nextOccurrence?: TaskOccurrenceContext,
    options?: { actionsMode?: EditorActionsMode },
  ) => {
    setEditingEvent(event);
    setOccurrence(nextOccurrence ?? null);
    setActionsMode(options?.actionsMode ?? 'full');
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
    setOpen(true);
  };

  const openSchedule = (event: TaskDTO) => {
    setEditingEvent(event);
    setOccurrence(null);
    setActionsMode('full');
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
    if (isSubmitting || isDeleting) return;
    const cleanData = cleanPayload(data);
    const editing = editingEvent;
    const onCreated = afterCreate;
    setLocalSubmitting(true);
    const request = editing
      ? updateEvent({ id: editing.id, body: cleanData as UpdateTaskDTO }).unwrap()
      : createEvent({
          ...(cleanData as CreateTaskDTO),
          idempotencyKey: (createKeyRef.current = keyForSubmission(createKeyRef.current, cleanData)).key,
        }).unwrap();
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
        setActionsMode('full');
        setCreateDefaults(undefined);
        setFormPrefill(undefined);
        setAfterCreate(null);
      })
      .catch((err) => {
        setLocalSubmitting(false);
        if (!editing) createKeyRef.current = keyAfterFailure(createKeyRef.current, err);
        showErrorToast({
          title: editing ? t('tasks.toast.updateFailed') : t('tasks.toast.createFailed'),
          detail: extractApiErrorMessage(err),
        });
      });
  };

  const createFromPayload = async (data: CreateTaskDTO) => {
    const cleanData = cleanPayload(data) as CreateTaskDTO;
    // AUD-024: a retry of the same payload keeps its key (one task, not two);
    // after a success the next payload is a new operation.
    payloadKeyRef.current = keyForSubmission(payloadKeyRef.current, cleanData);
    try {
      // Progress toast from eventTasksApi.onQueryStarted.
      await createEvent({ ...cleanData, idempotencyKey: payloadKeyRef.current.key }).unwrap();
      payloadKeyRef.current = { key: newRequestKey(), body: null };
    } catch (err) {
      payloadKeyRef.current = keyAfterFailure(payloadKeyRef.current, err);
      throw err;
    }
  };

  const canSkipOccurrence = ((): boolean => {
    if (!editingEvent || !occurrence?.startIso) return false;
    if (editingEvent.isFixedExternal || editingEvent.isUnscheduled) return false;
    if (editingEvent.eventType === 'fixed' && !editingEvent.isRecurring) return false;
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

  const runDeleteTask = async (task: TaskDTO) => {
    setIsDeleting(true);
    try {
      await deleteEvent(task.id).unwrap();
      setOpen(false);
      setEditingEvent(null);
      setOccurrence(null);
      setActionsMode('full');
      setCreateDefaults(undefined);
      setFormPrefill(undefined);
      setAfterCreate(null);
      setDeleteConfirm({ open: false, entireSeries: false });
    } catch (err) {
      showErrorToast({
        title: t('tasks.deleteFailed'),
        detail: extractApiErrorMessage(err),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteFromEditor = () => {
    const task = editingEvent;
    if (!task || isSubmitting || isDeleting) return;
    const plan = planEditorDelete(task, occurrence);
    if (plan.kind === 'ask_series_scope') {
      void (async () => {
        const scope = await askSeriesDeleteScope(task.name);
        if (!scope) return;
        const slot = occurrence;
        if (!slot?.startIso && scope !== 'all') {
          showErrorToast({ title: t('tasks.deleteFailed') });
          return;
        }
        setIsDeleting(true);
        try {
          if (scope === 'occurrence') {
            await skipOccurrence({
              id: task.id,
              body: {
                occurrenceStart: slot!.startIso,
                googleEventId: slot!.googleEventId,
                googleEventCalendarId: slot!.calendarId,
              },
            }).unwrap();
          } else if (scope === 'series') {
            await endSeriesFrom({
              id: task.id,
              body: {
                occurrenceStart: slot!.startIso,
                googleEventId: slot!.googleEventId,
                googleEventCalendarId: slot!.calendarId,
              },
            }).unwrap();
          } else {
            await deleteEvent(task.id).unwrap();
          }
          setOpen(false);
          setEditingEvent(null);
          setOccurrence(null);
          setActionsMode('full');
          setCreateDefaults(undefined);
          setFormPrefill(undefined);
          setAfterCreate(null);
        } catch (err) {
          showErrorToast({
            title: t('tasks.deleteFailed'),
            detail: extractApiErrorMessage(err),
          });
        } finally {
          setIsDeleting(false);
        }
      })();
      return;
    }
    setDeleteConfirm({
      open: true,
      entireSeries: plan.kind === 'confirm_entire_series',
    });
  };

  const confirmDeleteFromEditor = () => {
    const task = editingEvent;
    if (!task) return;
    void runDeleteTask(task);
  };

  const taskFormDefaults = useMemo(
    () => (formPrefill ? { formPrefill } : createDefaults),
    [formPrefill, createDefaults],
  );

  const finishReminder = () => {
    setOpen(false);
    setEditingEvent(null);
    setEditingReminder(null);
    setCreatingReminder(false);
    setOccurrence(null);
    setCreateDefaults(undefined);
    setFormPrefill(undefined);
    setAfterCreate(null);
  };

  const submitReminder = async (body: WriteDayReminderDTO) => {
    try {
      if (editingReminder) {
        await updateReminder({ id: editingReminder.id, body }).unwrap();
      } else {
        await createReminder(body).unwrap();
      }
      finishReminder();
    } catch (err) {
      showErrorToast({
        title: t('dayReminders.saveFailed'),
        detail: extractApiErrorMessage(err),
      });
    }
  };

  const deleteReminderFromEditor = async () => {
    if (!editingReminder) return;
    try {
      await deleteReminder(editingReminder.id).unwrap();
      finishReminder();
    } catch (err) {
      showErrorToast({
        title: t('dayReminders.deleteFailed'),
        detail: extractApiErrorMessage(err),
      });
    }
  };

  const reminderDueYmd = createDefaults?.earliestStartTime
    ? localYmd(createDefaults.earliestStartTime, timeZone)
    : undefined;
  const showingReminder = creatingReminder || !!editingReminder;

  /** Backdrop and Cancel ask first when the task form holds unsaved input. */
  const requestClose = () => {
    if (isSubmitting || isDeleting || isReminderDeleting) return;
    if (!showingReminder && formDirtyRef.current) {
      setDiscardOpen(true);
      return;
    }
    close();
  };

  const editorTitle = showingReminder
    ? editingReminder
      ? t('dayReminders.edit')
      : t('dayReminders.createTitle')
    : editingEvent
    ? createDefaults?.scheduleIntent
      ? t('tasks.editor.schedule')
      : t('tasks.editor.edit')
    : createDefaults?.unscheduled
      ? t('tasks.editor.createUnscheduled')
      : t('tasks.editor.create');

  const editorModal = (
    <>
      <Modal
        open={open}
        onClose={requestClose}
        title={editorTitle}
        maxWidthClass="max-w-xl"
        footer={null}
      >
        <Suspense fallback={<div className="px-1 py-6 text-sm text-ide-muted">{t('common.loading')}</div>}>
          {showingReminder ? (
            <ReminderForm
              initial={editingReminder ?? undefined}
              suggestedDueYmd={reminderDueYmd}
              onSubmit={(body) => void submitReminder(body)}
              onCancel={close}
              onDelete={editingReminder ? () => void deleteReminderFromEditor() : undefined}
              onPickTaskPreset={
                editingReminder
                  ? undefined
                  : () => {
                      setCreatingReminder(false);
                    }
              }
              isSubmitting={isSubmitting}
              isDeleting={isReminderDeleting}
            />
          ) : (
          <TaskForm
            key={
              editingEvent
                ? `${editingEvent.id}-${createDefaults?.scheduleIntent ? 'schedule' : 'edit'}`
                : formPrefill
                  ? `prefill-${formPrefill.scheduledStartTime ?? ''}-${formPrefill.scheduledEndTime ?? ''}-${formPrefill.name}`
                  : `${createDefaults?.deadline ?? 'new'}-${createDefaults?.unscheduled ? 'unscheduled' : 'task'}`
            }
            initialData={editingEvent || undefined}
            createDefaults={taskFormDefaults}
            phases={phases}
            onSubmit={submit}
            isSubmitting={isSubmitting}
            onCancel={requestClose}
            onDirtyChange={handleDirtyChange}
            onSkipOccurrence={
              actionsMode === 'full' && canSkipOccurrence
                ? handleSkipOccurrence
                : undefined
            }
            onDelete={
              actionsMode === 'full' && editingEvent
                ? handleDeleteFromEditor
                : undefined
            }
            isDeleting={isDeleting}
            mode={editingEvent ? 'edit' : 'create'}
            onPickReminder={editingEvent ? undefined : () => setCreatingReminder(true)}
          />
          )}
        </Suspense>
      </Modal>
      <Modal
        open={deleteConfirm.open}
        onClose={() => setDeleteConfirm({ open: false, entireSeries: false })}
        title={
          deleteConfirm.entireSeries
            ? t('calendar.seriesDeleteTitle')
            : t('tasks.deleteTitle')
        }
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size={dialogButtonSize}
              onClick={() => setDeleteConfirm({ open: false, entireSeries: false })}
              className="w-full sm:w-auto"
              disabled={isDeleting}
              icon={X}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size={dialogButtonSize}
              onClick={confirmDeleteFromEditor}
              className="w-full sm:w-auto"
              disabled={isDeleting}
              icon={Trash2}
            >
              {isDeleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-ide-text">
          {deleteConfirm.entireSeries
            ? t('tasks.deleteEntireSeriesConfirm', {
                name: editingEvent?.name ?? t('tasks.thisTask'),
              })
            : t('tasks.deleteConfirm', {
                name: editingEvent?.name ?? t('tasks.thisTask'),
              })}
        </p>
      </Modal>
      <Modal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title={t('tasks.form.discardTitle')}
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              size={dialogButtonSize}
              onClick={() => setDiscardOpen(false)}
              className="w-full sm:w-auto"
            >
              {t('tasks.form.keepEditing')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size={dialogButtonSize}
              onClick={close}
              className="w-full sm:w-auto"
              icon={X}
            >
              {t('tasks.form.discard')}
            </Button>
          </>
        }
      >
        <p className="text-ide-text">{t('tasks.form.discardBody')}</p>
      </Modal>
      <SeriesDeleteHost />
    </>
  );

  return {
    openCreate,
    openCreateFromPrefill,
    openEdit,
    openEditReminder,
    openSchedule,
    createFromPayload,
    editorModal,
  };
}
