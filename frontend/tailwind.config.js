/** Channels come from the active palette in `src/theme/themeColors.ts`. */
function ide(name) {
    return `rgb(var(--ide-${name}) / <alpha-value>)`;
}

/** @type {import('tailwindcss').Config} */
export default {
    content: ['./public/index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                ide: {
                    bg: ide('bg'),
                    panel: ide('panel'),
                    surface: ide('surface'),
                    elevated: ide('elevated'),
                    border: ide('border'),
                    line: ide('line'),
                    text: ide('text'),
                    muted: ide('muted'),
                    dim: ide('dim'),
                    link: ide('link'),
                    accent: ide('accent'),
                    accentBlue: ide('accentBlue'),
                    keyword: ide('keyword'),
                    error: ide('error'),
                    warn: ide('warn'),
                    selection: ide('selection'),
                    input: ide('input'),
                    subtle: ide('subtle'),
                    overlay: ide('overlay'),
                    successTint: ide('successTint'),
                    warnTint: ide('warnTint'),
                    errorTint: ide('errorTint'),
                    errorFill: ide('errorFill'),
                },
                /* Semantic names from documentation/design/design-system.md (same channels as ide-*). */
                canvas: ide('bg'),
                surface: ide('panel'),
                raised: ide('elevated'),
                brand: { DEFAULT: ide('link'), fill: ide('accentBlue'), tint: ide('selection') },
                success: { DEFAULT: ide('accent'), tint: ide('successTint') },
                warning: { DEFAULT: ide('warn'), tint: ide('warnTint') },
                danger: { DEFAULT: ide('error'), fill: ide('errorFill'), tint: ide('errorTint') },
                fg: { DEFAULT: ide('text'), muted: ide('muted'), subtle: ide('subtle') },
                stroke: ide('border'),
            },
            fontFamily: {
                sans: [
                    'Onest Variable',
                    'Onest',
                    'ui-sans-serif',
                    'system-ui',
                    '-apple-system',
                    'Segoe UI',
                    'Helvetica Neue',
                    'Helvetica',
                    'Arial',
                    'system-ui',
                    'sans-serif',
                ],
            },
            borderRadius: {
                chip: '6px',
                control: '10px',
                sheet: '16px',
            },
            fontSize: {
                caption: ['12px', { lineHeight: '16px' }],
                'body-sm': ['13px', { lineHeight: '20px' }],
                body: ['15px', { lineHeight: '22px' }],
                heading: ['16px', { lineHeight: '24px' }],
                title: ['20px', { lineHeight: '28px' }],
                display: ['28px', { lineHeight: '34px' }],
            },
            boxShadow: {
                ide: 'var(--ide-shadow)',
                'ide-md': 'var(--ide-shadow-md)',
            },
        },
    },
    plugins: [],
};
