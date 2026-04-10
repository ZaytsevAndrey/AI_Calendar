import React from 'react';

export const Spinner: React.FC<{ className?: string }> = ({ className = 'h-8 w-8' }) => (
    <div
        className={`inline-block animate-spin rounded-full border-2 border-ide-border border-t-ide-link ${className}`}
        role="status"
        aria-label="Loading"
    />
);
