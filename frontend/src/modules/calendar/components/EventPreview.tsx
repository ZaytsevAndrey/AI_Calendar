import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Pencil, Trash2, Undo2 } from 'lucide-react';
import type { GoogleCalendarEvent } from 'api/google-calendar.api';
import type { TaskDTO } from 'api/tasks.api';
import type { SeriesDragScope } from 'modules/schedule/seriesDragChoice';
import { Modal } from 'ui/Modal';
import { Button } from 'ui/Button';
import { formatCivilYmd, formatDateTime, formatDateTimeRange } from 'utils/formatDate';
import { eventEndDate, eventStartDate } from '../calendarView';
import { getEventColor, googleColorCss } from '../hooks/eventAppearance';
import { formatMinutes } from 'utils/formatDate';
import { KindIcon } from '../kindIcons';
import type { SchedulingKind } from '../schedulingKind';
import { ProviderLogo } from './ProviderLogo';
import {
  buildEventPreviewFacts,
  descriptionSources,
  type PreviewFact,
  type PreviewLink,
} from '../eventPreviewFacts';
import { isHttpUrl, linkify, sanitizeEventHtml } from '../eventPreviewText';
import {
  canCompleteFromPreview,
  canUndoDoneFromPreview,
  planEventPreviewDelete,
  planEventPreviewEdit,
} from '../planEventPreviewActions';
import { SeriesScopeMenu } from './SeriesScopeMenu';

type Props = {
  open: boolean;
  event: GoogleCalendarEvent | null;
  task: TaskDTO | null;
  /** Calendar list name when the event only has an id. */
  calendarName?: string | null;
  onClose: () => void;
  onEdit: (scope?: SeriesDragScope) => void;
  onDelete: (scope?: SeriesDragScope) => void;
  /** Mark the linked app task completed (non-recurring / non-external). */
  onDone?: () => void;
  /** «Не виконано» on a completed one-off or day copy. */
  onUndoDone?: () => void;
  busy?: boolean;
};

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

const VALUE_TONE: Record<string, Tone> = {
  confirmed: 'good',
  completed: 'good',
  resolved: 'good',
  free: 'good',
  yes: 'good',
  accepted: 'good',
  tentative: 'warn',
  in_progress: 'warn',
  medium: 'warn',
  workingElsewhere: 'warn',
  personal: 'warn',
  cancelled: 'bad',
  canceled: 'bad',
  declined: 'bad',
  high: 'bad',
  urgent: 'bad',
  problematic: 'bad',
  oof: 'bad',
  confidential: 'bad',
  outOfOffice: 'bad',
  private: 'info',
  busy: 'info',
  focusTime: 'info',
  fixed: 'info',
  low: 'neutral',
  flexible: 'neutral',
  recurring: 'neutral',
  unscheduled: 'neutral',
  todo: 'neutral',
  workingLocation: 'neutral',
  birthday: 'neutral',
  fromGmail: 'neutral',
};

const CHIP_IDS = new Set([
  'status',
  'showAs',
  'kind',
  'type',
  'taskStatus',
  'priority',
  'importance',
  'scheduleState',
]);

const SECTIONS: { id: string; title: string; ids: string[] }[] = [
  { id: 'links', title: 'sectionLinks', ids: ['join', 'phone', 'open', 'source', 'attachments'] },
  { id: 'place', title: 'sectionPlace', ids: ['location', 'kindDetail'] },
  {
    id: 'when',
    title: 'sectionWhen',
    ids: ['recurrence', 'repeatDays', 'occurrenceOf', 'reminders', 'duration', 'deadline', 'windowFrom', 'eligibleDays', 'timeZone', 'originalTime', 'completedAt'],
  },
  { id: 'people', title: 'sectionPeople', ids: ['organizer', 'attendees'] },
  {
    id: 'task',
    title: 'sectionTask',
    ids: ['phase', 'allowSplit', 'fixedExternal', 'skippedDays', 'color', 'sensitivity', 'categories', 'comment', 'applePriority', 'problematicReason', 'problematicDay', 'problematicDays'],
  },
  { id: 'more', title: 'sectionMore', ids: ['created', 'updated'] },
];

