/** Colors are CSS variables from src/styles.css so light and dark switch in one place. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: v('paper'),
        panel: v('panel'),
        sunk: v('sunk'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        accent: v('accent'),
        bad: v('bad'),
        warn: v('warn'),
        ok: v('ok'),
      },
      fontFamily: {
        sans: ['Figtree', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
