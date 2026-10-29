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
                },
            },
            fontFamily: {
                sans: [
                    'Segoe UI',
                    'Helvetica Neue',
                    'Helvetica',
                    'Arial',
                    'system-ui',
                    'sans-serif',
                ],
            },
            boxShadow: {
                ide: 'var(--ide-shadow)',
                'ide-md': 'var(--ide-shadow-md)',
            },
        },
    },
    plugins: [],
};
