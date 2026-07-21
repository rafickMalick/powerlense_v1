import { View, Text } from 'react-native';
import { Building2, type LucideIcon } from 'lucide-react-native';
import { palette } from '@/theme/colors';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  className?: string;
}

export function EmptyState({ icon: Icon = Building2, title, subtitle, className = '' }: EmptyStateProps) {
  return (
    <View className={`flex-1 items-center justify-center p-8 ${className}`}>
      <Icon size={48} color={palette.gray400} />
      <Text className="text-text-secondary text-center mt-2">{title}</Text>
      {subtitle && <Text className="text-text-muted text-xs text-center mt-1">{subtitle}</Text>}
    </View>
  );
}
