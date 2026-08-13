/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1020',
        dhara: {
          50: '#eef7f6',
          200: '#a9dbd6',
          500: '#189c92',
          700: '#0f6d66',
        },
      },
      // Kiosk/low-end-phone defaults: nothing below 48px is tappable (doc 02 §3.2).
      minHeight: { tap: '48px' },
      minWidth: { tap: '48px' },
    },
  },
  plugins: [],
};
