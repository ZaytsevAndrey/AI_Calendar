import { useGetAllPhasesQuery, useCreatePhaseMutation, useUpdatePhaseMutation, useDeletePhaseMutation, useApplyPhasePresetMutation } from 'api/phasesApi';
import type { PhasePresetId } from 'api/phasesApi';
import React, { lazy, Suspense, useCallback, useState } from 'react';
import type { PhaseDTO } from 'api/phases.api';
import PhasesCalendar from 'modules/phases/components/PhasesCalendar';
import { PhasePresetPicker, messageFromApiError } from 'modules/phases/components/PhasePresetPicker';
import { WeekDaysSelector } from 'modules/phases/components/WeekDaysSelector';
import { showErrorToast } from 'utils/toast';
import { Modal } from '../../ui/Modal';

function weekDaysForPreset(phases: PhaseDTO[]): number[] {
    const named = phases.filter((phase) => phase.type !== 'sleep_time' && phase.type !== 'main_phase');
    if (named.length === 0) return [1, 2, 3, 4, 5];
    if (named.some((phase) => !phase.weekDays?.length)) return [0, 1, 2, 3, 4, 5, 6];
    const days = new Set<number>();
    named.forEach((phase) => phase.weekDays?.forEach((day) => days.add(day)));
    return [...days].sort((a, b) => a - b);
}

const PhaseForm = lazy(
    () => import(/* webpackChunkName: "phase-form" */ 'modules/phases/components/PhaseForm'),
);

