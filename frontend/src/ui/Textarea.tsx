import React from 'react';
import { cx } from './cx';
import { areaControlSize, responsiveClasses, type ResponsiveSize } from './controlSize';
import { controlWidth, fieldChrome, fieldErrorChrome } from './fieldChrome';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    size?: ResponsiveSize;
    error?: boolean;
};

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
    { size, error, className, ...props },
    ref,
) {
    return (
        <textarea
            ref={ref}
            data-ui-control=""
            className={cx(
                fieldChrome,
                'resize-y',
                responsiveClasses(size, areaControlSize),
                error && fieldErrorChrome,
                controlWidth(className),
            )}
            {...props}
        />
    );
});
