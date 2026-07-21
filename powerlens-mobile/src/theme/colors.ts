import { palette } from './palette';

export { palette };

/** Interpolation faible → normal → élevé → critique, utilisée par le jumeau numérique et les graphiques. */
export function ratioToColor(ratio: number): string {
  if (ratio < 0.3) return palette.info;
  if (ratio < 0.55) return palette.success;
  if (ratio < 0.75) return palette.warning;
  return palette.danger;
}

export const RATIO_LEGEND = [
  { color: palette.info, label: 'Faible (< 30%)' },
  { color: palette.success, label: 'Normal (30–55%)' },
  { color: palette.warning, label: 'Élevé (55–75%)' },
  { color: palette.danger, label: 'Critique (> 75%)' },
] as const;
