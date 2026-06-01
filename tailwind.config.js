const rgbVar = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
    content: ['./index.html', './src/**/*.{ts,tsx}'],
    theme: {
        extend: {
            colors: {
                bg: rgbVar('--bg'),
                surface: rgbVar('--surface'),
                'surface-2': rgbVar('--surface-2'),
                'surface-3': rgbVar('--surface-3'),
                accent: rgbVar('--accent'),
                'accent-light': rgbVar('--accent-light'),
                'gold-dark': rgbVar('--gold-dark'),
                'gold-light': rgbVar('--gold-light'),
                'text-primary': rgbVar('--text-primary'),
                'text-secondary': rgbVar('--text-secondary'),
                'board-light': rgbVar('--board-light-rgb'),
                'board-dark': rgbVar('--board-dark-rgb'),
                // Feedback colors stay constant across themes.
                correct: '#1F7A1F',
                incorrect: '#C42820',
                mistake: '#B58300',
                inaccuracy: '#1A6BB8',
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                serif: ['Georgia', '"Times New Roman"', 'serif'],
                mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
            },
            boxShadow: {
                card: '3px 3px 0 rgb(var(--text-primary))',
                'card-hover': '1px 1px 0 rgb(var(--text-primary))',
            },
        },
    },
    plugins: [],
};
