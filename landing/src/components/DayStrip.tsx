import type { CSSProperties } from 'react';
import type { Dictionary } from '@/lib/content';

const DAY_START = 7 * 60;
const DAY_END = 22 * 60;
const SPAN = DAY_END - DAY_START;

function toMin(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
const pct = (min: number) => `${(((min - DAY_START) / SPAN) * 100).toFixed(3)}%`;
const len = (from: string, to: string) => `${(((toMin(to) - toMin(from)) / SPAN) * 100).toFixed(3)}%`;

const HOURS = [7, 9, 11, 13, 15, 17, 19, 21];

/**
 * The hero visual: one day, split into phases, with tasks placed into free slots.
 * Pure markup + CSS (no client JS). Tasks settle into place once on load.
 */
export default function DayStrip({ strip }: { strip: Dictionary['strip'] }) {
    return (
        <figure className="day" aria-label={strip.label}>
            <div className="day-grid">
                <ol className="day-hours" aria-hidden="true">
                    {HOURS.map((h) => (
                        <li key={h} style={{ top: pct(h * 60) }}>
                            {String(h).padStart(2, '0')}:00
                        </li>
                    ))}
                </ol>
                <div className="day-track">
                    {strip.phases.map((p) => (
                        <div
                            key={p.key}
                            className={`phase phase-${p.key}`}
                            style={{ top: pct(toMin(p.from)), height: len(p.from, p.to) }}
                        >
                            <span className="phase-name">{p.name}</span>
                        </div>
                    ))}
                    <ul className="tasks">
                        {strip.tasks.map((task, i) => (
                            <li
                                key={task.name}
                                className={task.fixed ? 'task task-fixed' : 'task'}
                                style={
                                    {
                                        top: pct(toMin(task.from)),
                                        height: `calc(${len(task.from, task.to)} - 3px)`,
                                        '--i': i,
                                    } as CSSProperties
                                }
                            >
                                <span className="task-name">{task.name}</span>
                                <span className="task-time">
                                    <time>{task.from}</time>–<time>{task.to}</time>
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <figcaption className="day-caption">{strip.caption}</figcaption>
        </figure>
    );
}
