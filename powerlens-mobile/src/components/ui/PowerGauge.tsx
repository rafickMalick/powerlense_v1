import { View, Text } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { palette } from '@/theme/colors';

interface PowerGaugeProps {
  /** Puissance instantanée, en watts. */
  watts: number;
  /** Puissance considérée comme « pleine échelle » (fin de la jauge). */
  maxWatts?: number;
  /** Légende sous la valeur (ex. « +12 % vs moyenne »). */
  caption?: string;
  size?: number;
}

/**
 * Jauge circulaire de puissance — élément central du tableau de bord
 * (maquette « Tableau de bord » du handoff) : un cercle de fond et un cercle de
 * progression dont le remplissage est piloté par `stroke-dasharray`.
 */
export function PowerGauge({
  watts,
  maxWatts = 5000,
  caption,
  size = 190,
}: PowerGaugeProps) {
  const stroke = 14;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = Math.max(0, Math.min(1, watts / maxWatts));
  const dash = circumference * ratio;

  // La couleur suit le niveau de charge (vert → orange → rouge).
  const color =
    ratio < 0.55 ? palette.success : ratio < 0.8 ? palette.warning : palette.danger;

  const kw = watts / 1000;
  const display = kw >= 1 ? `${kw.toFixed(1)}` : `${Math.round(watts)}`;
  const unit = kw >= 1 ? 'kW' : 'W';

  return (
    <View className="items-center justify-center" style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Cercle de fond */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={palette.gray200}
          strokeWidth={stroke}
          fill="none"
        />
        {/* Cercle de progression — démarre en haut (rotation -90°) */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      {/* Valeur centrée par-dessus le SVG */}
      <View className="absolute items-center justify-center">
        <View className="flex-row items-baseline">
          <Text className="text-4xl font-bold text-text-primary">{display}</Text>
          <Text className="text-base text-text-secondary ml-1">{unit}</Text>
        </View>
        <Text className="text-xs text-text-secondary mt-1">Puissance actuelle</Text>
        {!!caption && <Text className="text-xs text-text-muted mt-0.5">{caption}</Text>}
      </View>
    </View>
  );
}
