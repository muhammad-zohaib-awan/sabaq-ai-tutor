import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#070f1c',
          850: '#0b1526',
          800: '#0f1c30',
          700: '#152439',
          600: '#1d3150',
          500: '#2a4468',
        },
        accent: {
          DEFAULT: '#3d8bfd',
          soft: '#5fa3ff',
          deep: '#1e5fd0',
        },
        good: '#34d399',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        urdu: ['var(--font-urdu)', 'Noto Nastaliq Urdu', 'serif'],
      },
      keyframes: {
        popIn: { '0%': { transform: 'scale(.85)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        riseFade: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        xpFloat: { '0%': { transform: 'translateY(0)', opacity: '1' }, '100%': { transform: 'translateY(-38px)', opacity: '0' } },
        sweep: { '0%': { strokeDashoffset: '1200' }, '100%': { strokeDashoffset: '0' } },
        shimmer: { '0%,100%': { opacity: '.55' }, '50%': { opacity: '1' } },
      },
      animation: {
        popIn: 'popIn .28s cubic-bezier(.2,.9,.3,1.2)',
        riseFade: 'riseFade .3s ease-out',
        xpFloat: 'xpFloat 1.1s ease-out forwards',
        sweep: 'sweep 2.4s linear infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
export default config;
