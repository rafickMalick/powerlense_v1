import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Building2,
  Wifi,
  WifiOff,
  Power,
  ChevronRight,
  Clock,
  type LucideIcon,
} from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useRoomStore } from '@/store/roomStore';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { useAlertsStore } from '@/store/alertsStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { useUiStore } from '@/store/uiStore';
import { useAuthStore } from '@/store/authStore';
import { Card, EmptyState, ProgressBar, Button, PowerGauge } from '@/components/ui';
import { ConsumptionAreaChart } from '@/components/charts/ConsumptionAreaChart';
import * as zonesService from '@/services/zones';
import { getAuditLogs } from '@/services/auditLogs';
import { formatAction } from '@/services/reports';
import { palette } from '@/theme/colors';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { AuditLog } from '@/types/models';

export function DashboardScreen() {
  useScreenViewLogging('Dashboard');
  const navigation = useNavigation<any>();
  const breakpoint = useBreakpoint();
  const building = useActiveBuilding();
  const user = useAuthStore((s) => s.user);
  const rooms = useRoomStore((s) => s.rooms);
  const fetchRooms = useRoomStore((s) => s.fetchRooms);
  const circuitsByRoom = useRoomStore((s) => s.circuitsByRoom);
  const fetchCircuits = useRoomStore((s) => s.fetchCircuits);
  const consumption24h = useMeasurementsStore((s) => s.consumption24h);
  const totalPower = useMeasurementsStore((s) => s.totalPower);
  const latestByZone = useMeasurementsStore((s) => s.latestByZone);
  const energyTodayKwh = useMeasurementsStore((s) => s.energyTodayKwh);
  const fetchConsumption24h = useMeasurementsStore((s) => s.fetchConsumption24h);
  const fetchEnergyToday = useMeasurementsStore((s) => s.fetchEnergyToday);
  const subscribe = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe = useMeasurementsStore((s) => s.unsubscribe);
  const alerts = useAlertsStore((s) => s.alerts);
  const subscribeAlerts = useAlertsStore((s) => s.subscribe);
  const unsubscribeAlerts = useAlertsStore((s) => s.unsubscribe);
  const socketConnected = useUiStore((s) => s.socketConnected);
  const providerMode = useUiStore((s) => s.providerMode);
  const deviceOnline = useUiStore((s) => s.deviceOnline);
  const recommendations = useSupervisorStore((s) => s.recommendations);
  const fetchRecommendations = useSupervisorStore((s) => s.fetchRecommendations);
  const { width } = useWindowDimensions();

  const isSupervisorAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
  const [latestActions, setLatestActions] = useState<AuditLog[]>([]);

  useEffect(() => {
    if (building) fetchRooms(building.id);
  }, [building, fetchRooms]);

  useEffect(() => {
    rooms.forEach((room) => fetchCircuits(room.id));
  }, [rooms, fetchCircuits]);

  useEffect(() => {
    if (!building) return;
    fetchEnergyToday(building.id);
    const interval = setInterval(() => fetchEnergyToday(building.id), 60000);
    return () => clearInterval(interval);
  }, [building, fetchEnergyToday]);

  useEffect(() => {
    subscribe();
    subscribeAlerts();
    return () => {
      unsubscribe();
      unsubscribeAlerts();
    };
  }, [subscribe, unsubscribe, subscribeAlerts, unsubscribeAlerts]);

  useEffect(() => {
    if (isSupervisorAdmin) fetchRecommendations({ status: 'PENDING' });
  }, [isSupervisorAdmin, fetchRecommendations]);

  useEffect(() => {
    getAuditLogs(3).then(setLatestActions).catch(() => setLatestActions([]));
  }, []);

  // Graphe 24h : agrégat de la zone BUILDING (somme des zones ROOM/CORRIDOR
  // du bâtiment, cf. measurements.service.ts findByZone).
  useEffect(() => {
    if (!building) return;
    zonesService
      .getZones({ buildingId: building.id, type: 'BUILDING' })
      .then((zones) => {
        const buildingZoneId = zones[0]?.id;
        if (buildingZoneId) fetchConsumption24h(buildingZoneId);
      })
      .catch(() => {});
  }, [building, fetchConsumption24h]);

  const activeCircuits = useMemo(() => {
    const all = Object.values(circuitsByRoom).flat();
    return { active: all.filter((c) => c.isActive).length, total: all.length };
  }, [circuitsByRoom]);

  const activeAlertsCount = useMemo(() => alerts.filter((a) => !a.acknowledged).length, [alerts]);
  const pendingRecommendationsCount = recommendations.filter((r) => r.status === 'PENDING').length;

  const { sortedRooms, totalRoomPower } = useMemo(() => {
    const roomsWithPower = rooms.map((r) => ({ ...r, livePower: latestByZone[r.id]?.power ?? 0 }));
    const total = roomsWithPower.reduce((sum, r) => sum + r.livePower, 0);
    return { sortedRooms: [...roomsWithPower].sort((a, b) => b.livePower - a.livePower), totalRoomPower: total };
  }, [rooms, latestByZone]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }


  const displayEnergy =
    energyTodayKwh >= 1000 ? `${(energyTodayKwh / 1000).toFixed(2)} MWh` : `${energyTodayKwh.toFixed(2)} kWh`;

  // ESP attendu (mode matériel) mais absent — détecté via le LWT, sans attendre
  // le silence des mesures.
  const espUnreachable = providerMode === 'mqtt' && !deviceOnline;
  const connectionValue = !socketConnected
    ? 'Hors ligne'
    : espUnreachable
      ? 'ESP hors ligne'
      : providerMode === 'simulator'
        ? 'Simulation'
        : 'Temps réel';
  const connectionTone = !socketConnected || espUnreachable ? 'danger' : 'success';

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Salutation — maquette « Tableau de bord » du handoff */}
      <View>
        <Text className="text-2xl font-bold text-text-primary">Bonjour</Text>
        <Text className="text-sm text-text-secondary mt-1">
          {building.name} ·{' '}
          {activeAlertsCount > 0
            ? `${activeAlertsCount} alerte${activeAlertsCount > 1 ? 's' : ''} à traiter`
            : 'Tout fonctionne normalement'}
        </Text>
      </View>

      {/* Jauge circulaire — élément central de la maquette */}
      <Card className="items-center py-6">
        <PowerGauge
          watts={totalPower}
          caption={connectionValue === 'Temps réel' ? 'en direct' : connectionValue}
        />
      </Card>

      {/* 3 KPIs texte, comme la maquette */}
      <View className="flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary">Consommation du jour</Text>
          <Text className="text-lg font-bold text-text-primary mt-1">{displayEnergy}</Text>
          <Text className="text-xs text-text-muted mt-0.5">depuis minuit</Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary">Circuits actifs</Text>
          <Text className="text-lg font-bold text-text-primary mt-1">
            {activeCircuits.active}
            <Text className="text-sm font-normal text-text-secondary">
              {' '}
              sur {activeCircuits.total}
            </Text>
          </Text>
          <Text className="text-xs text-text-muted mt-0.5">sous tension</Text>
        </Card>
        {isSupervisorAdmin && (
          <Card className="flex-1">
            <Text className="text-xs text-text-secondary">Suggestions IA</Text>
            <Text className="text-lg font-bold text-text-primary mt-1">
              {pendingRecommendationsCount}
            </Text>
            <Text className="text-xs text-text-muted mt-0.5">
              {pendingRecommendationsCount > 1 ? 'nouvelles' : 'nouvelle'}
            </Text>
          </Card>
        )}
      </View>

      {/* Alerte visible en tête si la connexion est dégradée */}
      {connectionTone === 'danger' && (
        <Card className="flex-row items-center gap-2 border-danger">
          <WifiOff color={palette.danger} size={16} />
          <Text className="text-sm text-danger">{connectionValue}</Text>
        </Card>
      )}

      {/* Contrôle rapide */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-3">CONTRÔLE RAPIDE</Text>
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View
              className={`w-2.5 h-2.5 rounded-full ${
                building.powerStatus === 'POWERED'
                  ? 'bg-success'
                  : building.powerStatus === 'LIMITED'
                    ? 'bg-warning'
                    : 'bg-danger'
              }`}
            />
            <Text className="text-sm text-text-primary font-medium">
              {building.powerStatus === 'POWERED' ? 'Alimenté' : building.powerStatus === 'LIMITED' ? 'Limité' : 'Coupé'}
            </Text>
          </View>
          <Button
            variant="outline"
            className="px-3 py-2"
            onPress={() => navigation.navigate('More', { screen: 'ControlCenter' })}
          >
            <View className="flex-row items-center gap-1">
              <Power size={14} color={palette.navy700} />
              <Text className="text-primary text-sm font-medium">Centre de contrôle</Text>
              <ChevronRight size={14} color={palette.navy700} />
            </View>
          </Button>
        </View>
      </Card>

      {/* Consumption Chart */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">CONSOMMATION 24H</Text>
        <ConsumptionAreaChart data={consumption24h} width={Math.max(200, width - 64)} />
      </Card>

      {/* Room Consumption */}
      {sortedRooms.length > 0 && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-4">CONSOMMATION PAR SALLE</Text>
          <View className="gap-3">
            {sortedRooms.map((room) => (
              <View key={room.id}>
                <View className="flex-row justify-between items-center mb-1">
                  <Text className="text-sm text-text-primary">{room.name}</Text>
                  <Text className="text-sm font-mono text-success">
                    {(room.livePower / 1000).toFixed(1)} kW
                  </Text>
                </View>
                <ProgressBar percent={totalRoomPower > 0 ? (room.livePower / totalRoomPower) * 100 : 0} />
              </View>
            ))}
          </View>
        </Card>
      )}

      {/* Dernières actions */}
      {latestActions.length > 0 && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-3">DERNIÈRES ACTIONS</Text>
          <View className="gap-3">
            {latestActions.map((log) => (
              <View key={log.id} className="flex-row items-start gap-2">
                <Clock size={14} color={palette.gray400} style={{ marginTop: 2 }} />
                <View className="flex-1">
                  <Text className="text-sm text-text-primary">{formatAction(log.action, log.targetType)}</Text>
                  <Text className="text-xs text-text-muted mt-0.5">
                    {new Date(log.createdAt).toLocaleString('fr-FR')}
                    {log.actorType !== 'SYSTEM' ? ` · ${log.actorId ?? log.actorType}` : ' · Règle automatique'}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Card>
      )}
    </ScrollView>
  );
}
