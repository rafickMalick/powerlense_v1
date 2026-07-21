const { palette } = require('./src/theme/palette');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        mono: ['SpaceMono', 'monospace'],
        sans: ['Inter-Regular', 'sans-serif'],
      },
      colors: {
        primary: palette.navy700,
        'primary-hover': palette.navy600,
        'primary-tint': palette.navy50,
        surface: palette.white,
        'surface-alt': palette.gray50,
        'surface-secondary': palette.gray100,
        border: palette.gray200,
        'text-primary': palette.gray900,
        'text-secondary': palette.gray500,
        'text-muted': palette.gray400,
        success: palette.success,
        'success-tint': palette.successTint,
        warning: palette.warning,
        'warning-tint': palette.warningTint,
        danger: palette.danger,
        'danger-tint': palette.dangerTint,
        info: palette.info,
      },
      boxShadow: {
        card: '0 1px 2px rgba(15,23,42,0.06), 0 1px 3px rgba(15,23,42,0.04)',
        elevated: '0 4px 12px rgba(15,23,42,0.12), 0 2px 4px rgba(15,23,42,0.08)',
      },
    },
  },
  plugins: [],
};
