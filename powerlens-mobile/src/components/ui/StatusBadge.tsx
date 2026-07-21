import { View, Text } from 'react-native';
import { AlertTriangle, Power, type LucideIcon } from 'lucide-react-native';

/** État d'une salle (RoomUi.status, groupement client des circuits) — distinct de Building.powerStatus. */
export type RoomPowerStatus = 'powered' | 'limited' | 'cutoff';

const CONFIG: Record<RoomPowerStatus, { color: string; label: string; icon: LucideIcon }> = {
  powered: { color: 'bg-success', label: 'Alimenté', icon: Power },
  limited: { color: 'bg-warning', label: 'Limité', icon: AlertTriangle },
  cutoff: { color: 'bg-danger', label: 'Coupé', icon: Power },
};

interface StatusBadgeProps {
  status: RoomPowerStatus;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = CONFIG[status];
  const Icon = config.icon;

  return (
    <View className={`${config.color} flex-row items-center gap-1 px-2 py-1 rounded ${className}`}>
      <Icon size={12} color="#fff" />
      <Text className="text-xs text-white font-medium">{config.label}</Text>
    </View>
  );
}

export function statusColor(status: RoomPowerStatus): string {
  return CONFIG[status].color;
}

export function statusLabel(status: RoomPowerStatus): string {
  return CONFIG[status].label;
}
