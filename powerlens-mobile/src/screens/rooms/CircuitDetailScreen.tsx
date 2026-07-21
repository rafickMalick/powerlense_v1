import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Lightbulb, Thermometer, Plug, Wind, Server, ShieldAlert } from 'lucide-react-native';
import * as circuitsService from '@/services/circuits';
import { useRoomStore } from '@/store/roomStore';
import { Card, Switch, Button, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { Circuit, CircuitType, MonitoringZone } from '@/types/models';
import type { RoomsStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { off, on, type CircuitStatusPayload } from '@/services/websocket';

type Props = NativeStackScreenProps<RoomsStackParamList, 'CircuitDetail'>;

const TYPE_ICONS: Record<CircuitType, typeof Lightbulb> = {
  LIGHTING: Lightbulb,
  HVAC: Thermometer,
  SOCKET: Plug,
  FAN: Wind,
};

const TYPE_LABELS: Record<CircuitType, string> = {
  LIGHTING: 'Éclairage',
  HVAC: 'Climatisation',
  SOCKET: 'Prise',
  FAN: 'Ventilation',
};

/**
 * Écran de contrôle d'un circuit — depuis V4, les circuits ne sont plus
 * mesurés individuellement (seules les zones ROOM/CORRIDOR/BUILDING le
 * sont). Cet écran est donc un pur écran de commande : nom, type,
 * localisation, activation/désactivation. Les mesures de la zone sont
 * affichées sur l'écran de la salle/couloir (RoomDetailScreen).
 */
export function CircuitDetailScreen({ route }: Props) {
  useScreenViewLogging('CircuitDetail');
  const { circuitId, roomId } = route.params;
  const toggleCircuit = useRoomStore((s) => s.toggleCircuit);

  const [circuit, setCircuit] = useState<Circuit | null>(null);
  const [zone, setZone] = useState<MonitoringZone | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await circuitsService.getCircuit(circuitId);
      setCircuit(data);
      setZone(data.zone ?? null);
    } catch {
      // circuit introuvable ou API indisponible
    } finally {
      setLoading(false);
    }
  }, [circuitId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const handleCircuitStatus = ({ circuitId: id, isActive }: CircuitStatusPayload) => {
      if (id !== circuitId) return;
      setCircuit((prev) => (prev ? { ...prev, isActive } : prev));
    };
    on('circuit:status', handleCircuitStatus);
    return () => off('circuit:status', handleCircuitStatus);
  }, [circuitId]);

  if (loading) {
    return (
      <View className="flex-1 bg-surface-alt items-center justify-center">
        <ActivityIndicator color={palette.navy700} size="large" />
      </View>
    );
  }

  if (!circuit) {
    return <EmptyState title="Circuit introuvable" />;
  }

  const Icon = TYPE_ICONS[circuit.type] ?? Server;

  const handleToggle = async () => {
    const previous = circuit;
    setCircuit({ ...circuit, isActive: !circuit.isActive });
    const ok = await toggleCircuit(roomId, circuit);
    if (!ok) setCircuit(previous);
  };

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View className="flex-row items-center gap-3">
        <View className={`${circuit.isActive ? 'bg-primary-tint' : 'bg-surface-secondary'} p-2 rounded`}>
          <Icon color={circuit.isActive ? palette.navy700 : palette.gray400} size={20} />
        </View>
        <View className="flex-1">
          <Text className="text-text-primary text-lg font-semibold">{circuit.name}</Text>
          <Text className="text-text-secondary text-sm">
            {TYPE_LABELS[circuit.type]}
            {zone?.name ? ` · ${zone.name}` : ''}
          </Text>
        </View>
        {circuit.isCritical && (
          <View className="bg-danger-tint px-2 py-1 rounded flex-row items-center gap-1">
            <ShieldAlert color={palette.danger} size={12} />
            <Text className="text-xs text-danger">Critique</Text>
          </View>
        )}
      </View>

      <Card>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-text-primary">Circuit actif</Text>
          <Switch value={circuit.isActive} onValueChange={handleToggle} />
        </View>
        {circuit.maxPowerWatt != null && (
          <View className="flex-row items-center justify-between mt-2">
            <Text className="text-sm text-text-secondary">Puissance maximale</Text>
            <Text className="text-sm font-mono text-text-primary">{circuit.maxPowerWatt} W</Text>
          </View>
        )}
        {circuit.isCritical && (
          <Text className="text-xs text-warning mt-3">
            ⚠️ Circuit critique — jamais coupé automatiquement par une action groupée (zone/bâtiment)
          </Text>
        )}
      </Card>

      <Text className="text-xs text-text-muted">
        Ce circuit n'est pas instrumenté individuellement : les mesures (tension, courant, puissance…)
        sont disponibles au niveau de sa zone{zone?.name ? ` (${zone.name})` : ''}.
      </Text>

      <Button variant="outline" onPress={load}>
        Rafraîchir
      </Button>
    </ScrollView>
  );
}
