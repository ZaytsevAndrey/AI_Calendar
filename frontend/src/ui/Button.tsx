import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from './cx';
import { buttonGlyphSize, responsiveClasses, textControlSize, type ResponsiveSize } from './controlSize';
import {
    buttonFocusClass,
    buttonMotion,
    buttonPressedClass,
    buttonVariantClass,
    type ButtonVariant,
} from './buttonStyles';

export type { ButtonVariant };

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ResponsiveSize;
    /** Toggle buttons. Omitting it leaves `aria-pressed` unset. */
    pressed?: boolean;
    /** Lucide icon drawn before the label. */
    icon?: LucideIcon;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'primary', size, pressed, icon: Icon, className, type = 'button', children, ...props },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-pressed={pressed}
            className={cx(
                'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
                buttonMotion,
                buttonFocusClass(variant),
                'disabled:pointer-events-none disabled:opacity-50',
                responsiveClasses(size, textControlSize),
                responsiveClasses(size, buttonGlyphSize),
                pressed ? buttonPressedClass : buttonVariantClass[variant],
                className,
            )}
            {...props}
        >
            {Icon ? <Icon aria-hidden /> : null}
            {children}
        </button>
    );
});
