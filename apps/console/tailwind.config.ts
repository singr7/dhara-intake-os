import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
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
    },
  },
  plugins: [],
} satisfies Config;
