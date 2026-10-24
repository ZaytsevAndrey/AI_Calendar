import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';
import { fieldIconSize, fieldTrailingPad, responsiveClasses, type ResponsiveSize } from './controlSize';
import { controlWidth, fieldClassName } from './fieldChrome';

export type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
    size?: ResponsiveSize;
    error?: boolean;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
    { size, error, className, children, ...props },
    ref,
) {
    return (
        <div className={cx('group relative', controlWidth(className))}>
            <select
                ref={ref}
                data-ui-control=""
                className={fieldClassName({
                    size,
                    error,
                    extra: cx('cursor-pointer appearance-none', responsiveClasses(size, fieldTrailingPad)),
                    className: 'w-full',
                })}
                {...props}
            >
                {children}
            </select>
            <ChevronDown
                aria-hidden
                className={cx(
                    'pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ide-muted',
                    'transition-[color,transform] duration-200 ease-out motion-reduce:transition-none',
                    'group-focus-within:text-ide-link motion-safe:group-focus-within:rotate-180',
                    responsiveClasses(size, fieldIconSize),
                )}
            />
        </div>
    );
});
