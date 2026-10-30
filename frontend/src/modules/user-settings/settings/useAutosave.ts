import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateUserSettingsDTO } from 'api/user-settings.api';
import { useUpdateUserSettingsMutation } from 'api/userSettingsApi';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Patch = UpdateUserSettingsDTO;

const SAVED_VISIBLE_MS = 2500;

/**
 * Every setting saves on its own. `save(key, patch)` writes now; `save(key, patch, ms)` waits until
 * the field is quiet (typing in a number). Each key carries its own status for the «Збережено ✓» mark.
 */
export function useAutosave() {
    const [update] = useUpdateUserSettingsMutation();
    const [status, setStatus] = useState<Record<string, SaveStatus>>({});
    const timers = useRef<Record<string, number>>({});

    useEffect(
        () => () => {
            Object.values(timers.current).forEach((id) => window.clearTimeout(id));
        },
        [],
    );

    const mark = useCallback((key: string, next: SaveStatus) => {
        setStatus((prev) => ({ ...prev, [key]: next }));
        if (next === 'saved') {
            window.clearTimeout(timers.current[`${key}:fade`]);
            timers.current[`${key}:fade`] = window.setTimeout(
                () => setStatus((prev) => (prev[key] === 'saved' ? { ...prev, [key]: 'idle' } : prev)),
                SAVED_VISIBLE_MS,
            );
        }
    }, []);

    const save = useCallback(
        (key: string, patch: Patch, debounceMs = 0): Promise<boolean> => {
            window.clearTimeout(timers.current[key]);
            const run = async () => {
                mark(key, 'saving');
                try {
                    await update(patch).unwrap();
                    mark(key, 'saved');
                    return true;
                } catch {
                    mark(key, 'error');
                    return false;
                }
            };
            if (!debounceMs) return run();
            return new Promise((resolve) => {
                timers.current[key] = window.setTimeout(() => void run().then(resolve), debounceMs);
            });
        },
        [mark, update],
    );

    return { save, status: (key: string): SaveStatus => status[key] ?? 'idle' };
}
