import { useGetAllPhasesQuery, useCreatePhaseMutation, useUpdatePhaseMutation, useDeletePhaseMutation } from 'api/phasesApi';
import React, { useCallback, useState } from 'react';
import PhaseForm from 'modules/phases/components/PhaseForm';
import type { PhaseDTO } from 'api/phases.api';
import './styles.scss';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import PhasesCalendar from 'modules/phases/components/PhasesCalendar';
import { showErrorToast } from 'utils/toast';

const PhasesPage: React.FC = () => {
  const { data: phases = [], isLoading, error } = useGetAllPhasesQuery();
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

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this phase?')) {
      deletePhase(id);
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
    [updatePhase],
  );

  if (isLoading) return <div className="categories-container loading">Loading...</div>;
  if (error) return <div className="categories-container">Error loading phases</div>;

  return (
    <div className="categories-page">
      <header className="page-header">
        <h1>Phases</h1>
        <div className="header-actions">
          <button onClick={handleAdd} className="primary-button">Add Phase</button>
        </div>
      </header>

      <Dialog open={showForm} onClose={() => setShowForm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingPhase ? 'Edit Phase' : 'Create New Phase'}</DialogTitle>
        <DialogContent>
          <PhaseForm
            initialData={editingPhase}
            onSubmit={handleFormSubmit}
            isSubmitting={isCreating || isUpdating}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowForm(false)} color="secondary">Cancel</Button>
        </DialogActions>
      </Dialog>
      
      {/* Phase calendar */}
      <PhasesCalendar
        phases={phases}
        onEditPhase={handleEdit}
        onPhaseTimeChange={handlePhaseTimeChange}
      />

      <div className="categories-container">
        {phases.length === 0 ? (
          <div className="empty-list">No phases found.</div>
        ) : (
          <div className="category-grid">
            {phases.map((phase: PhaseDTO) => (
              <div key={phase.id} className="category-card">
                <div className="category-header">
                  <span className="category-name" style={{ color: phase.color }}>{phase.name}</span>
                </div>
                <div className="category-description">{phase.description}</div>
                <div className="time-block-info">{phase.startTime} - {phase.endTime}</div>
                <div style={{ fontSize: 12, color: '#999' }}>Type: {phase.type}, Days: {phase.weekDays?.join(', ')}</div>
                <div className="category-actions">
                  <button className="edit-button" onClick={() => handleEdit(phase)} style={{ marginRight: 8 }}>Edit</button>
                  <button className="delete-button" onClick={() => handleDelete(phase.id)} disabled={isDeleting}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PhasesPage; 