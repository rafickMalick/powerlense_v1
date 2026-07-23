/**
 * Les couleurs pointent vers les variables CSS définies dans src/theme/global.css
 * (`:root` = clair, `.dark` = sombre). Conséquence : basculer la classe `dark`
 * repeint toute l'application sans toucher au moindre écran. La syntaxe
 * `rgb(var(--x) / <alpha-value>)` conserve le support des opacités Tailwind
 * (ex. `bg-primary/10`).
 */
const themed = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['SpaceMono', 'monospace'],
        sans: ['Inter-Regular', 'sans-serif'],
      },
      colors: {
        primary: themed('--c-primary'),
        'primary-hover': themed('--c-primary-hover'),
        'primary-tint': themed('--c-primary-tint'),
        surface: themed('--c-surface'),
        'surface-alt': themed('--c-surface-alt'),
        'surface-secondary': themed('--c-surface-secondary'),
        background: themed('--c-bg'),
        border: themed('--c-border'),
        'text-primary': themed('--c-text-primary'),
        'text-secondary': themed('--c-text-secondary'),
        'text-muted': themed('--c-text-muted'),
        success: themed('--c-success'),
        'success-tint': themed('--c-success-tint'),
        warning: themed('--c-warning'),
        'warning-tint': themed('--c-warning-tint'),
        danger: themed('--c-danger'),
        'danger-tint': themed('--c-danger-tint'),
        info: themed('--c-info'),
      },
      borderRadius: {
        // Handoff : boutons/CTA 10-12px, cartes 14-20px
        DEFAULT: '12px',
        card: '16px',
        cta: '12px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(33,31,26,0.04), 0 1px 3px rgba(33,31,26,0.03)',
        elevated: '0 4px 12px rgba(33,31,26,0.10), 0 2px 4px rgba(33,31,26,0.06)',
        // Ombre du CTA primaire, telle que spécifiée dans le handoff
        cta: '0 8px 24px -8px rgba(37,99,235,0.5)',
      },
    },
  },
  plugins: [],
};