function toneClass(tone: Tone): string {
  switch (tone) {
    case 'good':
      return 'border-ide-accent/50 bg-ide-accent/15 text-ide-accent';
    case 'warn':
      return 'border-ide-warn/60 bg-ide-warn/15 text-ide-warn';
    case 'bad':
      return 'border-ide-error/50 bg-ide-error/15 text-ide-error';
    case 'info':
      return 'border-ide-accentBlue/50 bg-ide-accentBlue/20 text-ide-link';
    default:
      return 'border-ide-border bg-ide-surface text-ide-text';
  }
}

function ExternalAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  const http = isHttpUrl(href) || href.toLowerCase().startsWith('mailto:');
  if (!http && !href.toLowerCase().startsWith('tel:')) {
    return <span>{children}</span>;
  }
  return (
    <a
      href={href}
      target={isHttpUrl(href) ? '_blank' : undefined}
      rel={isHttpUrl(href) ? 'noopener noreferrer' : undefined}
      className="break-all text-ide-link underline underline-offset-2"
    >
      {children}
    </a>
  );
}

function LinkedText({ value }: { value: string }) {
  return (
    <>
      {linkify(value).map((segment, index) =>
        segment.type === 'link' ? (
          <ExternalAnchor key={`${segment.url}-${index}`} href={segment.url}>
            {segment.url}
          </ExternalAnchor>
        ) : (
          <span key={index}>{segment.value}</span>
        ),
      )}
    </>
  );
}

