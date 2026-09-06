import { useGetAllPhasesQuery, useCreatePhaseMutation, useUpdatePhaseMutation, useDeletePhaseMutation } from 'api/phasesApi';
import React, { useCallback, useState } from 'react';
import PhaseForm from 'modules/phases/components/PhaseForm';
import type { PhaseDTO } from 'api/phases.api';
import PhasesCalendar from 'modules/phases/components/PhasesCalendar';
import { showErrorToast } from 'utils/toast';
import { Modal } from '../../ui/Modal';

const PhasesPage: React.FC = () => {
    const { data: phases = [], isLoading, error } = useGetAllPhasesQuery();
    const visiblePhases = phases.filter((phase) => phase.type !== 'main_phase' && phase.name !== 'Focus hours');
    const [createPhase, { isLoading: isCreating }] = useCreatePhaseMutation();
    const [updatePhase, { isLoading: isUpdating }] = useUpdatePhaseMutation();
    const [deletePhase, { isLoading: isDeleting }] = useDeletePhaseMutation();
    const [showForm, setShowForm] = useState(false);
    const [editingPhase, setEditingPhase] = useState<any | null>(null);

    const handleAdd = () => {
        setEditingPhase(null);
        setShowForm(true);
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
                showErrorToast('Could not update phase time.');
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
                <button type="button" onClick={handleAdd} className="ui-btn-primary w-full sm:w-auto">
                    Add Phase
                </button>
            </header>

            <Modal
                open={showForm}
                onClose={() => setShowForm(false)}
                title={editingPhase ? 'Edit Phase' : 'Create Phase'}
                maxWidthClass="max-w-lg"
            >
                <PhaseForm
                    initialData={editingPhase}
                    onSubmit={handleFormSubmit}
                    isSubmitting={isCreating || isUpdating}
                    onCancel={() => setShowForm(false)}
                    onDelete={editingPhase ? handleDeleteFromModal : undefined}
                    isDeleting={isDeleting}
                />
            </Modal>

            <div className="min-h-0 flex-1 overflow-y-auto">
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
