import React, { useState } from 'react';
import { api } from '../api';
import { Link, useRouter } from '../router';
import type { TurnRow, UserDetail } from '../types';
import {
  Badge,
  Button,
  DayBars,
  ErrorNote,
  Figure,
  FigureRow,
  Loading,
  Meter,
  PageHeader,
  Section,
  Table,
  fmtAgo,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtMs,
  fmtNum,
  useApi,
} from '../ui';
import { ProviderBadges } from './Users';
import { TurnStatus } from './Turns';

const STATUS_LABEL: Record<string, string> = {
  todo: 'До виконання',
  in_progress: 'В роботі',
  completed: 'Виконано',
  canceled: 'Скасовано',
};

/** Two-step button: the first click arms it, the second does the thing. */
function ConfirmButton({
  label,
  confirmLabel,
  tone = 'default',
  onConfirm,
  disabled,
}: {
  label: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  onConfirm: () => Promise<void>;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed)
    return (
      <Button tone={tone} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  return (
    <span className="inline-flex gap-1">
      <Button
        tone={tone === 'danger' ? 'danger' : 'primary'}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button onClick={() => setArmed(false)} disabled={busy}>
        Скасувати
      </Button>
    </span>
  );
}

function DeleteAccount({ email, id, onDeleted }: { email: string; id: string; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open)
    return (
      <Button tone="danger" onClick={() => setOpen(true)}>
        Видалити акаунт
      </Button>
    );
  return (
    <div className="w-full rounded-md border border-bad/40 bg-bad/5 p-3 text-sm">
      <p>
        Акаунт, усі задачі, фази й налаштування буде видалено назавжди, а події застосунку приберуться з Google Calendar. Щоб підтвердити, введіть{' '}
        <span className="font-semibold">{email}</span>.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label="Email для підтвердження"
          className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-1.5"
        />
        <Button
          tone="danger"
          disabled={busy || typed.trim().toLowerCase() !== email.toLowerCase()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/admin/users/${id}`, { method: 'DELETE', json: { confirmation: typed } });
              onDeleted();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
              setBusy(false);
            }
          }}
        >
          Видалити назавжди
        </Button>
        <Button onClick={() => setOpen(false)} disabled={busy}>
          Скасувати
        </Button>
      </div>
      {error ? <p className="mt-2 text-bad">{error}</p> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function UserPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { data, error, loading, reload } = useApi<UserDetail>(`/admin/users/${id}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(path: string, done: string) {
    setActionError(null);
    setNotice(null);
    try {
      await api(path, { method: 'POST' });
      setNotice(done);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const u = data.user;

  return (
    <>
      <div className="mb-3 text-sm">
        <Link to="/users" className="text-muted hover:text-ink hover:underline">
          Усі користувачі
        </Link>
      </div>
      <PageHeader
        title={<span className="break-all">{u.email}</span>}
        aside={
          <>
            {u.isBlocked ? <Badge tone="bad">заблоковано</Badge> : null}
          </>
        }
      >
        Зареєстровано {fmtDate(u.createdAt)}, остання активність {fmtAgo(u.lastActiveAt)}
      </PageHeader>

      {notice ? <p className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{notice}</p> : null}
      {actionError ? <p className="mb-4 rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">{actionError}</p> : null}

      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <Section title="Профіль">
            <dl>
              <Row label="ID">
                <code className="text-xs">{u.id}</code>
              </Row>
              <Row label="Вхід">
                <ProviderBadges providers={u.providers} />
              </Row>
              <Row label="Email підтверджено">{u.isEmailVerified ? 'так' : 'ні'}</Row>
              <Row label="Часовий пояс">{data.settings?.timeZone ?? '—'}</Row>
              <Row label="Мова інтерфейсу">{data.settings?.language ?? '—'}</Row>
              <Row label="Мова голосу">{data.settings?.speechLanguage ?? '—'}</Row>
              <Row label="Push">
                {data.push.subscriptions ? `${data.push.subscriptions} пристр., ${data.push.remindersSent7d} нагадувань за 7 днів` : 'не підписаний'}
              </Row>
            </dl>
            {data.identities.length ? (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 text-xs text-muted">Підключені календарі</div>
                {data.identities.map((i) => (
                  <div key={`${i.provider}-${i.email}`} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                    <Badge>{i.provider}</Badge>
                    <span>{i.email ?? '—'}</span>
                    <span className="text-xs text-muted">з {fmtDate(i.createdAt)}</span>
                    {i.isRegistrationIdentity ? <span className="text-xs text-muted">(вхід)</span> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title="Дії">
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {u.isBlocked ? (
                    <ConfirmButton
                      label="Розблокувати"
                      confirmLabel="Так, розблокувати"
                      onConfirm={() => act(`/admin/users/${id}/unblock`, 'Користувача розблоковано.')}
                    />
                  ) : (
                    <ConfirmButton
                      label="Заблокувати"
                      confirmLabel="Так, заблокувати"
                      tone="danger"
                      onConfirm={() => act(`/admin/users/${id}/block`, 'Користувача заблоковано: старі сесії недійсні, нові запити відхиляються.')}
                    />
                  )}
                  <ConfirmButton
                    label="Вийти на всіх пристроях"
                    confirmLabel="Так, завершити сесії"
                    onConfirm={() => act(`/admin/users/${id}/revoke-sessions`, 'Сесії завершено: усі видані раніше токени недійсні.')}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted">Блокування одразу відхиляє запити до API й забирає можливість оновити сесію.</p>
              </div>
              <div className="border-t border-line pt-4">
                <Meter value={data.voice.tokensToday} max={data.voice.dailyTokenLimit} label="Токени голосу сьогодні" />
                <div className="mt-2">
                  <ConfirmButton
                    label="Обнулити денний ліміт"
                    confirmLabel="Так, обнулити"
                    disabled={!data.voice.tokensToday}
                    onConfirm={() => act(`/admin/users/${id}/voice-quota/reset`, 'Лічильник токенів на сьогодні обнулено.')}
                  />
                </div>
              </div>
              <div className="border-t border-line pt-4">
                <DeleteAccount email={u.email} id={id} onDeleted={() => navigate('/users', true)} />
              </div>
            </div>
          </Section>
        </div>

        <Section title="Задачі">
          <FigureRow>
            <Figure label="Усього" value={fmtNum(u.tasks)} />
            <Figure label="З часом у календарі" value={fmtNum(data.tasks.scheduled)} />
            {Object.entries(data.tasks.byStatus).map(([s, n]) => (
              <Figure key={s} label={STATUS_LABEL[s] ?? s} value={fmtNum(n)} />
            ))}
          </FigureRow>
        </Section>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Токени голосу" note="30 днів">
            <DayBars
              label="Токенів"
              format={fmtCompact}
              limit={data.voice.dailyTokenLimit || undefined}
              limitLabel="денний ліміт"
              data={data.voice.series.map((d) => ({ day: d.day, value: d.tokens }))}
            />
          </Section>
          <Section
            title="Останні голосові запити"
            aside={
              <Link to={`/turns?userId=${id}`} className="text-sm text-accent hover:underline">
                Усі
              </Link>
            }
          >
            <Table<TurnRow>
              rows={data.voice.recentTurns}
              rowKey={(t) => t.id}
              onRowClick={(t) => navigate(`/turns/${t.id}`)}
              empty="Голосом ще не користувався."
              columns={[
                { key: 'at', label: 'Коли', render: (t) => fmtDateTime(t.createdAt) },
                { key: 'path', label: 'Маршрут', render: (t) => <code className="text-xs">{t.path}</code> },
                { key: 'status', label: 'Результат', render: (t) => <TurnStatus turn={t} /> },
                { key: 'ms', label: 'Час', align: 'right', render: (t) => fmtMs(t.totalMs) },
              ]}
            />
          </Section>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Задачі планувальника" note="останні 10">
            <Table
              rows={data.jobs}
              rowKey={(j) => j.id}
              empty="Автопланування ще не запускалось."
              columns={[
                { key: 'at', label: 'Коли', render: (j) => fmtDateTime(j.createdAt) },
                { key: 'status', label: 'Стан', render: (j) => <JobStatus status={j.status} /> },
                { key: 'err', label: 'Помилка', render: (j) => <span className="text-xs text-muted">{j.errorMessage ?? ''}</span> },
              ]}
            />
          </Section>
          <Section title="Черга запису в Google" note={data.pendingGoogleWrites.length ? `${data.pendingGoogleWrites.length} в черзі` : undefined}>
            <Table
              rows={data.pendingGoogleWrites}
              rowKey={(w) => w.id}
              empty="Черга порожня: усе синхронізовано."
              columns={[
                { key: 'op', label: 'Операція', render: (w) => w.operation },
                { key: 'tries', label: 'Спроб', align: 'right', render: (w) => w.attempts },
                { key: 'since', label: 'У черзі', render: (w) => fmtAgo(w.enqueuedAt) },
                { key: 'err', label: 'Остання помилка', render: (w) => <span className="text-xs text-muted">{w.lastError ?? ''}</span> },
              ]}
            />
          </Section>
        </div>
      </div>
    </>
  );
}

export function JobStatus({ status }: { status: string }) {
  const map: Record<string, { tone: 'ok' | 'bad' | 'warn' | 'neutral'; label: string }> = {
    done: { tone: 'ok', label: 'готово' },
    failed: { tone: 'bad', label: 'збій' },
    running: { tone: 'warn', label: 'виконується' },
    pending: { tone: 'neutral', label: 'в черзі' },
  };
  const s = map[status] ?? { tone: 'neutral' as const, label: status };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}
