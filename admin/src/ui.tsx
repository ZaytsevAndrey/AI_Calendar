import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// ------------------------------------------------------------------ formatting

const nf = new Intl.NumberFormat('uk-UA');

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return nf.format(n);
}

/** 12 400 → 12,4 тис.; 1 250 000 → 1,3 млн */
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat('uk-UA', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtPct(x: number): string {
  return new Intl.NumberFormat('uk-UA', {
    style: 'percent',
    maximumFractionDigits: x > 0 && x < 0.1 ? 1 : 0,
  }).format(x);
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: ms < 10_000 ? 1 : 0 }).format(ms / 1000)} с`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('uk-UA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "5 хв тому", "3 дні тому" */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'ніколи';
  const diff = Math.max(0, now - new Date(iso).getTime());
  const rtf = new Intl.RelativeTimeFormat('uk', { numeric: 'auto' });
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'щойно';
  if (min < 60) return rtf.format(-min, 'minute');
  const h = Math.round(min / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.round(h / 24);
  if (d < 45) return rtf.format(-d, 'day');
  return rtf.format(-Math.round(d / 30), 'month');
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} д ${h} год`;
  if (h) return `${h} год ${m} хв`;
  return `${m} хв`;
}

export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ------------------------------------------------------------------- data hook

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api<T>(path);
      if (id === seq.current) setData(result);
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load, setData };
}

// ------------------------------------------------------------------ primitives

