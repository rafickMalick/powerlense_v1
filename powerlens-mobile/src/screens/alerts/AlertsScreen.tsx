import { useEffect } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { AlertTriangle, ZapOff, Zap, Clock, User, Cog, Building2, Check } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useAlertsStore, type AlertUi } from '@/store/alertsStore';
import { useUiStore } from '@/store/uiStore';
import { Card, Badge, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { AlertUiType } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const ALERT_ICONS: Record<AlertUiType, typeof AlertTriangle> = {
  surcharge: AlertTriangle,
  coupure: ZapOff,
  limitation: Zap,
  action: Clock,
};

const ALERT_COLORS: Record<AlertUiType, string> = {
  surcharge: 'bg-danger',
  coupure: 'bg-warning',
  limitation: 'bg-warning',
  action: 'bg-primary',
};

function formatTimestamp(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AlertsScreen() {
  useScreenViewLogging('Alerts');
  const building = useActiveBuilding();
  const alerts = useAlertsStore((s) => s.alerts);
  const subscribe = useAlertsStore((s) => s.subscribe);
  const unsubscribe = useAlertsStore((s) => s.unsubscribe);
  const fetchInitial = useAlertsStore((s) => s.fetchInitial);
  const acknowledge = useAlertsStore((s) => s.acknowledge);
  const showToast = useUiStore((s) => s.showToast);

  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);

  useEffect(() => {
    if (building) fetchInitial(building.id);
  }, [building?.id, fetchInitial]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const handleAcknowledge = async (id: string) => {
    try {
      await acknowledge(id);
    } catch {
      showToast("Échec de l'acquittement de l'alerte", 'error');
    }
  };

  const renderItem = ({ item: alert }: { item: AlertUi }) => {
    const Icon = ALERT_ICONS[alert.type];
    const color = ALERT_COLORS[alert.type];

    return (
      <Card>
        <View className="flex-row items-start gap-3">
          <View className={`${color} p-2 rounded`}>
            <Icon color={palette.white} size={16} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-start justify-between gap-2 mb-1">
              <Text className="font-medium text-text-primary flex-1">{alert.message}</Text>
              <Badge variant={alert.origin === 'manuel' ? 'default' : 'secondary'}>
                <View className="flex-row items-center gap-1">
                  {alert.origin === 'manuel' ? (
                    <User color={palette.white} size={12} />
                  ) : (
                    <Cog color={palette.gray500} size={12} />
                  )}
                  <Text className={`text-xs font-medium ${alert.origin === 'manuel' ? 'text-white' : 'text-text-secondary'}`}>
                    {alert.origin === 'manuel' ? 'Manuel' : 'Automatique'}
                  </Text>
                </View>
              </Badge>
            </View>
            {alert.room && <Text className="text-sm text-text-secondary">Salle: {alert.room}</Text>}
            <View className="flex-row items-center justify-between mt-2">
              <View className="flex-row items-center gap-1">
                <Clock color={palette.gray400} size={12} />
                <Text className="text-xs text-text-muted">{formatTimestamp(alert.createdAt)}</Text>
              </View>
              {alert.acknowledged ? (
                <View className="flex-row items-center gap-1">
                  <Check color={palette.success} size={12} />
                  <Text className="text-xs text-success">Traitée</Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => handleAcknowledge(alert.id)}
                  className="flex-row items-center gap-1 px-2 py-1 rounded bg-surface-alt active:bg-surface-secondary"
                >
                  <Check color={palette.navy700} size={12} />
                  <Text className="text-xs text-primary font-medium">Acquitter</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <FlatList
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={alerts}
      keyExtractor={(item) => item.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      ListHeaderComponent={
        <Card className="mb-3">
          <Text className="text-sm font-medium text-text-secondary mb-1">ALERTES & ÉVÉNEMENTS</Text>
          <Text className="text-2xl font-bold text-text-primary">{alerts.length} Événements</Text>
          <Text className="text-xs text-text-secondary mt-1">{building.name}</Text>
        </Card>
      }
      ListEmptyComponent={<EmptyState icon={Clock} title="Aucun événement enregistré" />}
      renderItem={renderItem}
    />
  );
}
