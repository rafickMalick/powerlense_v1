import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { MapPin, Zap, ChevronRight } from 'lucide-react-native';
import { useRoomStore } from '@/store/roomStore';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { useUiStore } from '@/store/uiStore';
import { Card, Switch, Button, EmptyState } from '@/components/ui';
import { statusLabel } from '@/components/ui/StatusBadge';
import { palette } from '@/theme/colors';
import type { Circuit } from '@/types/models';
import * as zonesService from '@/services/zones';
import type { RoomsStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomDetail'>;

const EMPTY_CIRCUITS: Circuit[] = [];

const STATUS_TEXT_COLOR: Record<'powered' | 'limited' | 'cutoff', string> = {
  powered: 'text-success',
  limited: 'text-warning',
  cutoff: 'text-danger',
};

/** Mesures live de la zone — communes aux vues salle et couloir (PZEM004T + SHT35 + PIR sur les deux). */
function ZoneMeasurements({ zoneId }: { zoneId: string }) {
  const measurement = useMeasurementsStore((s) => s.latestByZone[zoneId]);

  return (
    <View>
      <Text className="text-sm font-medium text-text-secondary mb-3">MESURES DE ZONE — TEMPS RÉEL</Text>
      <View className="flex-row flex-wrap gap-3">
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Puissance</Text>
          <Text className="text-xl font-mono font-bold text-success">
            {measurement?.power != null ? `${measurement.power.toFixed(0)} W` : '—'}
          </Text>
        </Card>
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Tension</Text>
          <Text className="text-xl font-mono font-bold text-text-primary">
            {measurement?.voltage != null ? `${measurement.voltage.toFixed(1)} V` : '—'}
          </Text>
        </Card>
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Courant</Text>
          <Text className="text-xl font-mono font-bold text-text-primary">
            {measurement?.current != null ? `${measurement.current.toFixed(2)} A` : '—'}
          </Text>
        </Card>
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Luminosité</Text>
          <Text className="text-xl font-mono font-bold text-text-primary">
            {measurement?.luminosity != null ? `${Math.round(measurement.luminosity)} lux` : '—'}
          </Text>
        </Card>
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Température</Text>
          <Text className="text-xl font-mono font-bold text-text-primary">
            {measurement?.temperature != null ? `${measurement.temperature.toFixed(1)} °C` : '—'}
          </Text>
        </Card>
        <Card className="flex-1 min-w-[45%]">
          <Text className="text-xs text-text-secondary mb-1">Présence</Text>
          <Text className="text-xl font-mono font-bold text-text-primary">
            {measurement?.presence == null ? '—' : measurement.presence ? 'Détectée' : 'Aucune'}
          </Text>
        </Card>
      </View>
    </View>
  );
}

export function RoomDetailScreen({ route, navigation }: Props) {
  useScreenViewLogging('RoomDetail');
  const { roomId, zoneType = 'ROOM' } = route.params;
  const isCorridor = zoneType === 'CORRIDOR';

  const room = useRoomStore((s) => s.rooms.find((r) => r.id === roomId));
  const circuits = useRoomStore((s) => s.circuitsByRoom[roomId] ?? EMPTY_CIRCUITS);
  const fetchCircuits = useRoomStore((s) => s.fetchCircuits);
  const setRoomStatus = useRoomStore((s) => s.setRoomStatus);
  const toggleCircuit = useRoomStore((s) => s.toggleCircuit);
  const subscribe = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe = useMeasurementsStore((s) => s.unsubscribe);
  const subscribeCircuits = useRoomStore((s) => s.subscribe);
  const unsubscribeCircuits = useRoomStore((s) => s.unsubscribe);
  const providerMode = useUiStore((s) => s.providerMode);
  const deviceOnline = useUiStore((s) => s.deviceOnline);
  // ESP attendu (mode matériel) mais absent : commandes grisées (détecté via le
  // LWT). En mode simulateur, les commandes restent actives (démo synthétique).
  const espUnreachable = providerMode === 'mqtt' && !deviceOnline;

  const [corridorName, setCorridorName] = useState<string>('');
  const [corridorFloor, setCorridorFloor] = useState<number | null>(null);
  const [submittingStatus, setSubmittingStatus] = useState<'limited' | 'powered' | null>(null);

  useEffect(() => {
    fetchCircuits(roomId);
    if (isCorridor) {
      zonesService
        .getZone(roomId)
        .then((z) => {
          setCorridorName(z.name);
          setCorridorFloor(z.floor ?? null);
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  useEffect(() => {
    subscribe();
    subscribeCircuits();
    return () => {
      unsubscribe();
      unsubscribeCircuits();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vue couloir — pas de gestion de statut
  if (isCorridor) {
    return (
      <ScrollView
        className="flex-1 bg-surface-alt"
        contentContainerStyle={{ padding: 16, gap: 16 }}
      >
        <View className="flex-row items-center gap-3 mb-2">
          <View className="bg-primary p-2 rounded">
            <MapPin color={palette.white} size={18} />
          </View>
          <View>
            <Text className="text-text-primary text-lg font-semibold">
              {corridorName || 'Couloir'}
            </Text>
            {corridorFloor != null && (
              <Text className="text-text-secondary text-sm">Étage {corridorFloor}</Text>
            )}
          </View>
        </View>

        <ZoneMeasurements zoneId={roomId} />

        <View>
          <Text className="text-sm font-medium text-text-secondary mb-3">CIRCUITS</Text>
          <View className="gap-2">
            {circuits.length === 0 ? (
              <Text className="text-text-muted text-sm">Aucun circuit configuré</Text>
            ) : (
              circuits.map((circuit) => (
                <Pressable
                  key={circuit.id}
                  className="flex-row items-center justify-between p-3 bg-surface rounded border border-border"
                  onPress={() =>
                    navigation.navigate('CircuitDetail', { circuitId: circuit.id, roomId })
                  }
                >
                  <View className="flex-row items-center gap-2">
                    <Zap color={palette.navy700} size={16} />
                    <View>
                      <Text className="text-sm text-text-primary">{circuit.name}</Text>
                      {circuit.pin != null && (
                        <Text className="text-xs text-text-muted">Pin {circuit.pin}</Text>
                      )}
                    </View>
                  </View>
                  <View className="flex-row items-center gap-3">
                    {circuit.maxPowerWatt != null && (
                      <Text className="text-sm font-mono text-success">
                        {(circuit.maxPowerWatt / 1000).toFixed(1)} kW
                      </Text>
                    )}
                    <Switch
                      value={circuit.isActive}
                      disabled={espUnreachable}
                      onValueChange={() => { void toggleCircuit(roomId, circuit); }}
                    />
                    <ChevronRight color={palette.gray400} size={16} />
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </View>
      </ScrollView>
    );
  }

  // Vue salle normale
  if (!room) {
    return <EmptyState title="Salle introuvable" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <Text className="text-text-primary text-lg font-semibold">{room.name}</Text>
      <Text className="text-text-secondary text-sm -mt-3">Détails et contrôle des circuits</Text>

      {/* Status Info */}
      <Card className="gap-2">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-text-secondary">État actuel</Text>
          <Text className={`text-sm font-medium ${STATUS_TEXT_COLOR[room.status]}`}>
            {statusLabel(room.status)}
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-text-secondary">Prioritaire</Text>
          <Text className="text-sm text-text-primary">{room.isPriority ? 'Oui' : 'Non'}</Text>
        </View>
      </Card>

      <ZoneMeasurements zoneId={roomId} />

      {/* Circuits */}
      <View>
        <Text className="text-sm font-medium text-text-secondary mb-3">CIRCUITS</Text>
        <View className="gap-2">
          {circuits.length === 0 ? (
            <Text className="text-text-muted text-sm">Aucun circuit configuré</Text>
          ) : (
            circuits.map((circuit) => (
              <Pressable
                key={circuit.id}
                className="flex-row items-center justify-between p-3 bg-surface rounded border border-border"
                onPress={() =>
                  navigation.navigate('CircuitDetail', { circuitId: circuit.id, roomId })
                }
              >
                <View className="flex-row items-center gap-2">
                  <Zap color={palette.navy700} size={16} />
                  <Text className="text-sm text-text-primary">{circuit.name}</Text>
                </View>
                <View className="flex-row items-center gap-3">
                  {circuit.maxPowerWatt != null && (
                    <Text className="text-sm font-mono text-success">
                      {(circuit.maxPowerWatt / 1000).toFixed(1)} kW
                    </Text>
                  )}
                  <Switch
                    value={circuit.isActive}
                    disabled={room.status === 'cutoff' || espUnreachable}
                    onValueChange={() => { void toggleCircuit(roomId, circuit); }}
                  />
                  <ChevronRight color={palette.gray400} size={16} />
                </View>
              </Pressable>
            ))
          )}
        </View>
      </View>

      {/* Quick Actions */}
      <View>
        <Text className="text-sm font-medium text-text-secondary mb-3">ACTIONS RAPIDES</Text>
        <View className="flex-row gap-2">
          <Button
            variant="warning"
            className="flex-1"
            disabled={room.status === 'limited' || espUnreachable}
            loading={submittingStatus === 'limited'}
            onPress={async () => {
              setSubmittingStatus('limited');
              const ok = await setRoomStatus(roomId, 'limited');
              setSubmittingStatus(null);
              if (ok) navigation.goBack();
            }}
          >
            Limiter Puissance
          </Button>
          <Button
            className="flex-1"
            disabled={room.status === 'powered' || espUnreachable}
            loading={submittingStatus === 'powered'}
            onPress={async () => {
              setSubmittingStatus('powered');
              const ok = await setRoomStatus(roomId, 'powered');
              setSubmittingStatus(null);
              if (ok) navigation.goBack();
            }}
          >
            Rétablir
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
