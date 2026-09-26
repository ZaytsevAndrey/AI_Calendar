import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListFilter, Search, X } from 'lucide-react';
import type { ScheduleModeFilter, TaskStatusFilter } from '../utils/taskListFilters';
import { usePhoneLayout } from 'modules/common/hooks/useMediaQuery';
import { Modal } from '../../../ui/Modal';

type SortField = 'name' | 'priority' | 'deadline' | 'estimatedTimeInMinutes';

const STATUS_VALUES: TaskStatusFilter[] = [
  'active',
  'todo',
  'in_progress',
  'completed',
  'canceled',
  'all',
];

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
  const { t } = useTranslation();
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

  const statusLabel = (value: TaskStatusFilter) => {
    if (value === 'active') return t('tasks.status.active');
    if (value === 'todo') return t('tasks.status.todo');
    if (value === 'in_progress') return t('tasks.status.inProgress');
    if (value === 'completed') return t('tasks.status.completed');
    if (value === 'canceled') return t('tasks.status.canceled');
    return t('tasks.status.all');
  };

  const modeLabel = (value: Exclude<ScheduleModeFilter, 'any'>) => {
    if (value === 'fixed') return t('tasks.filters.fixed');
    if (value === 'flexible') return t('tasks.filters.flexible');
    return t('tasks.filters.recurring');
  };

  const sortLabel = (value: SortField) => {
    if (value === 'deadline') return t('common.deadline');
    if (value === 'priority') return t('common.priority');
    if (value === 'name') return t('common.name');
    return t('common.duration');
  };

  const phaseName =
    phaseId === 'none'
      ? t('tasks.filters.noPhase')
      : (phases ?? []).find((phase) => phase.id === phaseId)?.name ?? t('tasks.filters.phaseFallback');

  const statusOptions = (
    <>
      {STATUS_VALUES.map((value) => (
        <option key={value} value={value}>
          {statusLabel(value)}
        </option>
      ))}
    </>
  );

  const phaseOptions = (
    <>
      <option value="any">{t('tasks.filters.anyPhase')}</option>
      <option value="none">{t('tasks.filters.noPhase')}</option>
      {(phases ?? []).map((phase) => (
        <option key={phase.id} value={phase.id}>
          {phase.name}
        </option>
      ))}
    </>
  );

  const modeOptions = (
    <>
      <option value="any">{t('tasks.filters.any')}</option>
      <option value="fixed">{t('tasks.filters.fixed')}</option>
      <option value="flexible">{t('tasks.filters.flexible')}</option>
      <option value="recurring">{t('tasks.filters.recurring')}</option>
    </>
  );

  const sortOptions = (
    <>
      <option value="deadline">{t('common.deadline')}</option>
      <option value="priority">{t('common.priority')}</option>
      <option value="name">{t('common.name')}</option>
      <option value="estimatedTimeInMinutes">{t('common.duration')}</option>
    </>
  );

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
            placeholder={t('common.search')}
            aria-label={searchAriaLabel}
            className={`filter-search ${query ? 'pr-8' : ''}`}
          />
          {query ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ide-muted hover:text-ide-text"
              aria-label={t('tasks.filters.clearSearch', { section: idPrefix })}
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
          <span className="sr-only">{t('common.filters')}</span>
          {narrowed ? (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-ide-link" aria-hidden />
          ) : null}
        </button>
        </div>

        <label htmlFor={statusId} className="sr-only max-md:hidden">
          {t('common.status')}
        </label>
        <select
          id={statusId}
          value={status}
          aria-label={statusAriaLabel}
          onChange={(event) => onStatusChange(event.target.value as TaskStatusFilter)}
          className="filter-select max-md:hidden"
        >
          {statusOptions}
        </select>

        <button
          type="button"
          aria-pressed={overdueOnly}
          aria-label={overdueAriaLabel}
          onClick={() => onOverdueOnlyChange(!overdueOnly)}
          className={`filter-chip max-md:hidden ${overdueOnly ? 'border-ide-error bg-ide-error/15 text-white' : ''}`}
        >
          {t('tasks.filters.overdue')}
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
              {t('common.filters')}
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
                aria-label={t('tasks.filters.moreFilters')}
                className="absolute left-0 z-20 mt-1 w-[min(18rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-ide-border bg-ide-panel p-3 shadow-ide-md sm:left-auto sm:right-0"
              >
                {showPhase && onPhaseIdChange && phaseId !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Phase`} className="mb-1 block text-xs text-ide-muted">
                      {t('common.phase')}
                    </label>
                    <select
                      id={`${idPrefix}Phase`}
                      value={phaseId}
                      onChange={(event) => onPhaseIdChange(event.target.value)}
                      className="ui-select h-9 py-1"
                    >
                      {phaseOptions}
                    </select>
                  </div>
                ) : null}
                {showMode && onModeChange && mode !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Mode`} className="mb-1 block text-xs text-ide-muted">
                      {t('tasks.filters.scheduleType')}
                    </label>
                    <select
                      id={`${idPrefix}Mode`}
                      value={mode}
                      onChange={(event) => onModeChange(event.target.value as ScheduleModeFilter)}
                      className="ui-select h-9 py-1"
                    >
                      {modeOptions}
                    </select>
                  </div>
                ) : null}
                {showSort && onSortFieldChange && sortField !== undefined ? (
                  <div>
                    <label htmlFor={`${idPrefix}Sort`} className="mb-1 block text-xs text-ide-muted">
                      {t('tasks.filters.sortBy')}
                    </label>
                    <select
                      id={`${idPrefix}Sort`}
                      value={sortField}
                      onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                      className="ui-select h-9 py-1"
                    >
                      {sortOptions}
                    </select>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {narrowed ? (
          <button type="button" onClick={reset} className="filter-chip border-transparent bg-transparent text-ide-muted hover:text-ide-text">
            {t('common.clear')}
          </button>
        ) : null}
      </div>

      {moreCount > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {phaseActive && onPhaseIdChange ? (
            <button type="button" className="filter-chip h-7 px-2 text-xs" onClick={() => onPhaseIdChange('any')}>
              {phaseName}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t('tasks.filters.removePhase')}</span>
            </button>
          ) : null}
          {modeActive && onModeChange && activeMode ? (
            <button type="button" className="filter-chip h-7 px-2 text-xs" onClick={() => onModeChange('any')}>
              {modeLabel(activeMode)}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t('tasks.filters.removeMode')}</span>
            </button>
          ) : null}
          {sortActive && onSortFieldChange && sortField ? (
            <button
              type="button"
              className="filter-chip h-7 px-2 text-xs"
              onClick={() => onSortFieldChange('deadline')}
            >
              {t('tasks.filters.sortPrefix', { field: sortLabel(sortField) })}
              <X className="h-3 w-3" aria-hidden />
              <span className="sr-only">{t('tasks.filters.resetSort')}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {phone ? (
        <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} title={t('common.filters')}>
          <div className="space-y-3">
            <div>
              <label htmlFor={`${idPrefix}SheetStatus`} className="mb-1 block text-xs text-ide-muted">
                {t('common.status')}
              </label>
              <select
                id={`${idPrefix}SheetStatus`}
                value={status}
                aria-label={statusAriaLabel}
                onChange={(event) => onStatusChange(event.target.value as TaskStatusFilter)}
                className="ui-select w-full"
              >
                {statusOptions}
              </select>
            </div>
            <button
              type="button"
              aria-pressed={overdueOnly}
              aria-label={overdueAriaLabel}
              onClick={() => onOverdueOnlyChange(!overdueOnly)}
              className={`filter-chip ${overdueOnly ? 'border-ide-error bg-ide-error/15 text-white' : ''}`}
            >
              {t('tasks.filters.overdue')}
            </button>
            {showPhase && onPhaseIdChange && phaseId !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetPhase`} className="mb-1 block text-xs text-ide-muted">
                  {t('common.phase')}
                </label>
                <select
                  id={`${idPrefix}SheetPhase`}
                  value={phaseId}
                  onChange={(event) => onPhaseIdChange(event.target.value)}
                  className="ui-select w-full"
                >
                  {phaseOptions}
                </select>
              </div>
            ) : null}
            {showMode && onModeChange && mode !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetMode`} className="mb-1 block text-xs text-ide-muted">
                  {t('tasks.filters.scheduleType')}
                </label>
                <select
                  id={`${idPrefix}SheetMode`}
                  value={mode}
                  onChange={(event) => onModeChange(event.target.value as ScheduleModeFilter)}
                  className="ui-select w-full"
                >
                  {modeOptions}
                </select>
              </div>
            ) : null}
            {showSort && onSortFieldChange && sortField !== undefined ? (
              <div>
                <label htmlFor={`${idPrefix}SheetSort`} className="mb-1 block text-xs text-ide-muted">
                  {t('tasks.filters.sortBy')}
                </label>
                <select
                  id={`${idPrefix}SheetSort`}
                  value={sortField}
                  onChange={(event) => onSortFieldChange(event.target.value as SortField)}
                  className="ui-select w-full"
                >
                  {sortOptions}
                </select>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              {narrowed ? (
                <button type="button" className="h-8 rounded-md px-3 text-sm text-ide-muted" onClick={reset}>
                  {t('common.clear')}
                </button>
              ) : null}
              <button type="button" className="h-8 rounded-md bg-ide-accentBlue px-3 text-sm text-white" onClick={() => setSheetOpen(false)}>
                {t('common.done')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
};

export default TaskSectionFilters;
