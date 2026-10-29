import React, { useState } from 'react';
import { qs } from '../api';
import { Link, useRouter } from '../router';
import type { VoiceSummary } from '../types';
import {
  Badge,
  DayBars,
  ErrorNote,
  Figure,
  FigureRow,
  Loading,
  PageHeader,
  Section,
  Segmented,
  Table,
  fmtCompact,
  fmtMs,
  fmtNum,
  fmtPct,
  useApi,
} from '../ui';

type Range = '7' | '30' | '90';

export function VoicePage() {
  const { navigate } = useRouter();
  const [days, setDays] = useState<Range>('30');
  const { data, error, loading, reload } = useApi<VoiceSummary>(`/admin/voice/summary${qs({ days })}`);

  return (
    <>
      <PageHeader
        title="Голосовий агент"
        aside={
          <Segmented<Range>
            label="Період"
            value={days}
            onChange={setDays}
            options={[
              { value: '7', label: '7 днів' },
              { value: '30', label: '30 днів' },
              { value: '90', label: '90 днів' },
            ]}
          />
        }
      >
        Журнал запитів зберігається 30 днів, лічильник токенів — без обмеження.
      </PageHeader>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="space-y-5">
          <Section title="Підсумок за період">
            <FigureRow>
              <Figure label="Токенів" value={fmtCompact(data.totals.tokens)} hint={`${fmtNum(data.totals.users)} користувачів`} />
              <Figure label="Запитів" value={fmtNum(data.totals.turns)} />
              <Figure
                label="З помилкою"
                value={fmtNum(data.totals.errors)}
                hint={data.totals.turns ? fmtPct(data.totals.errors / data.totals.turns) : undefined}
                tone={data.totals.errors ? 'warn' : undefined}
              />
              <Figure label="Медіана відповіді" value={fmtMs(data.totals.p50Ms)} />
              <Figure label="p95 відповіді" value={fmtMs(data.totals.p95Ms)} />
            </FigureRow>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Токени по днях">
              <DayBars label="Токенів" format={fmtCompact} data={data.series.map((d) => ({ day: d.day, value: d.tokens }))} />
            </Section>
            <Section title="Активні користувачі голосу по днях">
              <DayBars label="Людино-днів" data={data.series.map((d) => ({ day: d.day, value: d.users }))} />
            </Section>
          </div>

          <Section title="Моделі" note="Кожен виклик моделі з кроків запитів">
            <Table
              rows={data.models}
              rowKey={(m) => m.via}
              empty="Викликів моделей за період немає."
              columns={[
                { key: 'via', label: 'Провайдер і модель', render: (m) => <span className="break-all">{m.via}</span> },
                { key: 'calls', label: 'Викликів', align: 'right', render: (m) => fmtNum(m.calls) },
                {
                  key: 'failed',
                  label: 'Збоїв',
                  align: 'right',
                  render: (m) => (m.failed ? <span className="text-bad">{fmtNum(m.failed)} ({fmtPct(m.failed / m.calls)})</span> : '0'),
                },
                { key: 'tokens', label: 'Токенів', align: 'right', render: (m) => (m.tokens ? fmtCompact(m.tokens) : '—') },
                { key: 'p50', label: 'Медіана', align: 'right', render: (m) => fmtMs(m.p50Ms) },
                { key: 'p95', label: 'p95', align: 'right', render: (m) => fmtMs(m.p95Ms) },
              ]}
            />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Маршрути">
              <Table
                rows={data.routes}
                rowKey={(r) => r.path}
                empty="Запитів за період немає."
                columns={[
                  { key: 'path', label: 'Маршрут', render: (r) => <code className="text-xs">{r.path}</code> },
                  { key: 'turns', label: 'Запитів', align: 'right', render: (r) => fmtNum(r.turns) },
                  { key: 'errors', label: 'Помилок', align: 'right', render: (r) => (r.errors ? <span className="text-bad">{fmtNum(r.errors)}</span> : '0') },
                  { key: 'p95', label: 'p95', align: 'right', render: (r) => fmtMs(r.p95Ms) },
                ]}
              />
            </Section>
            <Section
              title="Часті коди помилок"
              aside={
                <Link to="/turns?failed=1" className="text-sm text-accent hover:underline">
                  Запити з помилками
                </Link>
              }
            >
              {data.errorCodes.length ? (
                <ul className="space-y-1.5">
                  {data.errorCodes.map((c) => (
                    <li key={c.code} className="flex items-center justify-between gap-3 text-sm">
                      <code className="break-all text-xs">{c.code}</code>
                      <Badge tone="bad">{fmtNum(c.count)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">Помилок за період немає.</p>
              )}
            </Section>
          </div>

          <Section title="Найактивніші користувачі" note={`Ліміт на день: ${data.dailyTokenLimit ? fmtNum(data.dailyTokenLimit) : 'вимкнено'}`}>
            <Table
              rows={data.topUsers}
              rowKey={(u) => u.userId}
              onRowClick={(u) => navigate(`/users/${u.userId}`)}
              empty="Голосом ніхто не користувався."
              columns={[
                { key: 'email', label: 'Користувач', render: (u) => u.email ?? <span className="text-muted">видалений акаунт</span> },
                { key: 'tokens', label: 'Токенів', align: 'right', render: (u) => fmtCompact(u.tokens) },
                { key: 'turns', label: 'Запитів', align: 'right', render: (u) => fmtNum(u.turns) },
              ]}
            />
          </Section>
        </div>
      ) : null}
    </>
  );
}
