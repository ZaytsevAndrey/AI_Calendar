import type { CSSProperties } from 'react';
import type { Dictionary } from '@/lib/content';

/**
 * Hero visual: three things said out loud, each turning into what Luefy makes of it
 * (an event, a reminder, a task) with its time. Pure markup + CSS; plays once on load.
 */
export default function CaptureDemo({ demo }: { demo: Dictionary['demo'] }) {
    return (
        <figure className="capture" aria-label={demo.label}>
            <ol className="capture-list">
                {demo.items.map((item, i) => (
                    <li key={item.said} className="capture-item" style={{ '--i': i } as CSSProperties}>
                        <p className="said">
                            <MicIcon />
                            <q>{item.said}</q>
                        </p>
                        <p className={`made made-${item.kind}`}>
                            <span className="made-kind">{demo.kinds[item.kind]}</span>
                            <span className="made-when">{item.result}</span>
                        </p>
                    </li>
                ))}
            </ol>
        </figure>
    );
}

function MicIcon() {
    return (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="mic">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M6 11a6 6 0 0 0 12 0M12 17v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
