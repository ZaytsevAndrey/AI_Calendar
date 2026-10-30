import { useEffect, useRef } from 'react';

const FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Dialogs open on top of each other; only the top one reacts to Escape and Tab. */
const stack: HTMLElement[] = [];

/**
 * Focus the dialog on open, keep Tab inside it, close on Escape, and give focus back on close.
 * `initialFocus` picks the first element to focus (default: the first field, otherwise the dialog).
 */
export function useDialogFocus(
    open: boolean,
    ref: React.RefObject<HTMLElement>,
    onClose: () => void,
    options: { initialFocus?: 'first-field' | 'dialog' } = {},
) {
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(() => {
        if (!open) return;
        const node = ref.current;
        if (!node) return;
        const previous = document.activeElement as HTMLElement | null;
        stack.push(node);

        const focusInitial = () => {
            if (node.contains(document.activeElement)) return;
            const field =
                options.initialFocus === 'dialog'
                    ? null
                    : node.querySelector<HTMLElement>('[data-autofocus],input:not([type="hidden"]):not([disabled]),textarea,select');
            (field ?? node).focus({ preventScroll: true });
        };
        const raf = requestAnimationFrame(focusInitial);

        const onKey = (event: KeyboardEvent) => {
            if (stack[stack.length - 1] !== node) return;
            if (event.key === 'Escape') {
                // An open popover inside the dialog (date picker, menu) closes first.
                if (document.querySelector('[data-popover="open"]')) return;
                event.stopPropagation();
                closeRef.current();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
                (el) => el.offsetParent !== null || el === document.activeElement,
            );
            if (!items.length) {
                event.preventDefault();
                node.focus();
                return;
            }
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);

        return () => {
            cancelAnimationFrame(raf);
            document.removeEventListener('keydown', onKey, true);
            const index = stack.lastIndexOf(node);
            if (index >= 0) stack.splice(index, 1);
            if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);
}
