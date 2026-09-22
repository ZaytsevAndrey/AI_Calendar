import React from 'react';
import type { ScheduleModeFilter, TaskStatusFilter } from '../utils/taskListFilters';

type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'all', label: 'All (including past)' },
];

interface TaskSectionFiltersProps {
  idPrefix: string;
  query: string;
  onQueryChange: (value: string) => void;
  status: TaskStatusFilter;
  onStatusChange: (value: TaskStatusFilter) => void;
  overdueOnly: boolean;
  onOverdueOnlyChange: (value: boolean) => void;
  /** Accessible names stay unique while both sections are on the page. */
  searchAriaLabel: string;
  statusAriaLabel?: string;
  overdueAriaLabel: string;
  phases?: { id: string; name: string }[];
  phaseId?: string;
  onPhaseIdChange?: (value: string) => void;
  mode?: ScheduleModeFilter;
  onModeChange?: (value: ScheduleModeFilter) => void;
  sortField?: SortField;
  onSortFieldChange?: (value: SortField) => void;
}

const TaskSectionFilters: React.FC<TaskSectionFiltersProps> = ({
  idPrefix,
  query,
  onQueryChange,
  status,
  onStatusChange,
  overdueOnly,
  onOverdueOnlyChange,
  searchAriaLabel,
  statusAriaLabel,
  overdueAriaLabel,
  phases,
  phaseId,
  onPhaseIdChange,
  mode,
  onModeChange,
  sortField,
  onSortFieldChange,
}) => {
  const searchId = `${idPrefix}Search`;
  const statusId = idPrefix === 'scheduled' ? 'statusFilter' : `${idPrefix}Status`;
  const overdueId = `${idPrefix}Overdue`;

  return (
    <div className="filter-bar">
      <div className="w-full sm:max-w-xs">
        <label htmlFor={searchId} className="ui-label">
          Search
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Task name"
          aria-label={searchAriaLabel}
          className="ui-input"
        />
      </div>
      <div className="w-full sm:max-w-xs">
        <label htmlFor={statusId} className="ui-label">
          Status
        </label>
        <select
          id={statusId}
          value={status}
          aria-label={statusAriaLabel}
          onChange={(event) => onStatusChange(event.target.value as TaskStatusFilter)}
          className="ui-select"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {onPhaseIdChange && phaseId !== undefined ? (
        <div className="w-full sm:max-w-xs">
          <label htmlFor={`${idPrefix}Phase`} className="ui-label">
            Phase
          </label>
          <select
            id={`${idPrefix}Phase`}
            value={phaseId}
            onChange={(event) => onPhaseIdChange(event.target.value)}
            className="ui-select"
          >
            <option value="any">Any phase</option>
            <option value="none">No phase</option>
            {(phases ?? []).map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {onModeChange && mode !== undefined ? (
        <div className="w-full sm:max-w-xs">
          <label htmlFor={`${idPrefix}Mode`} className="ui-label">
            Schedule type
          </label>
          <select
            id={`${idPrefix}Mode`}
            value={mode}
            onChange={(event) => onModeChange(event.target.value as ScheduleModeFilter)}
            className="ui-select"
          >
            <option value="any">Any</option>
            <option value="fixed">Fixed</option>
            <option value="flexible">Flexible</option>
            <option value="recurring">Recurring</option>
          </select>
        </div>
      ) : null}
      <div className="w-full sm:w-auto sm:self-end">
        <label htmlFor={overdueId} className="flex min-h-[42px] items-center gap-2 text-sm text-ide-text">
          <input
            id={overdueId}
            type="checkbox"
            checked={overdueOnly}
            aria-label={overdueAriaLabel}
            onChange={(event) => onOverdueOnlyChange(event.target.checked)}
          />
          Overdue
        </label>
      </div>
      {onSortFieldChange && sortField !== undefined ? (
        <div className="w-full sm:max-w-xs">
          <label htmlFor="sortField" className="ui-label">
            Sort by
          </label>
          <select
            id="sortField"
            value={sortField}
            onChange={(event) => onSortFieldChange(event.target.value as SortField)}
            className="ui-select"
          >
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="name">Name</option>
            <option value="estimatedTimeInMinutes">Duration</option>
          </select>
        </div>
      ) : null}
    </div>
  );
};

export default TaskSectionFilters;
