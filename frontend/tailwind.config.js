/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        forge: {
          950: '#06080d',
          900: '#0a0d14',
          850: '#0f141d',
          800: '#141a26',
          750: '#1a2232',
          700: '#222b3e',
          600: '#2f3c54',
          500: '#475878',
          400: '#7a8ba8',
          300: '#a3b2cd',
          200: '#cbd5e1',
          100: '#e2e8f0',
          50: '#f8fafc',
        },
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
      },
      boxShadow: {
        'glow-emerald': '0 0 24px -4px rgba(16, 185, 129, 0.22)',
        'glow-rose': '0 0 24px -4px rgba(244, 63, 94, 0.22)',
        'glow-amber': '0 0 24px -4px rgba(245, 158, 11, 0.22)',
        'subtle': '0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 1px 3px 1px rgba(0, 0, 0, 0.3)',
      },
      borderColor: {
        subtle: 'rgba(255, 255, 255, 0.07)',
        muted: 'rgba(255, 255, 255, 0.12)',
        emphasis: 'rgba(255, 255, 255, 0.2)',
      },
    },
  },
  plugins: [],
}