export function PageHeader({
  title,
  children,
  aside,
}: {
  title: React.ReactNode;
  children?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em]">{title}</h1>
        {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

export function Section({
  title,
  note,
  children,
  aside,
  className = '',
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[0.95rem] font-semibold">{title}</h2>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
        {aside}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A label/value pair. The value is the thing you scan for, so it leads. */
export function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'bad' | 'warn' | 'ok';
}) {
  const color = tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink';
  return (
    <div className="min-w-0">
      <div className={`text-2xl font-semibold leading-none tracking-[-0.01em] ${color}`}>{value}</div>
      <div className="mt-1.5 text-[0.8rem] text-muted">{label}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function FigureRow({ children }: { children: React.ReactNode }) {
  // Columns follow the container, so a half-width section does not squeeze five figures into one row.
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-6 gap-y-5">{children}</div>;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'bad' | 'warn' | 'ok' | 'accent';
  children: React.ReactNode;
}) {
  const map = {
    neutral: 'bg-sunk text-muted',
    bad: 'bg-bad/10 text-bad',
    warn: 'bg-warn/10 text-warn',
    ok: 'bg-ok/10 text-ok',
    accent: 'bg-accent/10 text-accent',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

/** Status is never colour alone: a shape and a word go with it. */
export function StatusMark({ ok, label }: { ok: boolean | 'warn'; label: string }) {
  const color = ok === true ? 'text-ok' : ok === 'warn' ? 'text-warn' : 'text-bad';
  const glyph = ok === true ? '●' : ok === 'warn' ? '▲' : '■';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${color}`}>
      <span aria-hidden className="text-[0.7rem]">
        {glyph}
      </span>
      <span className="text-ink">{label}</span>
    </span>
  );
}

export function Button({
  tone = 'default',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'primary' | 'danger' }) {
  const map = {
    default: 'border-line bg-panel text-ink hover:bg-sunk',
    primary: 'border-accent bg-accent text-white hover:opacity-90',
    danger: 'border-bad/40 bg-panel text-bad hover:bg-bad/10',
  } as const;
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${map[tone]} ${className}`}
      {...props}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-panel p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded px-2.5 py-1 text-sm ${o.value === value ? 'bg-sunk font-medium text-ink' : 'text-muted hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Loading() {
  return <div className="py-10 text-sm text-muted">Завантаження…</div>;
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm">
      <span className="text-bad">{message}</span>
      {onRetry ? (
        <Button onClick={onRetry} className="ml-auto">
          Спробувати ще раз
        </Button>
      ) : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-6 text-center text-sm text-muted">{children}</div>;
}

// ----------------------------------------------------------------------- table

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
};

export function Table<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  empty = 'Нічого немає.',
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`px-4 pb-2 font-medium ${c.align === 'right' ? 'text-right' : ''} ${c.className ?? ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter') onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={`border-b border-line/70 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-sunk/70' : ''}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 align-top [overflow-wrap:anywhere] ${c.align === 'right' ? 'whitespace-nowrap text-right tabular-nums' : ''} ${c.className ?? ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----------------------------------------------------------------------- chart

/**
 * Single-series daily bars. One hue (accent), 4px rounded tops anchored to the
 * baseline, 2px gaps, a recessive grid, a per-bar tooltip, and a table view.
 */
export function DayBars({
  data,
  label,
  format = fmtNum,
  tone = 'accent',
  height = 140,
  limit,
  limitLabel,
}: {
  data: Array<{ day: string; value: number }>;
  label: string;
  format?: (n: number) => string;
  tone?: 'accent' | 'bad';
  height?: number;
  limit?: number;
  limitLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, limit ?? 0, ...data.map((d) => d.value));
  const top = niceCeil(max);
  const n = data.length || 1;
  const W = 600;
  const H = height;
  const padTop = 14;
  const plotH = H - padTop - 18;
  const slot = W / n;
  const barW = Math.max(2, slot - 2);
  const fill = tone === 'bad' ? 'rgb(var(--bad))' : 'rgb(var(--accent))';
  const total = data.reduce((t, d) => t + d.value, 0);
  const y = (v: number) => padTop + plotH - (v / top) * plotH;
  const hovered = hover !== null ? data[hover] : null;

  return (
    <figure className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <figcaption className="text-sm text-muted">
          {label}: <span className="font-semibold text-ink">{format(total)}</span>
        </figcaption>
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
          {asTable ? 'Графік' : 'Таблиця'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-56 overflow-y-auto rounded border border-line">
          <table className="w-full text-sm">
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.day} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1 text-muted">{shortDay(d.day)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${label}, по днях`} onMouseLeave={() => setHover(null)}>
            {[0.5, 1].map((f) => (
              <g key={f}>
                <line x1={0} x2={W} y1={y(top * f)} y2={y(top * f)} stroke="rgb(var(--line))" strokeWidth={1} strokeDasharray={f === 1 ? undefined : '2 4'} />
                <text x={W} y={y(top * f) - 3} textAnchor="end" fontSize={10} fill="rgb(var(--muted))">
                  {fmtCompact(top * f)}
                </text>
              </g>
            ))}
            {limit ? (
              <g>
                <line x1={0} x2={W} y1={y(limit)} y2={y(limit)} stroke="rgb(var(--muted))" strokeWidth={1} strokeDasharray="6 3" />
                <text x={4} y={y(limit) - 3} fontSize={10} fill="rgb(var(--muted))">
                  {limitLabel ?? 'ліміт'}
                </text>
              </g>
            ) : null}
            {data.map((d, i) => {
              const h = d.value > 0 ? Math.max(2, (d.value / top) * plotH) : 0;
              const x = i * slot + 1;
              const yTop = padTop + plotH - h;
              const r = Math.min(4, barW / 2, h);
              return (
                <g key={d.day}>
                  {h > 0 ? (
                    <path
                      d={`M${x},${padTop + plotH} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${padTop + plotH} Z`}
                      fill={fill}
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  ) : null}
                  <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
            <line x1={0} x2={W} y1={padTop + plotH} y2={padTop + plotH} stroke="rgb(var(--line))" />
            {data.length ? (
              <>
                <text x={0} y={H - 4} fontSize={10} fill="rgb(var(--muted))">
                  {shortDay(data[0].day)}
                </text>
                <text x={W} y={H - 4} fontSize={10} textAnchor="end" fill="rgb(var(--muted))">
                  {shortDay(data[data.length - 1].day)}
                </text>
              </>
            ) : null}
          </svg>
          {hovered && hover !== null ? (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-panel px-2 py-1 text-xs shadow-sm"
              style={{ left: `${((hover + 0.5) / n) * 100}%` }}
            >
              <span className="text-muted">{shortDay(hovered.day)}</span> <span className="font-semibold">{format(hovered.value)}</span>
            </div>
          ) : null}
        </div>
      )}
    </figure>
  );
}

function niceCeil(n: number): number {
  if (n <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(n));
  const f = n / pow;
  const step = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return step * pow;
}

/** A thin horizontal meter, e.g. tokens today against the daily limit. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  const tone = ratio >= 1 ? 'bg-bad' : ratio >= 0.8 ? 'bg-warn' : 'bg-accent';
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums">
          {fmtNum(value)} / {max > 0 ? fmtNum(max) : 'без ліміту'}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-sunk" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- health text

type HealthLike = {
  checks: Array<{ key: string; ok: boolean; detail: string | null }>;
  database: { latencyMs: number; error: string | null };
  queues: { pendingGoogleWrites: number; scheduleJobsStuck: number };
  errors24h: { server: number };
};

/** Check rows in plain Ukrainian, built from numbers rather than the server's English detail. */
export function healthChecks(h: HealthLike): Array<{ key: string; ok: boolean; label: string }> {
  return h.checks.map((c) => {
    switch (c.key) {
      case 'database':
        return { key: c.key, ok: c.ok, label: c.ok ? `База даних: ${fmtMs(h.database.latencyMs)}` : 'База даних недоступна' };
      case 'googleQueue':
        return { key: c.key, ok: c.ok, label: `Черга запису в Google: ${fmtNum(h.queues.pendingGoogleWrites)}` };
      case 'stuckJobs':
        return { key: c.key, ok: c.ok, label: `Завислі запуски планувальника: ${fmtNum(h.queues.scheduleJobsStuck)}` };
      case 'serverErrors24h':
        return { key: c.key, ok: c.ok, label: `Помилки 5xx за добу: ${fmtNum(h.errors24h.server)}` };
      default:
        return { key: c.key, ok: c.ok, label: `${c.key}: ${c.detail ?? ''}` };
    }
  });
}
