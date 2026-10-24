import { cx } from './cx';
import { responsiveClasses, textControlSize, type ResponsiveSize } from './controlSize';

export const fieldChrome =
    'rounded-lg border border-ide-border bg-ide-input text-ide-text placeholder:text-ide-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[border-color,box-shadow,background-color] duration-200 ease-out motion-reduce:transition-none focus:border-ide-link focus:outline-none focus:ring-2 focus:ring-ide-link/35 focus:shadow-[0_0_0_3px_rgba(88,157,246,0.16)] disabled:pointer-events-none disabled:opacity-50';

/** `w-*` on `className` replaces the default full width. `max-w-*` does not. */
export function controlWidth(className?: string): string {
    if (className && /(?:^|\s)!?w-/.test(className)) return className;
    return cx('w-full', className);
}

export const fieldErrorChrome =
    'border-ide-error focus:border-ide-error focus:ring-ide-error/40 focus:shadow-[0_0_0_3px_rgba(188,63,60,0.18)]';

export function fieldClassName(options: {
    size?: ResponsiveSize;
    error?: boolean;
    className?: string;
    extra?: string;
}): string {
    return cx(
        fieldChrome,
        responsiveClasses(options.size, textControlSize),
        options.error && fieldErrorChrome,
        options.extra,
        options.className,
    );
}
