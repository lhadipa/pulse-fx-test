/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Verde e vermelho de alta/baixa com contraste suficiente sobre o
        // fundo escuro. Cor NUNCA e o unico sinal: os componentes tambem
        // trazem seta e sinal aritmetico.
        up: '#22c55e',
        down: '#ef4444',
        flat: '#94a3b8',
      },
    },
  },
  plugins: [],
};