const PhasesPage: React.FC = () => {
    const { data: phases = [], isLoading, error } = useGetAllPhasesQuery();
    const visiblePhases = phases.filter((phase) => phase.type !== 'main_phase' && phase.name !== 'Focus hours');
    const [createPhase, { isLoading: isCreating }] = useCreatePhaseMutation();
    const [updatePhase, { isLoading: isUpdating }] = useUpdatePhaseMutation();
    const [deletePhase, { isLoading: isDeleting }] = useDeletePhaseMutation();
    const [applyPreset, { isLoading: isApplyingPreset }] = useApplyPhasePresetMutation();
    const [showForm, setShowForm] = useState(false);
    const [editingPhase, setEditingPhase] = useState<any | null>(null);
    const [showPreset, setShowPreset] = useState(false);
    const [presetId, setPresetId] = useState<PhasePresetId>('working');
    const [presetDays, setPresetDays] = useState<number[]>([1, 2, 3, 4, 5]);

    const handleAdd = () => {
        setEditingPhase(null);
        setShowForm(true);
    };

    const openPreset = () => {
        setPresetId('working');
        setPresetDays(weekDaysForPreset(visiblePhases));
        setShowPreset(true);
    };

    const handleApplyPreset = async () => {
        if (presetDays.length === 0) {
            showErrorToast({
                title: 'Select weekdays',
                detail: 'Choose at least one day of the week for the preset.',
            });
            return;
        }
        try {
            await applyPreset({ presetId, weekDays: presetDays }).unwrap();
            setShowPreset(false);
        } catch (err: unknown) {
            showErrorToast({
                title: 'Could not apply preset',
                detail:
                    messageFromApiError(err) ??
                    'Phases were not replaced. If a phase still has tasks, move or delete them first.',
            });
        }
    };

    const handleEdit = (phase: any) => {
        setEditingPhase(phase);
        setShowForm(true);
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Delete this phase?')) {
            await deletePhase(id);
        }
    };

    const handleFormSubmit = async (data: any) => {
        if (editingPhase) {
            await updatePhase({ id: editingPhase.id, phase: data });
        } else {
            await createPhase(data);
        }
        setShowForm(false);
        setEditingPhase(null);
    };

    const handlePhaseTimeChange = useCallback(
        async (phaseId: string, startTime: string, endTime: string) => {
            try {
                await updatePhase({ id: phaseId, phase: { startTime, endTime } }).unwrap();
            } catch {
                showErrorToast({
                    title: 'Could not update phase',
                    detail: 'The new time was not saved. Try again.',
                });
                throw new Error('phase-update-failed');
            }
        },
        [updatePhase]
    );

    const handleDeleteFromModal = async () => {
        if (!editingPhase?.id) {
            return;
        }

        await handleDelete(editingPhase.id);
        setShowForm(false);
        setEditingPhase(null);
    };

    if (isLoading) {
        return (
            <div className="page-shell-fill">
                <div className="loading">Loading phases…</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="page-shell-fill">
                <div className="rounded-xl border border-ide-error bg-ide-error/10 px-4 py-6 text-center text-ide-error">
                    Error loading phases
                </div>
            </div>
        );
    }

    return (
        <div className="page-shell-fill">
            <header className="page-head shrink-0">
                <div>
                    <h1 className="page-title">Phases</h1>
                    <p className="page-lead">Time windows for scheduling and the weekly template.</p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <button type="button" onClick={openPreset} className="ui-btn-secondary w-full sm:w-auto">
                        Use a preset
                    </button>
                    <button type="button" onClick={handleAdd} className="ui-btn-primary w-full sm:w-auto">
                        Add Phase
                    </button>
                </div>
            </header>

            <Modal
                open={showForm}
                onClose={() => setShowForm(false)}
                title={editingPhase ? 'Edit Phase' : 'Create Phase'}
                maxWidthClass="max-w-lg"
            >
                <Suspense
                    fallback={<div className="px-1 py-6 text-sm text-ide-muted">Loading…</div>}
                >
                    <PhaseForm
                        initialData={editingPhase}
                        onSubmit={handleFormSubmit}
                        isSubmitting={isCreating || isUpdating}
                        onCancel={() => setShowForm(false)}
                        onDelete={editingPhase ? handleDeleteFromModal : undefined}
                        isDeleting={isDeleting}
                    />
                </Suspense>
            </Modal>

            <Modal
                open={showPreset}
                onClose={() => setShowPreset(false)}
                title="Use a phase preset"
                maxWidthClass="max-w-lg"
            >
                <p className="mb-4 text-sm text-ide-muted">
                    Replaces Sleep and every other phase. Times follow your wake and sleep settings.
                    This is blocked while any phase still has tasks.
                </p>
                <PhasePresetPicker
                    value={presetId}
                    onChange={(choice) => {
                        if (choice !== 'defaults') setPresetId(choice);
                    }}
                    disabled={isApplyingPreset}
                />
                <div className="mt-4">
                    <WeekDaysSelector
                        selectedDays={presetDays}
                        setSelectedDays={setPresetDays}
                        errors={
                            presetDays.length === 0
                                ? { weekDays: { message: 'Select at least one day' } }
                                : {}
                        }
                    />
                </div>
                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        className="ui-btn-secondary w-full sm:w-auto"
                        onClick={() => setShowPreset(false)}
                        disabled={isApplyingPreset}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="ui-btn-primary w-full sm:w-auto"
                        onClick={handleApplyPreset}
                        disabled={isApplyingPreset || presetDays.length === 0}
                    >
                        Replace phases
                    </button>
                </div>
            </Modal>

            <div className="page-scroll">
                <div className="mb-8 overflow-x-auto">
                    <PhasesCalendar
                        phases={visiblePhases}
                        onEditPhase={handleEdit}
                        onPhaseTimeChange={handlePhaseTimeChange}
                    />
                </div>

                {visiblePhases.length === 0 ? (
                    <div className="empty-list">No phases yet. Add one to get started.</div>
                ) : (
                    <div className="phase-grid">
                        {visiblePhases.map((phase: PhaseDTO) => (
                            <article key={phase.id} className="phase-card">
                                <div className="category-header">
                                    <span className="category-name" style={{ color: phase.color }}>
                                        {phase.name}
                                    </span>
                                </div>
                                <p className="category-description">{phase.description}</p>
                                <div className="time-block-info">
                                    {phase.startTime} – {phase.endTime}
                                </div>
                                <p className="text-xs text-ide-muted">
                                    Type: {phase.type} · Days: {phase.weekDays?.join(', ')}
                                </p>
                                <div className="category-actions">
                                    <button
                                        type="button"
                                        className="edit-button"
                                        onClick={() => handleEdit(phase)}
                                    >
                                        Edit
                                    </button>
                                    <button
                                        type="button"
                                        className="delete-button"
                                        onClick={() => handleDelete(phase.id)}
                                        disabled={isDeleting}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </article>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default PhasesPage;
