import React, { useEffect, useId, useRef, useState } from 'react';
import { ListFilter, Search, X } from 'lucide-react';
import type { ScheduleModeFilter, TaskStatusFilter } from '../utils/taskListFilters';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { Modal } from '../../../ui/Modal';

type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

const STATUS_OPTIONS: { value: TaskStatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'all', label: 'All' },
];

const MODE_LABEL: Record<Exclude<ScheduleModeFilter, 'any'>, string> = {
  fixed: 'Fixed',
  flexible: 'Flexible',
  recurring: 'Recurring',
};

const SORT_LABEL: Record<SortField, string> = {
  deadline: 'Deadline',
  priority: 'Priority',
  name: 'Name',
  estimatedTimeInMinutes: 'Duration',
};

function specificMode(
  mode: ScheduleModeFilter | undefined,
): Exclude<ScheduleModeFilter, 'any'> | null {
  if (!mode || mode === 'any') return null;
  return mode;
}

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
  const panelId = useId();
  const moreRef = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const phone = usePhoneLayout();

  const showPhase = Boolean(onPhaseIdChange && phaseId !== undefined);
  const showMode = Boolean(onModeChange && mode !== undefined);
  const showSort = Boolean(onSortFieldChange && sortField !== undefined);
  const hasMore = showPhase || showMode || showSort;

  const phaseActive = showPhase && phaseId !== 'any';
  const activeMode = specificMode(mode);
  const modeActive = showMode && activeMode !== null;
  const sortActive = showSort && sortField !== 'deadline';
  const moreCount = [phaseActive, modeActive, sortActive].filter(Boolean).length;
  const narrowed =
    query.trim() !== '' || status !== 'active' || overdueOnly || moreCount > 0;

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  const reset = () => {
    onQueryChange('');
    onStatusChange('active');
    onOverdueOnlyChange(false);
    onPhaseIdChange?.('any');
    onModeChange?.('any');
    onSortFieldChange?.('deadline');
  };

  const phaseName =
    phaseId === 'none'
      ? 'No phase'
      : (phases ?? []).find((phase) => phase.id === phaseId)?.name ?? 'Phase';

  return (
    <div className="mb-3 space-y-2">
      <div className="filter-bar mb-0">
        <div className="flex w-full min-w-0 items-center gap-2 md:contents">
        <div className="relative min-w-0 flex-1 basis-0 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ide-muted"
            aria-hidden
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search"
            aria-label={searchAriaLabel}
            className={`filter-search ${query ? 'pr-8' : ''}`}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ide-muted hover:text-ide-text"
              aria-label={`Clear ${idPrefix} search`}
              onClick={() => onQueryChange('')}
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="ui-icon-btn relative !h-9 !w-9 shrink-0 border border-ide-border md:hidden"
          onClick={() => setSheetOpen(true)}
        >
          <ListFilter className="h-4 w-4" aria-hidden />
          <span className="sr-only">Filters</span>
          {narrowed ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ide-link" aria-hidden />
          ) : null}
        </button>
        </div>

        <label htmlFor={statusId} className="sr-only max-md:hidden">
          Status
        </label>
        <select
          id={statusId}
          value={status}
          aria-label={statusAriaLabel}
          onChange={(event) => onStatusChange(event.target.value as TaskStatusFilter)}
          className="filter-select max-md:hidden"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={overdueOnly}
          aria-label={overdueAriaLabel}
          onClick={() => onOverdueOnlyChange(!overdueOnly)}
          className={`filter-chip max-md:hidden ${overdueOnly ? 'border-ide-error bg-ide-error/15 text-white' : ''}`}
        >
          Overdue
        </button>

        {hasMore ? (
          <div className="relative max-md:hidden" ref={moreRef}>
            <button
              type="button"
              className={`filter-chip ${moreCount > 0 || moreOpen ? 'filter-chip-on' : ''}`}
              aria-expanded={moreOpen}
              aria-controls={panelId}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <ListFilter className="h-4 w-4" aria-hidden />
              Filters
              {moreCount > 0 ? (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ide-link px-1 text-xs font-semibold text-white">
                  {moreCount}
                </span>
              ) : null}
            </button>
            {moreOpen ? (
              <div
                id={panelId}
                role="dialog"
                aria-label="More filters"
                className="absolute left-0 z-20 mt-1 w-[min(18rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-ide-border bg-ide-panel p-3 shadow-ide-md sm:left-auto sm:right-0"
              >
                {showPhase && onPhaseIdChange && phaseId !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Phase`} className="mb-1 block text-xs text-ide-muted">
                      Phase
                    </label>
                    <select
                      id={`${idPrefix}Phase`}
                      value={phaseId}
                      onChange={(event) => onPhaseIdChange(event.target.value)}
                      className="ui-select h-9 py-1"
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
                {showMode && onModeChange && mode !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Mode`} className="mb-1 block text-xs text-ide-muted">
                      Schedule type
                    </label>
                    <select
                      id={`${idPrefix}Mode`}
                      value={mode}
                      onChange={(event) => onModeChange(event.target.value as ScheduleModeFilter)}
                      className="ui-select h-9 py-1"
                    >
                      <option value="any">Any</option>
                      <option value="fixed">Fixed</option>
                      <option value="flexible">Flexible</option>
                      <option value="recurring">Recurring</option>
                    </select>
                  </div>
                ) : null}
                {showSort && onSortFieldChange && sortField !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Sort`} className="mb-1 block text-xs text-ide-muted">
                      Sort by
                    </label>
                    <select
                      id={`${idPrefix}Sort`}
                      value={sortField}
                      onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                      className="ui-select h-9 py-1"
                    >
                      <option value="deadline">Deadline</option>
                      <option value="priority">Priority</option>
                      <option value="name">Name</option>
                      <option value="estimatedTimeInMinutes">Duration</option>
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {narrowed ? (
          <button type="button" onClick={reset} className="filter-chip border-transparent bg-transparent text-ide-muted hover:text-ide-text">
            Clear
          </button>
        ) : null}
      </div>

      {moreCount > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {phaseActive && onPhaseIdChange ? (
            <button type="button" className="filter-chip h-7 px-2 text-xs" onClick={() => onPhaseIdChange('any')}>
              {phaseName}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove phase filter</span>
            </button>
          ) : null}
          {modeActive && onModeChange && activeMode ? (
            <button type="button" className="filter-chip h-7 px-2 text-xs" onClick={() => onModeChange('any')}>
              {MODE_LABEL[activeMode]}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Remove schedule type filter</span>
            </button>
          ) : null}
          {sortActive && onSortFieldChange && sortField ? (
            <button
              type="button"
              className="filter-chip h-7 px-2 text-xs"
              onClick={() => onSortFieldChange('deadline')}
            >
              Sort: {SORT_LABEL[sortField]}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">Reset sort</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {phone ? (
        <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters">
          <div className="space-y-3">
            <div>
              <label htmlFor={`${idPrefix}SheetStatus`} className="mb-1 block text-xs text-ide-muted">
                Status
              </label>
              <select
                id={`${idPrefix}SheetStatus`}
                value={status}
                aria-label={statusAriaLabel}
                onChange={(event) => onStatusChange(event.target.value as TaskStatusFilter)}
                className="ui-select w-full"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              aria-pressed={overdueOnly}
              aria-label={overdueAriaLabel}
              onClick={() => onOverdueOnlyChange(!overdueOnly)}
              className={`filter-chip ${overdueOnly ? 'border-ide-error bg-ide-error/15 text-white' : ''}`}
            >
              Overdue
            </button>
            {showPhase && onPhaseIdChange && phaseId !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetPhase`} className="mb-1 block text-xs text-ide-muted">
                  Phase
                </label>
                <select
                  id={`${idPrefix}SheetPhase`}
                  value={phaseId}
                  onChange={(event) => onPhaseIdChange(event.target.value)}
                  className="ui-select w-full"
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
            {showMode && onModeChange && mode !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetMode`} className="mb-1 block text-xs text-ide-muted">
                  Schedule type
                </label>
                <select
                  id={`${idPrefix}SheetMode`}
                  value={mode}
                  onChange={(event) => onModeChange(event.target.value as ScheduleModeFilter)}
                  className="ui-select w-full"
                >
                  <option value="any">Any</option>
                  <option value="fixed">Fixed</option>
                  <option value="flexible">Flexible</option>
                  <option value="recurring">Recurring</option>
                </select>
              </div>
            ) : null}
            {showSort && onSortFieldChange && sortField !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetSort`} className="mb-1 block text-xs text-ide-muted">
                  Sort by
                </label>
                <select
                  id={`${idPrefix}SheetSort`}
                  value={sortField}
                  onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                  className="ui-select w-full"
                >
                  <option value="deadline">Deadline</option>
                  <option value="priority">Priority</option>
                  <option value="name">Name</option>
                  <option value="estimatedTimeInMinutes">Duration</option>
                </select>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              {narrowed ? (
                <button type="button" className="h-8 rounded-md px-3 text-sm text-ide-muted" onClick={reset}>
                  Clear
                </button>
              ) : null}
              <button type="button" className="h-8 rounded-md bg-ide-accentBlue px-3 text-sm text-white" onClick={() => setSheetOpen(false)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
};

export default TaskSectionFilters;
