import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from 'ui/IconButton';
import { useTheme } from './ThemeProvider';

export function ThemeToggle() {
    const { t } = useTranslation();
    const { theme, setTheme } = useTheme();
    const next = theme === 'dark' ? 'light' : 'dark';
    const Icon = theme === 'dark' ? Sun : Moon;

    return (
        <IconButton
            label={theme === 'dark' ? t('settings.themeToggleToLight') : t('settings.themeToggleToDark')}
            size="sm"
            onClick={() => setTheme(next)}
        >
            <Icon className="h-4 w-4" aria-hidden />
        </IconButton>
    );
}
