import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  Activity,
  TrendingDown,
  TrendingUp,
  Building2,
  Bell,
  Zap,
  Wifi,
  WifiOff,
  Sparkles,
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
import { Card, EmptyState, ProgressBar, Button } from '@/components/ui';
import { ConsumptionAreaChart } from '@/components/charts/ConsumptionAreaChart';
import * as zonesService from '@/services/zones';
import { getAuditLogs } from '@/services/auditLogs';
import { formatAction } from '@/services/reports';
import { palette } from '@/theme/colors';
import { InfoTooltip } from '@/components/onboarding/InfoTooltip';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { AuditLog } from '@/types/models';

interface StatusPillProps {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'success';
  minWidthClass: string;
}

function StatusPill({ icon: Icon, label, value, tone = 'default', minWidthClass }: StatusPillProps) {
  const iconColor = tone === 'danger' ? palette.danger : tone === 'success' ? palette.success : palette.navy700;
  const valueClass = tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-text-primary';

  return (
    <Card className={`flex-1 ${minWidthClass}`}>
      <View className="flex-row items-center gap-2 mb-1">
        <Icon size={14} color={iconColor} />
        <Text className="text-xs text-text-secondary" numberOfLines={1}>{label}</Text>
      </View>
      <Text className={`text-base font-semibold ${valueClass}`} numberOfLines={1}>{value}</Text>
    </Card>
  );
}

export function DashboardScreen() {
  useScreenViewLogging('Dashboard');
  const navigation = useNavigation<any>();
  const breakpoint = useBreakpoint();
  const pillMinWidthClass = breakpoint === 'desktop' ? 'min-w-[22%]' : breakpoint === 'tablet' ? 'min-w-[30%]' : 'min-w-[45%]';
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

  const displayPower = (totalPower / 1000).toFixed(1);

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
  const connectionIcon = !socketConnected || espUnreachable ? WifiOff : Wifi;
  const connectionTone = !socketConnected || espUnreachable ? 'danger' : 'success';

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Building Info */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-1">TABLEAU DE BORD</Text>
        <Text className="text-xl font-bold text-text-primary">{building.name}</Text>
      </Card>

      {/* Pastilles de statut */}
      <View className="flex-row items-center gap-2 -mb-1">
        <Text className="text-xs text-text-secondary font-medium">APERÇU</Text>
        <InfoTooltip
          tooltipKey="dashboard-pills"
          title="Aperçu"
          description="Alertes actives (non acquittées), circuits actuellement sous tension, état de la connexion temps réel, et suggestions en attente du Smart Supervisor."
        />
      </View>
      <View className="flex-row flex-wrap gap-3">
        <StatusPill
          icon={Bell}
          label="Alertes actives"
          value={String(activeAlertsCount)}
          tone={activeAlertsCount > 0 ? 'danger' : 'default'}
          minWidthClass={pillMinWidthClass}
        />
        <StatusPill
          icon={Zap}
          label="Circuits actifs"
          value={`${activeCircuits.active}/${activeCircuits.total}`}
          minWidthClass={pillMinWidthClass}
        />
        <StatusPill
          icon={connectionIcon}
          label="Connexion"
          value={connectionValue}
          tone={connectionTone}
          minWidthClass={pillMinWidthClass}
        />
        {isSupervisorAdmin && (
          <StatusPill
            icon={Sparkles}
            label="Suggestions IA"
            value={String(pendingRecommendationsCount)}
            minWidthClass={pillMinWidthClass}
          />
        )}
      </View>

      {/* Real-time Metrics */}
      <View className="flex-row gap-4">
        <Card className="flex-1">
          <View className="flex-row items-center gap-2 mb-2">
            <Activity color={palette.success} size={16} />
            <Text className="text-xs text-text-secondary">Puissance Actuelle</Text>
          </View>
          <Text className="text-2xl font-mono font-bold text-success">{displayPower} kW</Text>
          <View className="flex-row items-center gap-1 mt-1">
            <TrendingDown color={palette.success} size={12} />
            <Text className="text-xs text-success">temps réel</Text>
          </View>
        </Card>

        <Card className="flex-1">
          <View className="flex-row items-center gap-2 mb-2">
            <Activity color={palette.navy700} size={16} />
            <Text className="text-xs text-text-secondary">Conso. Journée</Text>
          </View>
          <Text className="text-2xl font-mono font-bold text-primary">{displayEnergy}</Text>
          <View className="flex-row items-center gap-1 mt-1">
            <TrendingUp color={palette.gray500} size={12} />
            <Text className="text-xs text-text-secondary">depuis minuit</Text>
          </View>
        </Card>
      </View>

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
