/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx}', './content/**/*.{html,js}'],
  theme: {
    extend: {
      opacity: { 8: '0.08' },
      colors: {
        brand: {
          black: '#0A0A0A',
          charcoal: '#1A1A1A',
          yellow: '#FFCC00',
          white: '#FFFFFF',
          gray: '#F5F5F5',
          border: '#E4E4E4',
          borderGray: '#E5E7EB',
        },
      },
    },
  },
  // HTML mein & escape hota hai, isliye ye class alag se add ki
  safelist: ['[&_summary::-webkit-details-marker]:hidden'],
  plugins: [],
};
