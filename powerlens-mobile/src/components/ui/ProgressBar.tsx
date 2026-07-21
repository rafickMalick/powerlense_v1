import { View } from 'react-native';

interface ProgressBarProps {
  percent: number;
  className?: string;
  barClassName?: string;
}

export function ProgressBar({ percent, className = '', barClassName = 'bg-primary' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));

  return (
    <View className={`w-full bg-surface-secondary rounded-full h-2 overflow-hidden ${className}`}>
      <View className={`h-2 rounded-full ${barClassName}`} style={{ width: `${clamped}%` }} />
    </View>
  );
}
