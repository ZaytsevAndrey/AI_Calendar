import React from 'react';
import { Link } from '../router';
import type { Health, Overview } from '../types';
import {
  DayBars,
  ErrorNote,
  Figure,
  FigureRow,
  Loading,
  PageHeader,
  Section,
  StatusMark,
  fmtAgo,
  fmtCompact,
  fmtMs,
  fmtNum,
  fmtPct,
  healthChecks,
  useApi,
} from '../ui';

const STATUS_LABEL: Record<string, string> = {
  todo: 'До виконання',
  in_progress: 'В роботі',
  completed: 'Виконано',
  canceled: 'Скасовано',
};

function Headline({ health }: { health: Health | null }) {
  if (!health) return <>Перевіряємо систему…</>;
  const failing = health.checks.filter((c) => !c.ok);
  if (!failing.length) return <>Усе працює штатно.</>;
  return (
    <>
      {failing.length === 1 ? 'Одна перевірка потребує уваги.' : `${failing.length} перевірки потребують уваги.`}
    </>
  );
}

export function OverviewPage() {
  const { data, error, loading, reload } = useApi<Overview>('/admin/overview');
  const health = useApi<Health>('/admin/health');

  return (
    <>
      <PageHeader
        title={<Headline health={health.data} />}
        aside={data ? <span className="text-xs text-muted">Оновлено {fmtAgo(data.generatedAt)}</span> : null}
      >
        {health.data ? (
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            {healthChecks(health.data).map((c) => (
              <Link key={c.key} to="/system" className="hover:underline">
                <StatusMark ok={c.ok} label={c.label} />
              </Link>
            ))}
          </div>
        ) : null}
      </PageHeader>

      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}

      {data ? (
        <div className="space-y-5">
          <Section title="Користувачі">
            <FigureRow>
              <Figure label="Усього" value={fmtNum(data.users.total)} />
              <Figure label="Нових за 7 днів" value={fmtNum(data.users.new7d)} hint={`${fmtNum(data.users.new30d)} за 30 днів`} />
              <Figure label="Активні за добу" value={fmtNum(data.users.active24h)} />
              <Figure label="Активні за 7 днів" value={fmtNum(data.users.active7d)} />
              <Figure label="Заблоковані" value={fmtNum(data.users.blocked)} tone={data.users.blocked ? 'warn' : undefined} />
            </FigureRow>
          </Section>

          <Section title="Голосовий агент" note="Токени рахує ліміт квоти, запити — журнал голосу" aside={<Link to="/voice" className="text-sm text-accent hover:underline">Детальніше</Link>}>
            <FigureRow>
              <Figure label="Токенів сьогодні (UTC)" value={fmtCompact(data.voice.tokensToday)} hint={`Ліміт на людину: ${data.voice.dailyTokenLimit ? fmtNum(data.voice.dailyTokenLimit) : 'немає'}`} />
              <Figure label="Токенів за 7 днів" value={fmtCompact(data.voice.tokens7d)} hint={`${fmtNum(data.voice.users7d)} користувачів`} />
              <Figure label="Запитів за добу" value={fmtNum(data.voice.turns24h)} />
              <Figure
                label="Частка помилок за добу"
                value={fmtPct(data.voice.errorRate24h)}
                tone={data.voice.errorRate24h >= 0.1 ? 'bad' : data.voice.errorRate24h >= 0.03 ? 'warn' : undefined}
              />
              <Figure label="Медіана / p95 відповіді" value={fmtMs(data.voice.p50Ms24h)} hint={`p95 ${fmtMs(data.voice.p95Ms24h)}`} />
            </FigureRow>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Реєстрації" note="30 днів">
              <DayBars label="Нових акаунтів" data={data.series.map((d) => ({ day: d.day, value: d.signups }))} />
            </Section>
            <Section title="Токени голосу" note="30 днів">
              <DayBars label="Токенів" format={fmtCompact} data={data.series.map((d) => ({ day: d.day, value: d.voiceTokens }))} />
            </Section>
            <Section title="Голосові запити" note="30 днів">
              <DayBars label="Запитів" data={data.series.map((d) => ({ day: d.day, value: d.voiceTurns }))} />
            </Section>
            <Section title="Голосові запити з помилкою" note="HTTP 4xx/5xx, 30 днів">
              <DayBars label="З помилкою" tone="bad" data={data.series.map((d) => ({ day: d.day, value: d.voiceErrors }))} />
            </Section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Задачі" note={`${fmtNum(data.tasks.created7d)} створено за 7 днів`}>
              <FigureRow>
                <Figure label="Усього" value={fmtNum(data.tasks.total)} />
                {Object.entries(data.tasks.byStatus).map(([status, n]) => (
                  <Figure key={status} label={STATUS_LABEL[status] ?? status} value={fmtNum(n)} />
                ))}
              </FigureRow>
            </Section>
            <Section title="Фонові процеси" aside={<Link to="/system" className="text-sm text-accent hover:underline">Система</Link>}>
              <FigureRow>
                <Figure label="Записи в Google у черзі" value={fmtNum(data.ops.pendingGoogleWrites)} tone={data.ops.pendingGoogleWrites > 20 ? 'warn' : undefined} />
                <Figure label="Збої планувальника за добу" value={fmtNum(data.ops.failedScheduleJobs24h)} tone={data.ops.failedScheduleJobs24h ? 'warn' : undefined} />
                <Figure label="Помилки 5xx за добу" value={fmtNum(data.ops.errors24h.server)} tone={data.ops.errors24h.server ? 'bad' : undefined} hint={`${fmtNum(data.ops.errors24h.client)} × 4xx`} />
                <Figure label="Підписані на push" value={fmtNum(data.ops.pushSubscribers)} />
                <Figure label="Нагадувань за добу" value={fmtNum(data.ops.remindersSent24h)} />
              </FigureRow>
            </Section>
          </div>
        </div>
      ) : null}
    </>
  );
}
