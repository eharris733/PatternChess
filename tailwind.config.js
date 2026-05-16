export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                bg: '#F4F4F0',
                surface: '#FFFFFF',
                'surface-2': '#1A1A1A',
                'surface-3': '#EEEEE8',
                accent: '#8B6914',
                'accent-light': '#C49B2A',
                'gold-dark': '#8B6914',
                'gold-light': '#C49B2A',
                'text-primary': '#1A1A1A',
                'text-secondary': '#5A5A5A',
                correct: '#1F7A1F',
                incorrect: '#C42820',
                mistake: '#B58300',
                inaccuracy: '#1A6BB8',
                'board-dark': '#C49B2A',
                'board-light': '#F2E4C9',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                serif: ['Georgia', '"Times New Roman"', 'serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
            },
            boxShadow: {
                card: '3px 3px 0 #1A1A1A',
                'card-hover': '1px 1px 0 #1A1A1A',
            },
        },
    },
    plugins: [],
};
