import React from 'react';
import { buildLabel } from '../buildInfo';

const BuildFooter: React.FC = () => {
    const label = buildLabel();

    return (
        <footer className="hidden shrink-0 border-t border-ide-border bg-ide-panel px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 text-center text-[11px] leading-4 text-ide-muted md:block">
            <span title="Git SHA baked into this frontend bundle">Build {label}</span>
        </footer>
    );
};

export default BuildFooter;
