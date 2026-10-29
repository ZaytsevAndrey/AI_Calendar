import React, { useState } from 'react';
import { qs } from '../api';
import { Link } from '../router';
import type { ErrorEntry } from '../types';
import { Badge, Button, ErrorNote, PageHeader, Segmented, Table, fmtDateTime, useApi } from '../ui';

type Level = '500' | '400';

export function ErrorsPage() {
  const [level, setLevel] = useState<Level>('500');
  const { data, error, loading, reload } = useApi<{ retentionDays: number; items: ErrorEntry[] }>(
    `/admin/errors${qs({ minStatus: level, limit: 300 })}`,
  );

  return (
    <>
      <PageHeader
        title="Помилки API"
        aside={
          <>
            <Segmented<Level>
              label="Рівень"
              value={level}
              onChange={setLevel}
              options={[
                { value: '500', label: 'Лише 5xx' },
                { value: '400', label: '4xx і 5xx' },
              ]}
            />
            <Button onClick={() => void reload()}>Оновити</Button>
          </>
        }
      >
        {data
          ? `Помилки клієнтського API за ${data.retentionDays} днів. Лише шлях і повідомлення, без тіл запитів, заголовків і токенів. 401 і 404 не зберігаються.`
          : null}
      </PageHeader>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      <div className="rounded-lg border border-line bg-panel px-4 pt-3">
        <Table<ErrorEntry>
          rows={data?.items ?? []}
          rowKey={(e) => `${e.at}-${e.path}-${e.status}-${e.message.slice(0, 20)}`}
          empty={loading ? 'Завантаження…' : level === '500' ? 'Помилок 5xx немає.' : 'Помилок немає.'}
          columns={[
            { key: 'at', label: 'Коли', render: (e) => <span className="whitespace-nowrap">{fmtDateTime(e.at)}</span> },
            { key: 'status', label: 'Код', render: (e) => <Badge tone={e.status >= 500 ? 'bad' : 'warn'}>{e.status}</Badge> },
            {
              key: 'path',
              label: 'Запит',
              render: (e) => (
                <code className="break-all text-xs">
                  {e.method} {e.path}
                </code>
              ),
            },
            {
              key: 'msg',
              label: 'Повідомлення',
              render: (e) => (
                <span className="break-words text-sm">
                  {e.code ? <span className="mr-1.5 font-medium">{e.code}</span> : null}
                  <span className="text-muted">{e.message}</span>
                </span>
              ),
            },
            {
              key: 'user',
              label: 'Користувач',
              render: (e) =>
                e.userId ? (
                  <Link to={`/users/${e.userId}`} className="text-accent hover:underline">
                    відкрити
                  </Link>
                ) : (
                  <span className="text-muted">—</span>
                ),
            },
          ]}
        />
      </div>
    </>
  );
}
