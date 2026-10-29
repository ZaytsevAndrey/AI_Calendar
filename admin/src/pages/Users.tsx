import React, { useEffect, useState } from 'react';
import { qs } from '../api';
import { useRouter } from '../router';
import type { UserList, UserRow } from '../types';
import { Badge, Button, ErrorNote, Loading, PageHeader, Segmented, Table, fmtAgo, fmtCompact, fmtDate, fmtNum, useApi } from '../ui';

type Sort = 'new' | 'active' | 'email';

export function ProviderBadges({ providers }: { providers: string[] }) {
  if (!providers.length) return <span className="text-muted">email</span>;
  const names: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', apple: 'Apple' };
  return (
    <span className="flex flex-wrap gap-1">
      {providers.map((p) => (
        <Badge key={p}>{names[p] ?? p}</Badge>
      ))}
    </span>
  );
}

export function UsersPage() {
  const { location, navigate } = useRouter();
  const [search, setSearch] = useState(location.search.get('q') ?? '');
  const [debounced, setDebounced] = useState(search);
  const [sort, setSort] = useState<Sort>((location.search.get('sort') as Sort) || 'new');
  const [page, setPage] = useState(Number(location.search.get('page') || 1));

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    // Keep the filter in the address so Back from a user returns to the same list.
    navigate(`/users${qs({ q: debounced, sort: sort === 'new' ? '' : sort, page: page > 1 ? page : '' })}`, true);
  }, [debounced, sort, page, navigate]);

  const { data, error, loading, reload } = useApi<UserList>(
    `/admin/users${qs({ search: debounced, sort, page, pageSize: 50 })}`,
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Користувачі">{data ? `${fmtNum(data.total)} акаунтів` : null}</PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Пошук за email або id"
          aria-label="Пошук користувачів"
          className="w-full max-w-xs rounded-md border border-line bg-panel px-3 py-1.5 text-sm"
        />
        <Segmented<Sort>
          label="Сортування"
          value={sort}
          onChange={(v) => {
            setSort(v);
            setPage(1);
          }}
          options={[
            { value: 'new', label: 'Нові' },
            { value: 'active', label: 'Активні' },
            { value: 'email', label: 'Email' },
          ]}
        />
      </div>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <div className="rounded-lg border border-line bg-panel px-4 pt-3">
          <Table<UserRow>
            rows={data.items}
            rowKey={(u) => u.id}
            onRowClick={(u) => navigate(`/users/${u.id}`)}
            empty={debounced ? `Нікого не знайдено за «${debounced}».` : 'Користувачів ще немає.'}
            columns={[
              {
                key: 'email',
                label: 'Email',
                render: (u) => (
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{u.email}</span>
                    {u.isBlocked ? <Badge tone="bad">заблоковано</Badge> : null}
                  </span>
                ),
              },
              { key: 'providers', label: 'Вхід', render: (u) => <ProviderBadges providers={u.providers} /> },
              { key: 'created', label: 'Реєстрація', render: (u) => fmtDate(u.createdAt) },
              {
                key: 'active',
                label: 'Остання активність',
                render: (u) => <span title={u.lastActiveAt ?? ''}>{fmtAgo(u.lastActiveAt)}</span>,
              },
              { key: 'tasks', label: 'Задач', align: 'right', render: (u) => fmtNum(u.tasks) },
              { key: 'voice', label: 'Токенів за 7 днів', align: 'right', render: (u) => (u.voiceTokens7d ? fmtCompact(u.voiceTokens7d) : '—') },
              { key: 'tz', label: 'Часовий пояс', render: (u) => <span className="text-muted">{u.timeZone ?? '—'}</span> },
            ]}
          />
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-line py-3 text-sm">
              <span className="text-muted">
                Сторінка {page} з {pages}
              </span>
              <div className="flex gap-2">
                <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Попередня
                </Button>
                <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  Наступна
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
