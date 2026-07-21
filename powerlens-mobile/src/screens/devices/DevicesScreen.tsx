import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { Cpu, Zap } from 'lucide-react-native';
import { Card, Switch, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { palette } from '@/theme/colors';
import { getDevices } from '@/services/devices';
import { activateCircuit, deactivateCircuit } from '@/services/circuits';
import { useUiStore } from '@/store/uiStore';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import type { Device } from '@/types/models';

export function DevicesScreen() {
  useScreenViewLogging('Devices');
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const devicesOnline = useUiStore((s) => s.devicesOnline);
  const showToast = useUiStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      setError(false);
      setDevices(await getDevices());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  // Bascule optimiste d'une charge — l'ACK matériel confirmera via WebSocket.
  const toggleCircuit = async (deviceId: string, circuitId: string, next: boolean) => {
    setDevices((ds) =>
      ds.map((d) =>
        d.id !== deviceId
          ? d
          : { ...d, circuits: d.circuits.map((c) => (c.id === circuitId ? { ...c, isActive: next } : c)) },
      ),
    );
    try {
      await (next ? activateCircuit(circuitId) : deactivateCircuit(circuitId));
    } catch {
      showToast("Échec de l'envoi de la commande", 'error');
      void load(); // resynchronise sur l'état réel
    }
  };

  if (loading) {
    return (
      <View className="flex-1 bg-surface-alt p-4 gap-3">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </View>
    );
  }

  if (error) {
    return <ErrorState onRetry={load} />;
  }

  if (devices.length === 0) {
    return (
      <EmptyState
        icon={Cpu}
        title="Aucun boîtier enregistré"
        subtitle="Branchez un boîtier et configurez-le via son point d'accès WiFi : il apparaîtra ici automatiquement."
      />
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {devices.map((device) => {
        const online = devicesOnline[device.deviceUid];
        return (
          <Card key={device.id}>
            {/* En-tête boîtier : nom + identifiant matériel + statut LWT */}
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2 flex-1">
                <Cpu color={palette.navy700} size={18} />
                <View className="flex-1">
                  <Text className="text-base font-semibold text-text-primary">
                    {device.name ?? device.deviceUid}
                  </Text>
                  <Text className="text-xs text-text-muted">{device.deviceUid}</Text>
                </View>
              </View>
              <View
                className={`flex-row items-center gap-1 rounded-full px-2 py-0.5 border ${
                  online ? 'bg-success-tint border-success' : 'bg-surface-secondary border-border'
                }`}
              >
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: online ? palette.success : palette.gray400,
                  }}
                />
                <Text className={`text-xs ${online ? 'text-success' : 'text-text-muted'}`}>
                  {online ? 'En ligne' : 'Hors ligne'}
                </Text>
              </View>
            </View>

            {/* Charges du boîtier */}
            {device.circuits.length === 0 ? (
              <Text className="text-sm text-text-muted">Aucune charge configurée.</Text>
            ) : (
              <View className="gap-1">
                {device.circuits.map((circuit) => (
                  <View
                    key={circuit.id}
                    className="flex-row items-center justify-between p-3 bg-surface rounded border border-border"
                  >
                    <View className="flex-row items-center gap-2 flex-1">
                      <Zap color={palette.navy700} size={16} />
                      <View>
                        <Text className="text-sm text-text-primary">{circuit.name}</Text>
                        {circuit.pin != null && (
                          <Text className="text-xs text-text-muted">Pin {circuit.pin}</Text>
                        )}
                      </View>
                    </View>
                    <Switch
                      value={circuit.isActive}
                      disabled={online === false}
                      onValueChange={(next) => {
                        void toggleCircuit(device.id, circuit.id, next);
                      }}
                    />
                  </View>
                ))}
              </View>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
