import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#1A1A1A',
        surface: '#2A2A2A',
        'surface-2': '#3A3A3A',
        accent: '#8B6914',
        'accent-light': '#C49B2A',
        'gold-dark': '#8B6914',
        'gold-light': '#C49B2A',
        'text-primary': '#E8E8E8',
        'text-secondary': '#9E9E9E',
        correct: '#4CAF50',
        incorrect: '#F44336',
        mistake: '#FFC107',
        inaccuracy: '#42A5F5',
        'board-dark': '#6B4226',
        'board-light': '#D4A76A',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Georgia', '"Times New Roman"', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
} satisfies Config;
