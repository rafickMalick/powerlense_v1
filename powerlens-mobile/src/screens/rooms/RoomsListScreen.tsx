import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Building2, MapPin, ChevronRight } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useRoomStore, type RoomUi } from '@/store/roomStore';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { Card, Switch, Badge, EmptyState, Chip, ErrorState } from '@/components/ui';
import { statusLabel } from '@/components/ui/StatusBadge';
import { palette } from '@/theme/colors';
import type { MonitoringZone } from '@/types/models';
import * as zonesService from '@/services/zones';
import type { RoomsStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<RoomsStackParamList, 'RoomsList'>;
type ZoneFilter = 'ROOM' | 'CORRIDOR';

const STATUS_COLOR: Record<RoomUi['status'], string> = {
  powered: 'bg-success',
  limited: 'bg-warning',
  cutoff: 'bg-danger',
};

export function RoomsListScreen({ navigation }: Props) {
  useScreenViewLogging('RoomsList');
  const building = useActiveBuilding();
  const [filter, setFilter] = useState<ZoneFilter>('ROOM');
  const [corridors, setCorridors] = useState<MonitoringZone[]>([]);

  const rooms = useRoomStore((s) => s.rooms);
  const roomsError = useRoomStore((s) => s.error);
  const fetchRooms = useRoomStore((s) => s.fetchRooms);
  const fetchCircuits = useRoomStore((s) => s.fetchCircuits);
  const setRoomStatus = useRoomStore((s) => s.setRoomStatus);
  const latestByZone = useMeasurementsStore((s) => s.latestByZone);
  const subscribe = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe = useMeasurementsStore((s) => s.unsubscribe);

  useEffect(() => {
    if (!building) return;
    fetchRooms(building.id);
    zonesService
      .getZones({ buildingId: building.id, type: 'CORRIDOR' })
      .then(setCorridors)
      .catch(() => {});
  }, [building]);

  useEffect(() => {
    subscribe();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  if (roomsError && rooms.length === 0) {
    return <ErrorState title={roomsError} onRetry={() => fetchRooms(building.id)} />;
  }

  const togglePower = (room: RoomUi) => {
    const next = room.status === 'powered' ? 'cutoff' : 'powered';
    if (!useRoomStore.getState().circuitsByRoom[room.id]) {
      fetchCircuits(room.id).then(() => setRoomStatus(room.id, next));
    } else {
      setRoomStatus(room.id, next);
    }
  };

  return (
    <View className="flex-1 bg-surface-alt">
      {/* Filtre */}
      <View className="flex-row gap-2 px-4 pt-4 pb-2">
        {(['ROOM', 'CORRIDOR'] as ZoneFilter[]).map((f) => (
          <Chip
            key={f}
            label={f === 'ROOM' ? `Salles (${rooms.length})` : `Couloirs (${corridors.length})`}
            selected={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>

      {filter === 'ROOM' ? (
        <FlatList
          contentContainerStyle={{ padding: 16, gap: 12 }}
          data={rooms}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <Card className="mb-2">
              <Text className="text-sm font-medium text-text-secondary mb-1">
                {building.name.toUpperCase()}
              </Text>
              <Text className="text-2xl font-bold text-text-primary">
                {rooms.filter((r) => r.status === 'powered').length} / {rooms.length} Salles Actives
              </Text>
            </Card>
          }
          ListEmptyComponent={
            <EmptyState icon={Building2} title="Aucune salle configurée pour ce bâtiment" />
          }
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item: room }) => (
            <Card>
              <View className="flex-row items-start justify-between mb-3">
                <View className="flex-row items-start gap-3">
                  <View className={`${STATUS_COLOR[room.status]} p-2 rounded`}>
                    <Building2 color={palette.white} size={16} />
                  </View>
                  <View>
                    <View className="flex-row items-center gap-2">
                      <Text className="font-medium text-text-primary">{room.name}</Text>
                      {room.isPriority && (
                        <Badge variant="default" className="bg-warning">
                          Prioritaire
                        </Badge>
                      )}
                    </View>
                    <Text className="text-xs text-text-secondary">{statusLabel(room.status)}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => {
                    fetchCircuits(room.id);
                    navigation.navigate('RoomDetail', { roomId: room.id, zoneType: 'ROOM' });
                  }}
                >
                  <ChevronRight color={palette.navy700} size={20} />
                </Pressable>
              </View>

              <View className="flex-row justify-between mb-3">
                <View>
                  <Text className="text-xs text-text-secondary">Puissance</Text>
                  <Text className="font-mono font-medium text-success">
                    {((latestByZone[room.id]?.power ?? 0) / 1000).toFixed(1)} kW
                  </Text>
                </View>
                <View>
                  <Text className="text-xs text-text-secondary">Type</Text>
                  <Text className="font-mono font-medium text-text-primary">Salle</Text>
                </View>
                {room.floor != null && (
                  <View>
                    <Text className="text-xs text-text-secondary">Étage</Text>
                    <Text className="font-mono font-medium text-text-primary">{room.floor}</Text>
                  </View>
                )}
              </View>

              <View className="flex-row items-center justify-between pt-3 border-t border-border">
                <Text className="text-sm text-text-primary">Alimentation</Text>
                <Switch
                  value={room.status === 'powered'}
                  onValueChange={() => togglePower(room)}
                />
              </View>
            </Card>
          )}
        />
      ) : (
        <FlatList
          contentContainerStyle={{ padding: 16, gap: 12 }}
          data={corridors}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <Card className="mb-2">
              <Text className="text-sm font-medium text-text-secondary mb-1">
                {building.name.toUpperCase()}
              </Text>
              <Text className="text-2xl font-bold text-text-primary">
                {corridors.length} Couloir{corridors.length !== 1 ? 's' : ''}
              </Text>
            </Card>
          }
          ListEmptyComponent={
            <EmptyState icon={MapPin} title="Aucun couloir configuré pour ce bâtiment" />
          }
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item: corridor }) => (
            <Card>
              <Pressable
                onPress={() =>
                  navigation.navigate('RoomDetail', {
                    roomId: corridor.id,
                    zoneType: 'CORRIDOR',
                  })
                }
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3">
                    <View className="bg-primary p-2 rounded">
                      <MapPin color={palette.white} size={16} />
                    </View>
                    <View>
                      <Text className="font-semibold text-text-primary">{corridor.name}</Text>
                      {corridor.floor != null && (
                        <Text className="text-sm text-text-secondary">Étage {corridor.floor}</Text>
                      )}
                    </View>
                  </View>
                  <ChevronRight color={palette.navy700} size={20} />
                </View>
              </Pressable>
            </Card>
          )}
        />
      )}
    </View>
  );
}