export function EventPreview({
  open,
  event,
  task,
  calendarName,
  onClose,
  onEdit,
  onDelete,
  onDone,
  onUndoDone,
  busy = false,
}: Props) {
  const { t } = useTranslation();
  const showDone = !!onDone && canCompleteFromPreview(task);
  const showUndoDone = !!onUndoDone && canUndoDoneFromPreview(task);

  const title = useMemo(() => {
    if (!event) return '';
    return task?.name?.trim() || event.summary?.trim() || t('calendar.untitledEvent');
  }, [event, task, t]);

  const timeLabel = useMemo(() => {
    if (!event) return null;
    const start = eventStartDate(event);
    const end = eventEndDate(event);
    return (
      formatDateTimeRange(start?.toISOString() ?? null, end?.toISOString() ?? null) ||
      t('calendar.timeNotSet')
    );
  }, [event, t]);

  const facts = useMemo(
    () => (event ? buildEventPreviewFacts(event, task, calendarName) : []),
    [event, task, calendarName],
  );
  const byId = useMemo(() => {
    const map = new Map<string, PreviewFact>();
    for (const fact of facts) map.set(fact.id, fact);
    return map;
  }, [facts]);
  const chips = facts.filter((fact) => CHIP_IDS.has(fact.id));
  const calendarFact = byId.get('calendar');
  const sections = SECTIONS.map((section) => ({
    ...section,
    facts: section.ids.map((id) => byId.get(id)).filter((fact): fact is PreviewFact => !!fact),
  })).filter((section) => section.facts.length > 0);
  const description = useMemo(
    () => (event ? descriptionSources(event, task) : { plain: '', html: null }),
    [event, task],
  );

  const editPlan = planEventPreviewEdit({
    taskIsRecurring: task?.isRecurring,
    recurringEventId: event?.recurringEventId,
  });
  const deletePlan = planEventPreviewDelete({
    hasLinkedTask: Boolean(task),
    taskIsRecurring: task?.isRecurring,
    recurringEventId: event?.recurringEventId,
  });

  const labelFor = (fact: PreviewFact): string => t(`calendar.preview.${fact.label}`);

  const textFor = (fact: Extract<PreviewFact, { kind: 'text' }>): React.ReactNode => {
    if (fact.id === 'calendar') {
      const [provider, name] = fact.text.split('|');
      const providerLabel = t(`calendar.preview.provider.${provider}`, { defaultValue: provider });
      return name ? `${providerLabel} · ${name}` : providerLabel;
    }
    if (fact.id === 'duration') {
      return formatMinutes(Number(fact.text));
    }
    if (fact.id === 'color') return t(`calendar.eventSettings.color${fact.text}`);
    if (fact.id === 'eligibleDays' || fact.id === 'repeatDays') {
      return fact.text
        .split(',')
        .map((day) => t(`tasks.weekday.${day}`))
        .join(', ');
    }
    if (fact.id === 'occurrenceOf') {
      return t('tasks.occurrence.editedDayValue', { when: formatCivilYmd(fact.text) ?? fact.text });
    }
    if (fact.id === 'deadline' || fact.id === 'windowFrom' || fact.id === 'created' || fact.id === 'updated' || fact.id === 'problematicDay' || fact.id === 'completedAt') {
      return formatDateTime(fact.text) || fact.text;
    }
    if (fact.id === 'originalTime') {
      const [start, end] = fact.text.split('|');
      return formatDateTimeRange(start || null, end || null) || fact.text;
    }
    if (fact.id === 'kindDetail' && (fact.text === 'home' || fact.text === 'office')) {
      return t(`calendar.preview.place.${fact.text}`);
    }
    const coded = t(`calendar.preview.value.${fact.text}`, { defaultValue: '' });
    if (coded) return coded;
    return <LinkedText value={fact.text} />;
  };

  return (
    <Modal
      open={open && !!event}
      onClose={onClose}
      title={t('calendar.preview.title')}
      maxWidthClass="max-w-xl"
      footer={
          <div className="grid w-full grid-flow-col auto-cols-fr gap-2 sm:flex sm:justify-end [&>*:first-child]:sm:mr-auto">
            {deletePlan === 'series_menu' ? (
              <SeriesScopeMenu
                label={t('common.delete')}
                variant="danger"
                disabled={busy}
                menuAlign="left"
                onChoose={(scope) => onDelete(scope)}
              />
            ) : (
              <Button
                type="button"
                variant="danger"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => onDelete()}
                icon={Trash2}
              >
                {t('common.delete')}
              </Button>
            )}
            {showDone ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => onDone?.()}
                icon={Check}
              >
                {task?.isRecurring ? t('tasks.occurrence.markDone') : t('tasks.item.done')}
              </Button>
            ) : null}
            {showUndoDone ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => onUndoDone?.()}
                icon={Undo2}
              >
                {t('tasks.item.undoDone')}
              </Button>
            ) : null}
            {editPlan === 'series_menu' ? (
              <SeriesScopeMenu
                label={t('common.edit')}
                variant="secondary"
                disabled={busy}
                onChoose={(scope) => onEdit(scope)}
              />
            ) : (
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={busy}
                onClick={() => onEdit()}
                icon={Pencil}
              >
                {t('common.edit')}
              </Button>
            )}
          </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div style={{ boxShadow: `inset 3px 0 0 ${event ? getEventColor(event) : 'rgb(var(--ph-blue))'}` }} className="pl-3">
          <h2 className="text-xl font-semibold leading-snug text-ide-text">{title}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-ide-muted">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {timeLabel}
          </p>
          {calendarFact || chips.length ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {calendarFact && calendarFact.kind === 'text' ? (
                <CalendarValue
                  text={calendarFact.text}
                  labelFor={(code) => t(`calendar.preview.provider.${code}`, { defaultValue: code })}
                />
              ) : null}
              {chips.map((fact) =>
                fact.kind === 'text' ? <TextValue key={fact.id} fact={fact} node={textFor(fact)} /> : null,
              )}
            </div>
          ) : null}
        </div>
        {sections.map((section) => (
          <section key={section.id}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ide-muted">
              {t(`calendar.preview.${section.title}`)}
            </h3>
            <dl className="divide-y divide-ide-border/60">
              {section.facts.map((fact) => (
                <div key={fact.id} className="grid grid-cols-[7.25rem_minmax(0,1fr)] items-start gap-x-3 py-2">
                  <dt className="pt-0.5 text-xs text-ide-muted">{labelFor(fact)}</dt>
                  <dd className="min-w-0 text-sm text-ide-text">
                    <FactValue
                      fact={fact}
                      textFor={textFor}
                      personTag={(tag) => t(`calendar.preview.person.${tag}`)}
                      providerLabel={(code) => t(`calendar.preview.provider.${code}`, { defaultValue: code })}
                      reminderLabel={(item) =>
                        item.method === 'default'
                          ? t('calendar.preview.reminderDefault')
                          : t(
                              item.method === 'email'
                                ? 'calendar.preview.reminderEmail'
                                : 'calendar.preview.reminderPopup',
                              { minutes: item.minutes ?? 0 },
                            )
                      }
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {description.plain || description.html ? (
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ide-muted">
              {t('tasks.form.description')}
            </h3>
            {description.html ? (
              <div
                className="text-sm text-ide-text [&_a]:text-ide-link [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: sanitizeEventHtml(description.html) }}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-ide-text">
                <LinkedText value={description.plain} />
              </p>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass(tone)}`}>
      {children}
    </span>
  );
}

function isSchedulingKind(value: string): value is SchedulingKind {
  return value === 'fixed' || value === 'flexible' || value === 'recurring' || value === 'unscheduled' || value === 'habit';
}

function TextValue({
  fact,
  node,
}: {
  fact: Extract<PreviewFact, { kind: 'text' }>;
  node: React.ReactNode;
}) {
  if (fact.id === 'color') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="h-3.5 w-3.5 rounded-full border border-ide-text/20"
          style={{ background: googleColorCss(fact.text) }}
        />
        {node}
      </span>
    );
  }
  if (!CHIP_IDS.has(fact.id)) return <>{node}</>;
  return (
    <Pill tone={VALUE_TONE[fact.text] ?? 'neutral'}>
      {fact.id === 'type' && isSchedulingKind(fact.text) ? (
        <KindIcon kind={fact.text} className="h-3.5 w-3.5" />
      ) : null}
      {node}
    </Pill>
  );
}

function CalendarValue({
  text,
  labelFor,
}: {
  text: string;
  labelFor: (code: string) => string;
}) {
  const [provider, name] = text.split('|');
  const known = provider === 'google' || provider === 'microsoft' || provider === 'apple';
  const label = labelFor(provider);
  return (
    <span className="inline-flex items-center gap-2">
      {known ? <ProviderLogo provider={provider} className="h-4 w-4" /> : null}
      <span>{name ? `${label} · ${name}` : label}</span>
    </span>
  );
}

function FactValue({
  fact,
  textFor,
  personTag,
  providerLabel,
  reminderLabel,
}: {
  fact: PreviewFact;
  textFor: (fact: Extract<PreviewFact, { kind: 'text' }>) => React.ReactNode;
  personTag: (tag: string) => string;
  providerLabel: (code: string) => string;
  reminderLabel: (item: { method: string; minutes?: number }) => string;
}) {
  if (fact.kind === 'text') return <TextValue fact={fact} node={textFor(fact)} />;
  if (fact.kind === 'links') return <LinkList links={fact.links} providerLabel={providerLabel} />;
  if (fact.kind === 'people') {
    return (
      <ul className="space-y-1">
        {fact.people.map((person) => (
          <li key={`${person.name}-${person.tags.join('-')}`}>
            {person.name}
            {person.tags.length ? (
              <span className="text-ide-muted"> ({person.tags.map(personTag).join(', ')})</span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-1">
      {fact.items.map((item, index) => (
        <li key={`${item.method}-${item.minutes ?? 'default'}-${index}`}>{reminderLabel(item)}</li>
      ))}
    </ul>
  );
}

function LinkList({
  links,
  providerLabel,
}: {
  links: PreviewLink[];
  providerLabel: (code: string) => string;
}) {
  return (
    <ul className="space-y-1">
      {links.map((link) => {
        const label =
          link.label === 'google' || link.label === 'microsoft' || link.label === 'apple'
            ? providerLabel(link.label)
            : link.label;
        return (
          <li key={`${link.url || ''}-${label}`}>
            {link.url ? <ExternalAnchor href={link.url}>{label}</ExternalAnchor> : label}
          </li>
        );
      })}
    </ul>
  );
}
