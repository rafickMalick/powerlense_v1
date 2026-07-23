/**
 * Couleurs de marque pour les call sites qui ne peuvent PAS utiliser `className`
 * (icônes lucide, SVG, Three.js, react-native-gifted-charts, styles inline).
 *
 * Valeurs alignées sur les tokens "Application" du handoff de design (palette
 * crème chaude + accent bleu). Les noms de clés sont volontairement conservés
 * (`navy700`, `gray500`…) pour ne pas casser les dizaines de call sites : seules
 * les VALEURS ont changé, ce qui repeint l'ensemble de l'app d'un coup.
 *
 * Pour tout ce qui passe par `className`, ce sont les variables CSS de
 * `global.css` qui font foi (et qui gèrent le mode sombre automatiquement).
 */
const paletteLight = {
  navy700: '#2563EB', // accent primaire (boutons, nav active, liens)
  navy600: '#1D4ED8', // hover/pressed
  navy50: '#E8F1FE', // fond teinté primaire (chips sélectionnées, bannières info)

  white: '#FDFDFC', // surface (cartes, rail)
  gray50: '#FAFAF8', // fond app (crème)
  gray100: '#F3F1EB', // chip / surface secondaire
  gray200: '#F0EEE7', // hairline (bordures)
  gray400: '#A6A18F', // icônes / séparateurs (contraste insuffisant pour du texte)
  gray500: '#8A8574', // texte secondaire
  gray900: '#211F1A', // texte primaire (encre)

  success: '#10B981',
  successTint: '#ECFDF5',
  warning: '#EA580C', // orange "four/chauffage" du handoff
  warningTint: '#FEF0E8',
  danger: '#DC2626',
  dangerTint: '#FEF0EE',
  info: '#2563EB',
} as const;

/**
 * Équivalents en mode sombre — mêmes clés, valeurs adaptées. Utilisé par les
 * call sites hors `className` via `useThemeColors()` (cf. src/theme/useTheme.ts).
 */
const paletteDarkValues = {
  navy700: '#5B9CFF',
  navy600: '#7DB0FF',
  navy50: '#1E3052',

  white: '#1C1911',
  gray50: '#17140F',
  gray100: '#242019',
  gray200: '#2E2A21',
  gray400: '#8A8574',
  gray500: '#A69C8A',
  gray900: '#F5F1E8',

  success: '#34D399',
  successTint: '#18332B',
  warning: '#FB923C',
  warningTint: '#3D2614',
  danger: '#F87171',
  dangerTint: '#3F1A1A',
  info: '#5B9CFF',
} as const;

export type PaletteColor = keyof typeof paletteLight;

/** Mode courant — piloté par le store de thème (src/theme/useTheme.ts). */
let currentMode: 'light' | 'dark' = 'light';

/** Appelé par le store de thème à chaque bascule. */
export function setPaletteMode(mode: 'light' | 'dark') {
  currentMode = mode;
}

/**
 * Palette DYNAMIQUE : chaque couleur est un getter qui renvoie la valeur du
 * thème courant. Conséquence : les ~200 `palette.xxx` déjà présents dans les
 * écrans (couleurs d'icônes lucide, SVG, graphiques) suivent automatiquement le
 * mode sombre, sans avoir à modifier un seul écran.
 *
 * ⚠️ Une valeur lue AU NIVEAU MODULE (constante hors composant) est figée à
 * l'import et ne suivra pas le thème — utiliser `useThemeColors()` dans ces cas.
 */
export const palette = {} as Record<PaletteColor, string>;

for (const key of Object.keys(paletteLight) as PaletteColor[]) {
  Object.defineProperty(palette, key, {
    get: () => (currentMode === 'dark' ? paletteDarkValues[key] : paletteLight[key]),
    enumerable: true,
  });
}

/** Palette sombre brute — pour les rares call sites qui la veulent explicitement. */
export const paletteDark = paletteDarkValues;
