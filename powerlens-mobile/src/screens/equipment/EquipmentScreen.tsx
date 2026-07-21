import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, ScrollView } from 'react-native';
import { Lightbulb, Thermometer, Plug, Wind, Server, Building2 } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { Card, Switch, EmptyState, Chip } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { Circuit, CircuitType, MonitoringZone } from '@/types/models';
import * as zonesService from '@/services/zones';
import * as circuitsService from '@/services/circuits';
import { off, on, type CircuitStatusPayload } from '@/services/websocket';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { useBreakpoint } from '@/hooks/useBreakpoint';

const TYPE_ICONS: Record<CircuitType, typeof Lightbulb> = {
  LIGHTING: Lightbulb,
  HVAC: Thermometer,
  SOCKET: Plug,
  FAN: Wind,
};

// Tons plus saturés que la palette pastel d'origine — meilleur contraste sur fond blanc.
const TYPE_COLORS: Record<CircuitType, string> = {
  LIGHTING: '#D97706',
  HVAC: '#0284C7',
  SOCKET: '#7C3AED',
  FAN: '#059669',
};

const TYPE_LABELS: Record<CircuitType, string> = {
  LIGHTING: 'Éclairage',
  HVAC: 'Climatisation',
  SOCKET: 'Prise',
  FAN: 'Ventilation',
};

interface CircuitWithZone extends Circuit {
  zoneId: string;
  zoneName: string;
  zoneType: 'ROOM' | 'CORRIDOR';
}

const NUM_COLUMNS: Record<ReturnType<typeof useBreakpoint>, number> = { mobile: 1, tablet: 2, desktop: 3 };

