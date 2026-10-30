import React from 'react';
import { cx } from './cx';

type Props = {
    checked: boolean;
    onChange: (next: boolean) => void;
    /** Accessible name when there is no visible label tied to it. */
    label?: string;
    id?: string;
    disabled?: boolean;
};

/** On/off switch (`role="switch"`): 44 px tap target on a phone, 36 px from md. */
export function Switch({ checked, onChange, label, id, disabled }: Props) {
    return (
        <button
            id={id}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={label}
            disabled={disabled}
            onClick={() => onChange(!checked)}
            className="group inline-flex h-11 shrink-0 items-center disabled:opacity-50 md:h-9"
        >
            <span
                className={cx(
                    'relative inline-flex h-6 w-10 items-center rounded-full transition-colors',
                    'group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-ide-link',
                    checked ? 'bg-ide-accentBlue' : 'bg-ide-border',
                )}
            >
                <span
                    className={cx(
                        'absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                        checked && 'translate-x-4',
                    )}
                />
            </span>
        </button>
    );
}
