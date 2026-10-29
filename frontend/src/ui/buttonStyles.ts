export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export const buttonMotion =
    'cursor-pointer transition-[color,background-color,border-color,box-shadow,transform,filter] duration-200 ease-out motion-reduce:transition-none motion-safe:active:scale-[0.98] disabled:active:scale-100 [&_svg]:shrink-0';

export const buttonVariantClass: Record<ButtonVariant, string> = {
    primary:
        'bg-ide-accentBlue text-white shadow-ide hover:brightness-110 hover:shadow-ide-md active:brightness-95',
    secondary:
        'border border-ide-border bg-ide-surface text-ide-text shadow-ide hover:border-ide-link/70 hover:bg-ide-elevated hover:shadow-ide-md',
    danger: 'bg-ide-error text-white shadow-ide hover:brightness-110 hover:shadow-ide-md active:brightness-95',
    ghost: 'text-ide-text hover:bg-ide-text/10',
};

export const buttonPressedClass = 'border border-ide-link bg-ide-selection text-ide-text shadow-none';

export function buttonFocusClass(variant: ButtonVariant): string {
    const color = variant === 'danger' ? 'focus-visible:outline-ide-error' : 'focus-visible:outline-ide-link';
    return `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${color}`;
}