export function EquipmentScreen() {
  useScreenViewLogging('Equipment');
  const building = useActiveBuilding();
  const breakpoint = useBreakpoint();
  const numColumns = NUM_COLUMNS[breakpoint];
  const [zones, setZones] = useState<MonitoringZone[]>([]);
  const [circuits, setCircuits] = useState<CircuitWithZone[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedZone, setSelectedZone] = useState('all');

  const loadData = useCallback(async (buildingId: string) => {
    setLoading(true);
    try {
      const allZones = await zonesService.getZones({ buildingId });
      const relevant = allZones.filter((z) => z.type === 'ROOM' || z.type === 'CORRIDOR');
      setZones(relevant);

      const results = await Promise.allSettled(
        relevant.map((zone) =>
          zonesService.getZoneCircuits(zone.id).then((cs) =>
            cs.map((c): CircuitWithZone => ({
              ...c,
              zoneId: zone.id,
              zoneName: zone.name,
              zoneType: zone.type as 'ROOM' | 'CORRIDOR',
            })),
          ),
        ),
      );

      setCircuits(
        results
          .filter((r): r is PromiseFulfilledResult<CircuitWithZone[]> => r.status === 'fulfilled')
          .flatMap((r) => r.value),
      );
    } catch {
      // non-bloquant
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (building) loadData(building.id);
  }, [building, loadData]);

  useEffect(() => {
    const handleCircuitStatus = ({ circuitId, isActive }: CircuitStatusPayload) => {
      setCircuits((prev) => prev.map((c) => (c.id === circuitId ? { ...c, isActive } : c)));
    };
    on('circuit:status', handleCircuitStatus);
    return () => off('circuit:status', handleCircuitStatus);
  }, []);

  const toggleCircuit = async (circuit: CircuitWithZone) => {
    const next = !circuit.isActive;
    setCircuits((prev) => prev.map((c) => (c.id === circuit.id ? { ...c, isActive: next } : c)));
    try {
      if (next) await circuitsService.activateCircuit(circuit.id);
      else await circuitsService.deactivateCircuit(circuit.id);
    } catch {
      // repli optimiste en cas d'erreur
      setCircuits((prev) => prev.map((c) => (c.id === circuit.id ? { ...c, isActive: !next } : c)));
    }
  };

  const filteredCircuits = useMemo(
    () => (selectedZone === 'all' ? circuits : circuits.filter((c) => c.zoneId === selectedZone)),
    [circuits, selectedZone],
  );

  const { activeCount, totalMaxPower } = useMemo(
    () => ({
      activeCount: circuits.filter((c) => c.isActive).length,
      totalMaxPower: circuits.reduce((s, c) => s + (c.maxPowerWatt ?? 0), 0),
    }),
    [circuits],
  );

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const zoneOptions = [
    { label: 'Toutes les zones', value: 'all' },
    ...zones.map((z) => ({
      label: `${z.name}${z.type === 'CORRIDOR' ? ' (Couloir)' : ''}`,
      value: z.id,
    })),
  ];

  return (
    <FlatList
      // `key` force le remontage : FlatList interdit de changer numColumns à chaud.
      key={numColumns}
      numColumns={numColumns}
      columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={filteredCircuits}
      keyExtractor={(item) => item.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      ListHeaderComponent={
        <View className="gap-4 mb-3">
          <View>
            <Text className="text-xs text-text-secondary mb-2 px-1">FILTRER PAR ZONE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {zoneOptions.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={selectedZone === opt.value}
                  onPress={() => setSelectedZone(opt.value)}
                />
              ))}
            </ScrollView>
          </View>

          <View className="flex-row gap-4">
            <Card className="flex-1">
              <Text className="text-xs text-text-secondary mb-1">Charges Actives</Text>
              <Text className="text-2xl font-bold text-success">
                {activeCount}/{circuits.length}
              </Text>
            </Card>
            <Card className="flex-1">
              <Text className="text-xs text-text-secondary mb-1">Capacité Totale</Text>
              <Text className="text-2xl font-mono font-bold text-primary">
                {(totalMaxPower / 1000).toFixed(1)} kW
              </Text>
            </Card>
          </View>

          {loading && (
            <View className="items-center py-4">
              <ActivityIndicator color={palette.navy700} />
            </View>
          )}
        </View>
      }
      ListEmptyComponent={
        loading ? null : <EmptyState icon={Server} title="Aucune charge trouvée" />
      }
      renderItem={({ item: circuit }) => {
        const Icon = TYPE_ICONS[circuit.type] ?? Server;
        const color = TYPE_COLORS[circuit.type] ?? palette.gray400;
        return (
          <Card className={numColumns > 1 ? 'flex-1' : undefined}>
            <View className="flex-row items-start justify-between mb-3">
              <View className="flex-row items-start gap-3 flex-1">
                <View className={`${circuit.isActive ? 'bg-surface-secondary' : 'bg-surface-alt'} p-2 rounded`}>
                  <Icon color={circuit.isActive ? color : palette.gray400} size={16} />
                </View>
                <View className="flex-1">
                  <Text className="font-medium text-sm text-text-primary">{circuit.name}</Text>
                  <Text className="text-xs text-text-secondary">
                    {circuit.zoneName}
                    {circuit.zoneType === 'CORRIDOR' && ' · Couloir'}
                    {' · '}
                    {TYPE_LABELS[circuit.type]}
                  </Text>
                </View>
              </View>
              {circuit.isCritical && (
                <View className="bg-danger-tint px-2 py-0.5 rounded ml-2">
                  <Text className="text-xs text-danger">Critique</Text>
                </View>
              )}
            </View>

            <View className="flex-row justify-between mb-3">
              <View>
                <Text className="text-xs text-text-secondary">Puissance max</Text>
                <Text
                  className={`font-mono text-sm ${circuit.isActive ? 'text-success' : 'text-text-muted'}`}
                >
                  {circuit.maxPowerWatt != null
                    ? `${(circuit.maxPowerWatt / 1000).toFixed(1)} kW`
                    : '—'}
                </Text>
              </View>
              <View>
                <Text className="text-xs text-text-secondary">Statut</Text>
                <Text
                  className={`text-sm font-medium ${circuit.isActive ? 'text-success' : 'text-danger'}`}
                >
                  {circuit.isActive ? 'Actif' : 'Inactif'}
                </Text>
              </View>
              <View>
                <Text className="text-xs text-text-secondary">Type</Text>
                <Text className="text-sm text-text-primary">{TYPE_LABELS[circuit.type]}</Text>
              </View>
            </View>

            <View className="flex-row items-center justify-between pt-3 border-t border-border">
              <Text className="text-sm text-text-primary">Contrôle</Text>
              <Switch
                value={circuit.isActive}
                disabled={circuit.isCritical}
                onValueChange={() => toggleCircuit(circuit)}
              />
            </View>
            {circuit.isCritical && (
              <Text className="text-xs text-warning mt-2">
                ⚠️ Circuit critique — contrôle restreint
              </Text>
            )}
          </Card>
        );
      }}
    />
  );
}
