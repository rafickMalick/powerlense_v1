import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, ScrollView, useWindowDimensions } from 'react-native';
import { Download, TrendingDown, TrendingUp, Building2 } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useRoomStore } from '@/store/roomStore';
import * as zonesService from '@/services/zones';
import { Card, Chip, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { ConsumptionAreaChart } from '@/components/charts/ConsumptionAreaChart';
import { ComparisonBarChart } from '@/components/charts/ComparisonBarChart';
import { CircuitBarChart } from '@/components/charts/CircuitBarChart';
import {
  fetchReportData,
  exportCSV,
  getPeriodConfig,
  type ReportData,
} from '@/services/reports';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const PERIOD_OPTIONS = [
  { label: "Aujourd'hui", value: 'day' },
  { label: 'Cette semaine', value: 'week' },
  { label: 'Ce mois', value: 'month' },
  { label: 'Cette année', value: 'year' },
];

const REPORT_TYPE_OPTIONS = [
  { label: 'Par salle (comparaison)', value: 'room' },
  { label: 'Par salle (détail)', value: 'circuit' },
  { label: 'Historique actions', value: 'actions' },
];

function fmt(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(1)} MWh`;
  return `${kwh.toFixed(1)} kWh`;
}

function DeltaBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = ((current - previous) / previous) * 100;
  const down = pct < 0;
  const Icon = down ? TrendingDown : TrendingUp;
  const color = down ? palette.success : palette.danger;
  const textColor = down ? 'text-success' : 'text-danger';
  return (
    <View className="flex-row items-center gap-1 mt-1">
      <Icon size={12} color={color} />
      <Text className={`text-xs ${textColor}`}>
        {down ? '' : '+'}{pct.toFixed(1)}% vs période préc.
      </Text>
    </View>
  );
}

const EMPTY_DATA: ReportData = {
  rooms: [],
  totalCurrentKwh: 0,
  totalPreviousKwh: 0,
  globalTimeSeries: [],
  actionCount: 0,
  auditRows: [],
};

export function ReportsScreen() {
  useScreenViewLogging('Reports');
  const building  = useActiveBuilding();
  const rooms     = useRoomStore((s) => s.rooms);
  const fetchRooms = useRoomStore((s) => s.fetchRooms);

  const [period, setPeriod]         = useState('week');
  const [reportType, setReportType] = useState('room');
  const [data, setData]             = useState<ReportData>(EMPTY_DATA);
  const [loading, setLoading]       = useState(false);
  const [corridors, setCorridors]   = useState<{ id: string; name: string }[]>([]);

  const { width } = useWindowDimensions();
  const breakpoint = useBreakpoint();
  const isDesktop = breakpoint === 'desktop';
  // Math.max : protège contre une largeur transitoire trop petite (SVG refuse toute largeur négative).
  const chartWidth = Math.max(200, isDesktop ? width / 2 - 64 : width - 64);

  // S'assurer que les salles sont chargées
  useEffect(() => {
    if (building && rooms.length === 0) fetchRooms(building.id);
  }, [building?.id]);

  // `roomStore.rooms` ne couvre QUE les zones ROOM (`/rooms` filtre en interne,
  // cf. STATE.md V3) — les couloirs sont chargés séparément ici pour que les
  // rapports (comparaison, détail, export CSV) reflètent tout le bâtiment,
  // pas seulement les salles.
  useEffect(() => {
    if (!building) return;
    zonesService
      .getZones({ buildingId: building.id, type: 'CORRIDOR' })
      .then((zones) => setCorridors(zones.map((z) => ({ id: z.id, name: z.name }))))
      .catch(() => setCorridors([]));
  }, [building?.id]);

  const reportZones = useMemo(
    () => [...rooms.map((r) => ({ id: r.id, name: r.name })), ...corridors],
    [rooms, corridors],
  );

  const load = useCallback(async () => {
    if (!building || reportZones.length === 0) return;
    setLoading(true);
    try {
      const cfg = getPeriodConfig(period);
      const result = await fetchReportData(reportZones, cfg);
      setData(result);
    } catch {
      setData(EMPTY_DATA);
    } finally {
      setLoading(false);
    }
  }, [building?.id, period, reportZones]);

  useEffect(() => { load(); }, [load]);

  const handleExport = () => {
    if (Platform.OS !== 'web') return;
    exportCSV(data, period);
  };

  const roomBarData = useMemo(
    () =>
      data.rooms.map((r) => ({
        room: r.roomName.length > 8 ? r.roomName.slice(0, 8) + '…' : r.roomName,
        avant: Math.round(r.previousKwh * 1000) / 1000,
        apres: Math.round(r.currentKwh * 1000) / 1000,
      })),
    [data.rooms],
  );

  const circuitBarData = useMemo(
    () =>
      data.rooms.flatMap((r) =>
        r.timeSeries.length > 0
          ? [{ name: r.roomName.length > 8 ? r.roomName.slice(0, 8) + '…' : r.roomName, value: Math.round(r.currentKwh * 100) / 100 }]
          : [],
      ),
    [data.rooms],
  );

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const hasTimeSeries = data.globalTimeSeries.length > 0;

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <Card>
        <View className="flex-row items-center justify-between mb-3">
          <View>
            <Text className="text-sm font-medium text-text-secondary">RAPPORTS & HISTORIQUE</Text>
            <Text className="text-xs text-text-muted mt-1">{building.name}</Text>
          </View>
          {Platform.OS === 'web' && (
            <Pressable onPress={handleExport} className="bg-primary p-2 rounded" disabled={loading}>
              <Download color={palette.white} size={16} />
            </Pressable>
          )}
        </View>

        <View className="gap-3">
          <View>
            <Text className="text-xs text-text-secondary mb-2">Période</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {PERIOD_OPTIONS.map((opt) => (
                <Chip key={opt.value} label={opt.label} selected={period === opt.value} onPress={() => setPeriod(opt.value)} />
              ))}
            </ScrollView>
          </View>
          <View>
            <Text className="text-xs text-text-secondary mb-2">Vue</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {REPORT_TYPE_OPTIONS.map((opt) => (
                <Chip key={opt.value} label={opt.label} selected={reportType === opt.value} onPress={() => setReportType(opt.value)} />
              ))}
            </ScrollView>
          </View>
        </View>
      </Card>

      {/* KPI cards */}
      <View className="flex-row gap-4">
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Consommation totale</Text>
          {loading
            ? <ActivityIndicator color={palette.navy700} />
            : <Text className="text-2xl font-mono font-bold text-primary">{fmt(data.totalCurrentKwh)}</Text>
          }
          <DeltaBadge current={data.totalCurrentKwh} previous={data.totalPreviousKwh} />
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Actions déclenchées</Text>
          {loading
            ? <ActivityIndicator color={palette.success} />
            : <Text className="text-2xl font-mono font-bold text-success">{data.actionCount}</Text>
          }
          <Text className="text-xs text-text-secondary mt-1">
            {PERIOD_OPTIONS.find((o) => o.value === period)?.label}
          </Text>
        </Card>
      </View>

      {/* Courbe temporelle globale + vue détaillée — côte à côte sur desktop, empilées sinon */}
      <View className={isDesktop ? 'flex-row gap-4 items-start' : 'gap-4'}>
        <Card className={isDesktop ? 'flex-1' : undefined}>
          <Text className="text-sm font-medium text-text-secondary mb-4">
            ÉVOLUTION DE LA PUISSANCE (W)
          </Text>
          {loading ? (
            <View className="h-44 items-center justify-center">
              <ActivityIndicator color={palette.navy700} size="large" />
            </View>
          ) : hasTimeSeries ? (
            <ConsumptionAreaChart data={data.globalTimeSeries} width={chartWidth} />
          ) : (
            <View className="h-44 items-center justify-center">
              <Text className="text-text-secondary text-sm">Pas encore de mesures sur cette période</Text>
              <Text className="text-text-muted text-xs mt-1">Le simulateur envoie des données toutes les 5 s</Text>
            </View>
          )}
        </Card>

        {/* Vue par salle */}
        {reportType === 'room' && (
          <Card className={isDesktop ? 'flex-1' : undefined}>
            <Text className="text-sm font-medium text-text-secondary mb-1">PÉRIODE PRÉCÉDENTE VS ACTUELLE (kWh)</Text>
            <Text className="text-xs text-text-muted mb-4">
              <Text className="text-warning">■</Text> Période préc. &nbsp;
              <Text className="text-success">■</Text> Période actuelle
            </Text>
            {loading ? (
              <View className="h-52 items-center justify-center">
                <ActivityIndicator color={palette.navy700} size="large" />
              </View>
            ) : roomBarData.length > 0 ? (
              <ComparisonBarChart data={roomBarData} width={chartWidth} />
            ) : (
              <Text className="text-text-secondary text-sm text-center py-8">Aucune donnée</Text>
            )}
          </Card>
        )}

        {/* Vue par circuit */}
        {reportType === 'circuit' && (
          <Card className={isDesktop ? 'flex-1' : undefined}>
            <Text className="text-sm font-medium text-text-secondary mb-4">CONSOMMATION PAR SALLE (kWh)</Text>
            {loading ? (
              <View className="h-52 items-center justify-center">
                <ActivityIndicator color={palette.navy700} size="large" />
              </View>
            ) : circuitBarData.length > 0 ? (
              <CircuitBarChart data={circuitBarData} width={chartWidth} />
            ) : (
              <Text className="text-text-secondary text-sm text-center py-8">Aucune donnée</Text>
            )}
          </Card>
        )}

        {/* Historique des actions */}
        {reportType === 'actions' && (
          <Card className={isDesktop ? 'flex-1' : undefined}>
            <Text className="text-sm font-medium text-text-secondary mb-4">
              HISTORIQUE DES ACTIONS ({data.auditRows.length})
            </Text>
            {loading ? (
              <ActivityIndicator color={palette.navy700} />
            ) : data.auditRows.length === 0 ? (
              <Text className="text-text-secondary text-sm text-center py-4">Aucune action sur cette période</Text>
            ) : (
              <View className="gap-2">
                {data.auditRows.map((entry, idx) => (
                  <View key={idx} className="bg-surface-alt rounded p-3">
                    <View className="flex-row items-start justify-between gap-2 mb-1">
                      <Text className="text-sm font-medium text-text-primary flex-1">{entry.action}</Text>
                      <Text className="text-xs text-text-secondary shrink-0">{entry.date}</Text>
                    </View>
                    <Text className="text-xs text-text-secondary">Par : {entry.actor}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>
        )}
      </View>

      {/* Tableau détail par salle */}
      {!loading && data.rooms.length > 0 && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-4">DÉTAIL PAR SALLE</Text>
          <View className="gap-3">
            {data.rooms.map((room) => (
              <View key={room.roomId} className="flex-row justify-between items-center pb-2 border-b border-border">
                <Text className="text-sm text-text-secondary flex-1">{room.roomName}</Text>
                <Text className="font-mono text-primary text-sm">{fmt(room.currentKwh)}</Text>
              </View>
            ))}
            <View className="flex-row justify-between items-center pt-1">
              <Text className="text-sm font-medium text-text-primary">Total</Text>
              <Text className="font-mono text-text-primary font-bold">{fmt(data.totalCurrentKwh)}</Text>
            </View>
          </View>
        </Card>
      )}

      {/* Export */}
      {Platform.OS === 'web' && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-3">EXPORT</Text>
          <Pressable
            onPress={handleExport}
            disabled={loading || data.rooms.length === 0}
            className="bg-success p-3 rounded items-center"
            style={{ opacity: loading || data.rooms.length === 0 ? 0.5 : 1 }}
          >
            <Text className="text-white text-sm font-medium">Télécharger CSV</Text>
          </Pressable>
          <Text className="text-xs text-text-muted mt-2">
            Inclut la consommation par salle et l'historique des actions de la période
          </Text>
        </Card>
      )}

    </ScrollView>
  );
}
