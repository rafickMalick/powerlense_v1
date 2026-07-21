import { View, Text } from 'react-native';

export type BadgeVariant = 'default' | 'secondary' | 'outline';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  textClassName?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  default: 'bg-primary border-transparent',
  secondary: 'bg-surface-secondary border-transparent',
  outline: 'bg-transparent border border-border',
};

const TEXT_STYLES: Record<BadgeVariant, string> = {
  default: 'text-white',
  secondary: 'text-text-secondary',
  outline: 'text-text-primary',
};

export function Badge({ children, variant = 'default', className = '', textClassName = '' }: BadgeProps) {
  return (
    <View className={`flex-row items-center gap-1 px-2 py-0.5 rounded ${VARIANT_STYLES[variant]} ${className}`}>
      {typeof children === 'string' ? (
        <Text className={`text-xs font-medium ${TEXT_STYLES[variant]} ${textClassName}`}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}
