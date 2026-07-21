/**
 * Source unique de vérité pour les couleurs de marque — réexportée à la fois
 * par `tailwind.config.js` (classes NativeWind) et `src/theme/colors.ts`
 * (call sites qui ne peuvent pas utiliser `className` : SVG, Three.js,
 * react-native-gifted-charts, styles inline).
 */
export const palette = {
  navy700: '#1E40AF', // primaire (boutons, nav active, liens)
  navy600: '#2563EB', // hover/pressed
  navy50: '#EFF6FF', // fond teinté primaire (chips sélectionnées, bannières info)

  white: '#FFFFFF',
  gray50: '#F8FAFC', // fond app
  gray100: '#F1F5F9', // surface secondaire
  gray200: '#E2E8F0', // bordures
  gray400: '#94A3B8', // icônes / séparateurs uniquement (échoue le contraste AA en texte)
  gray500: '#64748B', // texte secondaire (contraste AA sur fond clair)
  gray900: '#0F172A', // texte primaire

  success: '#10B981',
  successTint: '#ECFDF5',
  warning: '#F97316',
  warningTint: '#FFF7ED',
  danger: '#EF4444',
  dangerTint: '#FEF2F2',
  info: '#0EA5E9',
} as const;

export type PaletteColor = keyof typeof palette;
