import React from 'react';

declare const __BUILD_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown';
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

const BuildFooter: React.FC = () => {
    const label = BUILD_TIME ? `${BUILD_SHA} · ${BUILD_TIME}` : BUILD_SHA;

    return (
        <footer className="shrink-0 border-t border-ide-border bg-ide-panel px-3 py-1 text-center text-[11px] leading-4 text-ide-muted">
            <span title="Git SHA baked into this frontend bundle">Build {label}</span>
        </footer>
    );
};

export default BuildFooter;
