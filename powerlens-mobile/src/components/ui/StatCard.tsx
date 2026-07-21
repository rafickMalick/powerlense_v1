import { View, Text } from 'react-native';
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react-native';
import { palette } from '@/theme/colors';
import { Card } from './Card';

interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  iconColor?: string;
  valueClassName?: string;
  trend?: { direction: 'up' | 'down'; label: string };
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  iconColor = palette.gray400,
  valueClassName = 'text-text-primary',
  trend,
  className = '',
}: StatCardProps) {
  const TrendIcon = trend?.direction === 'down' ? TrendingDown : TrendingUp;
  const trendColor = trend?.direction === 'down' ? 'text-success' : 'text-danger';

  return (
    <Card className={className}>
      {Icon && (
        <View className="flex-row items-center gap-2 mb-2">
          <Icon size={16} color={iconColor} />
          <Text className="text-xs text-text-secondary">{label}</Text>
        </View>
      )}
      {!Icon && <Text className="text-xs text-text-secondary mb-1">{label}</Text>}
      <Text className={`text-2xl font-mono font-bold ${valueClassName}`}>{value}</Text>
      {trend && (
        <View className={`flex-row items-center gap-1 mt-1`}>
          <TrendIcon size={12} color={trend.direction === 'down' ? palette.success : palette.danger} />
          <Text className={`text-xs ${trendColor}`}>{trend.label}</Text>
        </View>
      )}
    </Card>
  );
}
