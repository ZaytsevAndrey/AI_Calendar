import React from 'react';

export type ModalProps = {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidthClass?: string;
};

export const Modal: React.FC<ModalProps> = ({
    open,
    onClose,
    title,
    children,
    footer,
    maxWidthClass = 'max-w-lg',
}) => {
    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[1300] flex items-end justify-center p-0 sm:items-center sm:p-4">
            <button
                type="button"
                className="absolute inset-0 bg-black/60"
                aria-label="Close modal"
                onClick={onClose}
            />
            <div
                role="dialog"
                aria-modal="true"
                className={`relative z-10 flex max-h-[92dvh] w-full ${maxWidthClass} flex-col rounded-t-2xl border border-ide-border bg-ide-panel shadow-ide-md sm:max-h-[90vh] sm:rounded-2xl`}
            >
                {title ? (
                    <div className="border-b border-ide-border px-4 py-3 text-lg font-semibold text-ide-text">
                        {title}
                    </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto p-4 text-ide-text sm:p-5">{children}</div>
                {footer ? (
                    <div className="flex flex-shrink-0 flex-col-reverse gap-2 border-t border-ide-border p-4 sm:flex-row sm:justify-end sm:p-4">
                        {footer}
                    </div>
                ) : null}
            </div>
        </div>
    );
};
