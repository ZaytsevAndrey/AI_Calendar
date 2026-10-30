/** `danger` is a text button (list and footer deletes); `dangerSolid` is only the confirm button of a delete dialog. */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid' | 'ghost';

export const buttonMotion =
    'cursor-pointer transition-[color,background-color,border-color,box-shadow,transform,filter] duration-200 ease-out motion-reduce:transition-none motion-safe:active:scale-[0.98] disabled:active:scale-100 [&_svg]:shrink-0';

export const buttonVariantClass: Record<ButtonVariant, string> = {
    primary: 'bg-ide-accentBlue text-white hover:brightness-110 active:brightness-95',
    secondary:
        'border border-ide-border bg-ide-panel text-ide-text hover:border-ide-link/60 hover:bg-ide-surface',
    danger: 'text-ide-error hover:bg-ide-errorTint',
    dangerSolid: 'bg-ide-errorFill text-white hover:brightness-110 active:brightness-95',
    ghost: 'text-ide-muted hover:bg-ide-text/5 hover:text-ide-text',
};

export const buttonPressedClass = 'border border-ide-link bg-ide-selection text-ide-link';

export function buttonFocusClass(variant: ButtonVariant): string {
    const color =
        variant === 'danger' || variant === 'dangerSolid' ? 'focus-visible:outline-ide-error' : 'focus-visible:outline-ide-link';
    return `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${color}`;
}
