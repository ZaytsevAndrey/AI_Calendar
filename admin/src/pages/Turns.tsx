import React, { useEffect, useState } from 'react';
import { api, qs } from '../api';
import { Link, useRouter } from '../router';
import type { TurnDetail, TurnRow, VoiceStep } from '../types';
import {
  Badge,
  Button,
  ErrorNote,
  Figure,
  FigureRow,
  Loading,
  PageHeader,
  Section,
  Segmented,
  Table,
  fmtDateTime,
  fmtMs,
  fmtNum,
  useApi,
} from '../ui';

export function TurnStatus({ turn }: { turn: Pick<TurnRow, 'statusCode' | 'errorCode' | 'failedSteps'> }) {
  if (turn.statusCode >= 400)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="bad">{turn.statusCode}</Badge>
        {turn.errorCode ? <span className="text-xs text-muted">{turn.errorCode}</span> : null}
      </span>
    );
  if (turn.failedSteps)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="warn">{turn.statusCode}</Badge>
        <span className="text-xs text-muted">{turn.errorCode ?? `${turn.failedSteps} невдалих кроків`}</span>
      </span>
    );
  return <Badge tone="ok">{turn.statusCode}</Badge>;
}

type Filter = 'all' | 'failed';

export function TurnsPage() {
  const { location, navigate } = useRouter();
  const userId = location.search.get('userId') ?? '';
  const [filter, setFilter] = useState<Filter>(location.search.get('failed') ? 'failed' : 'all');
  const [items, setItems] = useState<TurnRow[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(before?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ items: TurnRow[]; nextBefore: string | null }>(
        `/admin/voice/turns${qs({ userId, failed: filter === 'failed' ? 1 : '', before, limit: 50 })}`,
      );
      setItems((prev) => (before ? [...prev, ...res.items] : res.items));
      setNext(res.nextBefore);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, filter]);

  return (
    <>
      <PageHeader title="Журнал голосу">
        Кожен запит до /voice: час, виклики моделей, токени та коди помилок. Тексти розмов не зберігаються. Записи живуть 30 днів.
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          label="Фільтр"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Усі' },
            { value: 'failed', label: 'З помилками' },
          ]}
        />
        {userId ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-muted">Один користувач</span>
            <Button onClick={() => navigate('/turns')}>Показати всіх</Button>
          </span>
        ) : null}
      </div>
      {error ? <ErrorNote message={error} onRetry={() => load()} /> : null}
      <div className="rounded-lg border border-line bg-panel px-4 pt-3">
        <Table<TurnRow>
          rows={items}
          rowKey={(t) => t.id}
          onRowClick={(t) => navigate(`/turns/${t.id}`)}
          empty={loading ? 'Завантаження…' : filter === 'failed' ? 'Помилок за 30 днів немає.' : 'Голосових запитів ще не було.'}
          columns={[
            { key: 'at', label: 'Коли', render: (t) => <span className="whitespace-nowrap">{fmtDateTime(t.createdAt)}</span> },
            { key: 'user', label: 'Користувач', render: (t) => <span className="break-all">{t.email ?? '—'}</span> },
            { key: 'path', label: 'Маршрут', render: (t) => <code className="text-xs">{t.path}</code> },
            { key: 'status', label: 'Результат', render: (t) => <TurnStatus turn={t} /> },
            { key: 'llm', label: 'Моделі', align: 'right', render: (t) => t.llmCalls },
            { key: 'tok', label: 'Токени', align: 'right', render: (t) => (t.tokens ? fmtNum(t.tokens) : '—') },
            { key: 'ms', label: 'Час', align: 'right', render: (t) => fmtMs(t.totalMs) },
          ]}
        />
        {next ? (
          <div className="border-t border-line py-3 text-center">
            <Button onClick={() => load(next)} disabled={loading}>
              Показати ще
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

function StepRow({ step, scale }: { step: VoiceStep; scale: number }) {
  const failed = !step.ok || step.valid === false;
  const width = scale > 0 ? Math.max(0.5, (step.ms / scale) * 100) : 0;
  const bar = failed ? 'bg-bad' : step.kind === 'llm' ? 'bg-accent' : 'bg-muted/50';
  const notes = [
    step.segment !== undefined ? `сегмент ${step.segment}` : null,
    step.decision ? `рішення: ${step.decision}` : null,
    step.outcome ? `підсумок: ${step.outcome}` : null,
    step.tokens ? `${fmtNum(step.tokens)} токенів` : null,
    step.errorCode ? `код: ${step.errorCode}` : null,
    step.reason ? `причина: ${step.reason}` : null,
  ].filter(Boolean);
  return (
    <li className="grid gap-x-4 gap-y-1 border-b border-line/70 py-2.5 last:border-0 sm:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1.3fr)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{step.name}</span>
          {step.kind === 'llm' ? <Badge tone="accent">модель</Badge> : null}
          {failed ? <Badge tone="bad">{!step.ok ? 'збій виклику' : 'відповідь відхилено'}</Badge> : null}
        </div>
        {step.via ? <div className="mt-0.5 break-all text-xs text-muted">{step.via}</div> : null}
        {notes.length ? <div className="mt-0.5 text-xs text-muted">{notes.join('; ')}</div> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunk">
          <div className={`h-full rounded-full ${bar}`} style={{ width: `${width}%` }} />
        </div>
        <span className="w-16 text-right text-sm tabular-nums">{fmtMs(step.ms)}</span>
      </div>
    </li>
  );
}

export function TurnPage({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<TurnDetail>(`/admin/voice/turns/${id}`);
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const scale = Math.max(data.totalMs, ...data.steps.map((s) => s.ms));
  const stepMs = data.steps.reduce((t, s) => t + s.ms, 0);
  return (
    <>
      <div className="mb-3 text-sm">
        <Link to="/turns" className="text-muted hover:text-ink hover:underline">
          Журнал голосу
        </Link>
      </div>
      <PageHeader title={<code className="text-[1.4rem]">{data.method} {data.path}</code>} aside={<TurnStatus turn={data} />}>
        {fmtDateTime(data.createdAt)}
        {data.email ? (
          <>
            {', '}
            <Link to={`/users/${data.userId}`} className="text-accent hover:underline">
              {data.email}
            </Link>
          </>
        ) : null}
      </PageHeader>
      <div className="space-y-5">
        <Section title="Підсумок">
          <FigureRow>
            <Figure label="Загальний час" value={fmtMs(data.totalMs)} />
            <Figure label="Викликів моделей" value={data.llmCalls} hint={`${fmtMs(data.llmMs ?? 0)} у моделях`} />
            <Figure label="Токенів" value={fmtNum(data.tokens)} />
            <Figure label="Невдалих кроків" value={data.failedSteps ?? 0} tone={data.failedSteps ? 'warn' : undefined} />
            <Figure label="Не враховано кроками" value={fmtMs(Math.max(0, data.totalMs - stepMs))} hint="мережа, парсинг, черга" />
          </FigureRow>
        </Section>
        <Section title="Кроки" note={`Trace ${data.traceId}. Смуга — частка від загального часу`}>
          {data.steps.length ? (
            <ol>
              {data.steps.map((s, i) => (
                <StepRow key={i} step={s} scale={scale} />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">Цей запит не записав жодного кроку.</p>
          )}
        </Section>
      </div>
    </>
  );
}
