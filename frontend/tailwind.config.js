/** @type {import('tailwindcss').Config} */
export default {
    content: ['./public/index.html', './src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                ide: {
                    bg: '#2B2B2B',
                    panel: '#3C3F41',
                    surface: '#323232',
                    elevated: '#45494A',
                    border: '#515151',
                    line: '#313335',
                    text: '#A9B7C6',
                    muted: '#808080',
                    dim: '#6A8759',
                    link: '#589DF6',
                    accent: '#4E9F4E',
                    accentBlue: '#287BDE',
                    keyword: '#CC7832',
                    error: '#BC3F3C',
                    warn: '#BBB529',
                    selection: '#214283',
                    input: '#45494A',
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
                ide: '0 1px 3px rgba(0,0,0,0.45)',
                'ide-md': '0 4px 12px rgba(0,0,0,0.5)',
            },
        },
    },
    plugins: [],
};
