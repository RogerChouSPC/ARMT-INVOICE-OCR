/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:      '#0C0B09',
        surface:  '#141310',
        surface2: '#1C1A17',
        border:   '#2A2824',
        cream:    '#E8E2D9',
        muted:    '#8A8178',
        faint:    '#4A4640',
        gold:     '#C9A84C',
        'gold-light': '#E5C878',
        'gold-dim':   '#7A6428',
        danger:  '#C0392B',
        success: '#2E7D5E',
        google: {
          blue: '#1a73e8',
          'blue-dark': '#1557b0',
          'blue-light': '#e8f0fe',
          red: '#ea4335',
          green: '#34a853',
          yellow: '#fbbc04',
        },
      },
      fontFamily: {
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono:    ['"IBM Plex Mono"', 'monospace'],
        google:  ['"Google Sans"', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card:         '0 1px 3px 0 rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)',
        'card-hover': '0 1px 2px 0 rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)',
        button:       '0 1px 2px 0 rgba(60,64,67,.3)',
        atelier:      '0 0 0 1px rgba(201,168,76,0.12), 0 4px 32px rgba(0,0,0,0.5)',
        'atelier-up': '0 0 0 1px rgba(201,168,76,0.3), 0 8px 40px rgba(0,0,0,0.65)',
        'gold-glow':  '0 0 24px rgba(201,168,76,0.18)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'fade-in':   'fadeIn .3s ease-out',
        'slide-up':  'slideUp .4s ease-out',
        'reveal':    'reveal .9s cubic-bezier(0.16,1,0.3,1) both',
        'shimmer':   'shimmer 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        reveal:  { from: { opacity: '0', transform: 'translateY(24px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '0%,100%': { opacity: '0.4' }, '50%': { opacity: '1' } },
      },
    },
  },
  plugins: [],
}
