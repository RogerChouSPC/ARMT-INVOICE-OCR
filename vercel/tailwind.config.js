/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
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
        google: ['Google Sans', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(60,64,67,.3), 0 4px 8px 3px rgba(60,64,67,.15)',
        'card-hover': '0 1px 2px 0 rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)',
        button: '0 1px 2px 0 rgba(60,64,67,.3)',
      },
      animation: {
        'spin-slow': 'spin 2s linear infinite',
        'fade-in': 'fadeIn .2s ease-out',
        'slide-up': 'slideUp .3s ease-out',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
