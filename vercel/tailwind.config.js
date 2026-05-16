/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        border: 'hsl(var(--border))',
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // kept for existing components (google.* → resolved to same CSS vars)
        google: {
          blue: 'hsl(var(--primary))',
          'blue-dark': '#1557b0',
          'blue-light': 'hsl(var(--muted))',
          red: 'hsl(var(--destructive))',
          green: '#34a853',
          yellow: '#fbbc04',
        },
      },
      fontFamily: {
        sans:   ['Inter', 'system-ui', 'sans-serif'],
        google: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(60,64,67,.08), 0 4px 8px 3px rgba(60,64,67,.06)',
        'card-hover': '0 1px 2px 0 rgba(60,64,67,.1), 0 6px 16px 4px rgba(60,64,67,.1)',
        button: '0 1px 2px 0 rgba(60,64,67,.2)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'fade-in':  'fadeIn .2s ease-out',
        'slide-up': 'slideUp .3s ease-out',
      },
      keyframes: {
        fadeIn:  { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
