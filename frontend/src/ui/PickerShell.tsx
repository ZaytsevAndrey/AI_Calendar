import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Popover } from './Popover';
import { useIsPhone } from './useViewport';

type Props = {
    open: boolean;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement>;
    /** Sheet title on a phone and accessible name of the desktop popover. */
    title: string;
    children: React.ReactNode;
    /** Desktop popover width. */
    width?: number;
    /** Phone: optional footer (e.g. «Скинути»). «Готово» is always in the header. */
    phoneFooter?: React.ReactNode;
};

/** A picker opens as an anchored popover on desktop and as a bottom sheet with «Готово» on a phone. */
export function PickerShell({ open, onClose, anchorRef, title, children, width, phoneFooter }: Props) {
    const { t } = useTranslation();
    const phone = useIsPhone();
    if (phone) {
        return (
            <Modal
                open={open}
                onClose={onClose}
                title={title}
                footer={phoneFooter}
                zIndexClass="z-[1450]"
                headerAction={
                    <button
                        type="button"
                        onClick={onClose}
                        className="-mr-2 min-h-11 rounded-control px-3 text-base font-semibold text-ide-link active:bg-ide-surface"
                    >
                        {t('common.done')}
                    </button>
                }
            >
                {children}
            </Modal>
        );
    }
    return (
        <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={width} label={title} className="p-3">
            {children}
        </Popover>
    );
}
