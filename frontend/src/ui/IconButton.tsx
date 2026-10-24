import React from 'react';
import { cx } from './cx';
import { iconControlSize, responsiveClasses, type ResponsiveSize } from './controlSize';
import {
    buttonFocusClass,
    buttonMotion,
    buttonPressedClass,
    buttonVariantClass,
    type ButtonVariant,
} from './buttonStyles';

export type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ResponsiveSize;
    pressed?: boolean;
    label: string;
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
    { variant = 'ghost', size, pressed, label, className, type = 'button', children, ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-label={label}
            aria-pressed={pressed}
            className={cx(
                'inline-flex shrink-0 items-center justify-center rounded-lg',
                buttonMotion,
                buttonFocusClass(variant),
                'disabled:pointer-events-none disabled:opacity-50',
                responsiveClasses(size, iconControlSize, 'sm'),
                pressed ? buttonPressedClass : buttonVariantClass[variant],
                className,
            )}
            {...props}
        >
            {children}
        </button>
    );
});
