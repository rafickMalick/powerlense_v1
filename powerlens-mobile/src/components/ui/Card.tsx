import { View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  className?: string;
}

export function Card({ className = '', ...props }: CardProps) {
  return <View className={`bg-surface rounded-lg border border-border p-4 shadow-card ${className}`} {...props} />;
}
