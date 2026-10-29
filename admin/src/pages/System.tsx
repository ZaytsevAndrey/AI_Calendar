import React, { useState } from 'react';
import { qs } from '../api';
import { Link } from '../router';
import type { GoogleWriteRow, Health, ScheduleJobRow } from '../types';
import {
  Button,
  ErrorNote,
  Figure,
  FigureRow,
  Loading,
  PageHeader,
  Section,
  Segmented,
  StatusMark,
  Table,
  fmtAgo,
  fmtDateTime,
  fmtMs,
  fmtNum,
  fmtUptime,
  healthChecks,
  useApi,
} from '../ui';
import { JobStatus } from './User';

const GROUPS: Record<string, string> = {
  auth: 'Вхід і календарі',
  llm: 'Мовні моделі',
  speech: 'Розпізнавання й синтез мовлення',
  push: 'Push-нагадування',
  other: 'Інше',
};

const STATUS_TEXT: Record<Health['status'], string> = {
  ok: 'Усе працює штатно',
  degraded: 'Система працює, але є проблеми',
  down: 'База даних недоступна',
};

type JobFilter = 'all' | 'failed' | 'running';

export function SystemPage() {
  const { data, error, loading, reload } = useApi<Health>('/admin/health');
  const [jobFilter, setJobFilter] = useState<JobFilter>('all');
  const jobs = useApi<ScheduleJobRow[]>(`/admin/ops/schedule-jobs${qs({ status: jobFilter === 'all' ? '' : jobFilter, limit: 50 })}`);
  const writes = useApi<GoogleWriteRow[]>('/admin/ops/google-writes?limit=100');

  return (
    <>
      <PageHeader
        title={data ? STATUS_TEXT[data.status] : 'Система'}
        aside={
          <Button
            onClick={() => {
              void reload();
              void jobs.reload();
              void writes.reload();
            }}
          >
            Оновити
          </Button>
        }
      >
        {data ? (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {healthChecks(data).map((c) => (
              <StatusMark key={c.key} ok={c.ok} label={c.label} />
            ))}
          </div>
        ) : null}
      </PageHeader>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Клієнтський API" note="Сервіс, з яким працюють користувачі">
              {data.clientApi.reachable ? (
                <FigureRow>
                  <Figure label="Працює" value={fmtUptime(data.clientApi.uptimeSec)} hint={`з ${fmtDateTime(data.clientApi.startedAt)}`} />
                  <Figure label="Пам'ять (RSS)" value={`${data.clientApi.memoryMb.rss} МБ`} hint={`heap ${data.clientApi.memoryMb.heapUsed} / ${data.clientApi.memoryMb.heapTotal} МБ`} />
                  <Figure label="Збірка" value={data.clientApi.commit ?? '—'} hint={`${data.clientApi.nodeEnv}, Node ${data.clientApi.node}`} />
                  <Figure label="Відповідь" value={fmtMs(data.clientApi.latencyMs)} />
                </FigureRow>
              ) : (
                <div className="text-sm">
                  <StatusMark ok={false} label="Немає зв'язку з клієнтським API" />
                  <p className="mt-1 text-muted">{data.clientApi.error}</p>
                  <p className="mt-1 text-xs text-muted">
                    Перевірте CLIENT_API_URL та однаковий INTERNAL_API_TOKEN в обох сервісах. Без цього не працюють видалення акаунта та інтеграції нижче.
                  </p>
                </div>
              )}
            </Section>
            <Section title="База даних та адмін-API">
              <FigureRow>
                <Figure label="База" value={data.database.ok ? 'доступна' : 'недоступна'} tone={data.database.ok ? undefined : 'bad'} hint={data.database.error ?? data.database.type} />
                <Figure label="Відповідь на SELECT 1" value={fmtMs(data.database.latencyMs)} tone={data.database.latencyMs > 500 ? 'warn' : undefined} />
                <Figure label="Адмін-API працює" value={fmtUptime(data.adminApi.uptimeSec)} hint={`${data.adminApi.memoryMb.rss} МБ, ${data.adminApi.commit ?? data.adminApi.nodeEnv}`} />
              </FigureRow>
            </Section>
          </div>

          <Section title="Фонові черги">
            <FigureRow>
              <Figure label="Записів у Google у черзі" value={fmtNum(data.queues.pendingGoogleWrites)} tone={data.queues.pendingGoogleWrites >= 50 ? 'bad' : data.queues.pendingGoogleWrites ? 'warn' : undefined} />
              <Figure label="Найстаріший запис у черзі" value={data.queues.oldestGoogleWriteAt ? fmtAgo(data.queues.oldestGoogleWriteAt) : '—'} hint={data.queues.maxGoogleWriteAttempts ? `до ${data.queues.maxGoogleWriteAttempts} спроб` : undefined} />
              <Figure label="Планувальник: активні" value={fmtNum(data.queues.scheduleJobsActive)} />
              <Figure label="Планувальник: завислі" value={fmtNum(data.queues.scheduleJobsStuck)} tone={data.queues.scheduleJobsStuck ? 'bad' : undefined} hint="без оновлень понад 10 хв" />
              <Figure label="Планувальник: збої за добу" value={fmtNum(data.queues.scheduleJobsFailed24h)} tone={data.queues.scheduleJobsFailed24h ? 'warn' : undefined} />
            </FigureRow>
          </Section>

          {data.clientApi.reachable ? (
          <Section title="Інтеграції клієнтського API" note="Показано лише, чи задано ключі. Значення не передаються.">
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(GROUPS).map(([group, title]) => {
                const items = data.clientApi.reachable ? data.clientApi.integrations.filter((i) => i.group === group) : [];
                if (!items.length) return null;
                return (
                  <div key={group}>
                    <h3 className="mb-1.5 text-xs font-medium text-muted">{title}</h3>
                    <ul className="space-y-1">
                      {items.map((i) => (
                        <li key={i.key} className="flex flex-wrap items-baseline gap-x-2">
                          <StatusMark ok={i.configured ? true : 'warn'} label={i.label} />
                          {i.detail ? <span className="text-xs text-muted">{i.detail}</span> : null}
                          {!i.configured ? <span className="text-xs text-muted">не налаштовано</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 space-y-5">
        <Section
          title="Автопланування"
          note="останні 50 запусків"
          aside={
            <Segmented<JobFilter>
              label="Стан запусків"
              value={jobFilter}
              onChange={setJobFilter}
              options={[
                { value: 'all', label: 'Усі' },
                { value: 'failed', label: 'Збої' },
                { value: 'running', label: 'Виконуються' },
              ]}
            />
          }
        >
          {jobs.error ? <ErrorNote message={jobs.error} onRetry={jobs.reload} /> : null}
          <Table<ScheduleJobRow>
            rows={jobs.data ?? []}
            rowKey={(j) => j.id}
            empty={jobs.loading ? 'Завантаження…' : 'Запусків немає.'}
            columns={[
              { key: 'at', label: 'Коли', render: (j) => <span className="whitespace-nowrap">{fmtDateTime(j.createdAt)}</span> },
              {
                key: 'user',
                label: 'Користувач',
                render: (j) => (
                  <Link to={`/users/${j.userId}`} className="break-all hover:underline">
                    {j.email ?? j.userId}
                  </Link>
                ),
              },
              { key: 'status', label: 'Стан', render: (j) => <JobStatus status={j.status} /> },
              {
                key: 'stage',
                label: 'Етап',
                render: (j) => (
                  <span className="text-muted">
                    {j.progressStage ?? '—'}
                    {j.progressTotal ? ` ${j.progressCurrent ?? 0}/${j.progressTotal}` : ''}
                  </span>
                ),
              },
              { key: 'dur', label: 'Тривалість', align: 'right', render: (j) => fmtMs(j.durationMs) },
              { key: 'err', label: 'Помилка', render: (j) => <span className="text-xs text-bad">{j.errorMessage ?? ''}</span> },
            ]}
          />
        </Section>

        <Section title="Черга запису в Google" note="записи, які ще не дійшли до Google Calendar">
          {writes.error ? <ErrorNote message={writes.error} onRetry={writes.reload} /> : null}
          <Table<GoogleWriteRow>
            rows={writes.data ?? []}
            rowKey={(w) => w.id}
            empty={writes.loading ? 'Завантаження…' : 'Черга порожня: усе синхронізовано.'}
            columns={[
              { key: 'since', label: 'У черзі', render: (w) => <span title={w.enqueuedAt}>{fmtAgo(w.enqueuedAt)}</span> },
              {
                key: 'user',
                label: 'Користувач',
                render: (w) => (
                  <Link to={`/users/${w.userId}`} className="break-all hover:underline">
                    {w.email ?? w.userId}
                  </Link>
                ),
              },
              { key: 'op', label: 'Операція', render: (w) => w.operation },
              { key: 'tries', label: 'Спроб', align: 'right', render: (w) => w.attempts },
              { key: 'err', label: 'Остання помилка', render: (w) => <span className="text-xs text-muted">{w.lastError ?? ''}</span> },
            ]}
          />
        </Section>
      </div>
    </>
  );
}
