import React from 'react';
import { useTranslation } from 'react-i18next';

export const Spinner: React.FC<{ className?: string }> = ({ className = 'h-8 w-8' }) => {
    const { t } = useTranslation();
    return (
        <div
            className={`inline-block animate-spin rounded-full border-2 border-ide-border border-t-ide-link ${className}`}
            role="status"
            aria-label={t('common.loading')}
        />
    );
};
