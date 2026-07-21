import { memo, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, useWindowDimensions, Animated } from 'react-native';
import Svg, {
  Rect, Text as SvgText, G, Circle, Line, Defs,
  LinearGradient, Stop, Path,
} from 'react-native-svg';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { useActiveBuilding } from '@/store/buildingStore';
import * as zonesService from '@/services/zones';
import type { MonitoringZone } from '@/types/models';
import type { MainTabParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { palette, ratioToColor, RATIO_LEGEND } from '@/theme/colors';
import { Card } from '@/components/ui';
import { InfoTooltip } from '@/components/onboarding/InfoTooltip';

interface ZoneLayout {
  zone: MonitoringZone;
  maxPowerWatt: number;
  layout: { x: number; y: number; w: number; h: number };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function powerRatio(power: number, max: number): number {
  return Math.min(1, Math.max(0, power / max));
}

function fmt(w: number): string {
  return w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`;
}

/** Grille automatique 2 colonnes — remplace la config statique de layout. */
function computeGridLayout(index: number, total: number): { x: number; y: number; w: number; h: number } {
  const cols = total <= 1 ? 1 : 2;
  const rows = Math.ceil(total / cols);
  const gap = 4;
  const top = 12;
  const bottom = 8;
  const w = (100 - gap * (cols + 1)) / cols;
  const h = (100 - top - bottom - gap * (rows - 1)) / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: gap + col * (w + gap),
    y: top + row * (h + gap),
    w,
    h,
  };
}

// ─── composant salle SVG ──────────────────────────────────────────────────

interface RoomCellProps {
  zoneLayout: ZoneLayout;
  totalPower: number;
  hasAlert: boolean;
  svgW: number;
  svgH: number;
  onPress: () => void;
}

const RoomCell = memo(function RoomCell({ zoneLayout, totalPower, hasAlert, svgW, svgH, onPress }: RoomCellProps) {
  const { x, y, w, h } = zoneLayout.layout;
  const px  = (x / 100) * svgW;
  const py  = (y / 100) * svgH;
  const pw  = (w / 100) * svgW;
  const ph  = (h / 100) * svgH;
  const ratio = powerRatio(totalPower, zoneLayout.maxPowerWatt);
  const fillColor = ratioToColor(ratio);
  const gradId = `grad-${zoneLayout.zone.id.slice(0, 8)}`;
  const barW = Math.max(4, pw * 0.8 * ratio);

  return (
    <G>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0"   stopColor={fillColor} stopOpacity={0.35} />
          <Stop offset="1"   stopColor={fillColor} stopOpacity={0.08} />
        </LinearGradient>
      </Defs>

      {/* Fond de salle */}
      <Rect
        x={px} y={py} width={pw} height={ph}
        rx={8} ry={8}
        fill={`url(#${gradId})`}
        stroke={fillColor}
        strokeWidth={2}
        onPress={onPress}
      />

      {/* Nom de la zone */}
      <SvgText
        x={px + pw / 2} y={py + 18}
        textAnchor="middle"
        fill="#e2e8f0"
        fontSize={10}
        fontWeight="bold"
      >
        {zoneLayout.zone.name}
      </SvgText>

      {/* Valeur de puissance */}
      <SvgText
        x={px + pw / 2} y={py + ph / 2 - 6}
        textAnchor="middle"
        fill={fillColor}
        fontSize={14}
        fontWeight="bold"
      >
        {fmt(totalPower)}
      </SvgText>

      {/* Barre de progression */}
      <Rect
        x={px + pw * 0.1} y={py + ph / 2 + 8}
        width={pw * 0.8} height={6}
        rx={3} fill="#1e293b"
      />
      <Rect
        x={px + pw * 0.1} y={py + ph / 2 + 8}
        width={barW} height={6}
        rx={3} fill={fillColor}
      />

      {/* % sous la barre */}
      <SvgText
        x={px + pw / 2} y={py + ph / 2 + 24}
        textAnchor="middle"
        fill="#94a3b8"
        fontSize={8}
      >
        {Math.round(ratio * 100)}% capacité
      </SvgText>

      {/* Icône alerte ⚠ */}
      {hasAlert && (
        <G>
          <Circle cx={px + pw - 12} cy={py + 12} r={10} fill="#fbbf24" />
          <SvgText
            x={px + pw - 12} y={py + 16}
            textAnchor="middle"
            fill="#1e293b"
            fontSize={11}
            fontWeight="bold"
          >
            !
          </SvgText>
        </G>
      )}

      {/* Zone cliquable transparente par-dessus */}
      <Rect
        x={px} y={py} width={pw} height={ph}
        fill="transparent"
        onPress={onPress}
      />
    </G>
  );
},
(prev, next) =>
  prev.totalPower === next.totalPower &&
  prev.hasAlert === next.hasAlert &&
  prev.svgW === next.svgW &&
  prev.svgH === next.svgH &&
  prev.zoneLayout === next.zoneLayout,
);

// ─── plan SVG complet ─────────────────────────────────────────────────────

interface FloorPlanProps {
  svgW: number;
  svgH: number;
  zones: ZoneLayout[];
  onZonePress: (zoneId: string) => void;
  powerByZone: Record<string, number>;
  alertsByZone: Record<string, boolean>;
}

function FloorPlan({ svgW, svgH, zones, onZonePress, powerByZone, alertsByZone }: FloorPlanProps) {
  return (
    <Svg width={svgW} height={svgH}>
      {/* Fond bâtiment */}
      <Rect
        x={2} y={2} width={svgW - 4} height={svgH - 4}
        rx={12} ry={12}
        fill="#0f172a"
        stroke="#334155"
        strokeWidth={2}
      />

      {/* Titre bâtiment */}
      <SvgText
        x={svgW / 2} y={20}
        textAnchor="middle"
        fill="#64748b"
        fontSize={9}
        fontWeight="bold"
      >
        PLAN DU BÂTIMENT
      </SvgText>

      {/* Zones (salles + couloirs) */}
      {zones.map((zoneLayout) => (
        <RoomCell
          key={zoneLayout.zone.id}
          zoneLayout={zoneLayout}
          totalPower={powerByZone[zoneLayout.zone.id] ?? 0}
          hasAlert={alertsByZone[zoneLayout.zone.id] ?? false}
          svgW={svgW}
          svgH={svgH}
          onPress={() => onZonePress(zoneLayout.zone.id)}
        />
      ))}
    </Svg>
  );
}

// ─── écran principal ──────────────────────────────────────────────────────

export function TwinScreen() {
  useScreenViewLogging('Twin');
  const { width } = useWindowDimensions();
  const svgW = Math.min(width - 32, 400);
  const svgH = svgW * 1.1;

  const latestByZone = useMeasurementsStore((s) => s.latestByZone);
  const subscribe     = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe   = useMeasurementsStore((s) => s.unsubscribe);
  const building      = useActiveBuilding();

  const [zoneLayouts, setZoneLayouts] = useState<ZoneLayout[]>([]);

  // Pulse animation pour les alertes
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  // Abonnement WebSocket temps réel — subscribe/unsubscribe sont stables (Zustand)
  useEffect(() => {
    subscribe();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zones dynamiques : ROOM + CORRIDOR sont les zones instrumentées
  // (BUILDING est une pure agrégation, non affichée comme cellule).
  useEffect(() => {
    if (!building) return;
    let cancelled = false;

    zonesService.getZones({ buildingId: building.id }).then(async (allZones) => {
      const zones = allZones.filter((z) => z.type === 'ROOM' || z.type === 'CORRIDOR');
      const withMax = await Promise.all(
        zones.map(async (zone) => {
          const circuits = await zonesService.getZoneCircuits(zone.id).catch(() => []);
          const maxPowerWatt = circuits.reduce((s, c) => s + (c.maxPowerWatt ?? 0), 0) || 1000;
          return { zone, maxPowerWatt };
        }),
      );
      if (cancelled) return;
      setZoneLayouts(
        withMax.map(({ zone, maxPowerWatt }, index) => ({
          zone,
          maxPowerWatt,
          layout: computeGridLayout(index, withMax.length),
        })),
      );
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [building]);

  // Calcul puissance et alertes par zone (mesures temps réel)
  const powerByZone: Record<string, number> = {};
  const alertsByZone: Record<string, boolean> = {};

  zoneLayouts.forEach(({ zone, maxPowerWatt }) => {
    const power = latestByZone[zone.id]?.power ?? 0;
    powerByZone[zone.id] = power;
    alertsByZone[zone.id] = power > maxPowerWatt * 0.85;
  });

  const totalPower = Object.values(powerByZone).reduce((s, v) => s + v, 0);
  const hasAnyAlert = Object.values(alertsByZone).some(Boolean);

  // Navigation
  const nav = useNavigation<NativeStackNavigationProp<MainTabParamList>>();
  const handleZonePress = (zoneId: string) => {
    const zoneType = zoneLayouts.find((z) => z.zone.id === zoneId)?.zone.type;
    nav.navigate('Rooms', {
      screen: 'RoomDetail',
      params: { roomId: zoneId, zoneType: zoneType === 'CORRIDOR' ? 'CORRIDOR' : 'ROOM' },
    } as never);
  };

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>

      {/* Header */}
      <Card>
        <Text className="text-xs text-text-secondary font-medium mb-1">JUMEAU NUMÉRIQUE</Text>
        <Text className="text-text-primary font-bold text-base" numberOfLines={1}>
          {building?.name ?? 'Bâtiment'}
        </Text>
        <View className="flex-row items-center gap-2 mt-2">
          <View className="w-2 h-2 rounded-full bg-success" />
          <Text className="text-xs text-text-secondary">Temps réel — WebSocket actif</Text>
        </View>
      </Card>

      {/* KPIs */}
      <View className="flex-row gap-3">
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Puissance totale</Text>
          <Text className="text-xl font-mono font-bold text-primary">{fmt(totalPower)}</Text>
        </Card>
        <Card className="flex-1">
          <Text className="text-xs text-text-secondary mb-1">Zones actives</Text>
          <Text className="text-xl font-mono font-bold text-success">
            {zoneLayouts.length}
          </Text>
        </Card>
        {hasAnyAlert && (
          <Animated.View
            style={{ transform: [{ scale: pulse }] }}
            className="flex-1 bg-warning-tint rounded-xl p-3 border border-warning"
          >
            <Text className="text-xs text-warning mb-1">Alertes</Text>
            <Text className="text-xl font-mono font-bold text-warning">
              {Object.values(alertsByZone).filter(Boolean).length}
            </Text>
          </Animated.View>
        )}
      </View>

      {/* Plan — panneau volontairement sombre (jumeau numérique "spotlight", cf. plan §4) */}
      <View className="bg-gray-900 rounded-xl p-2 border border-border items-center" style={{ backgroundColor: palette.gray900 }}>
        <FloorPlan
          svgW={svgW}
          svgH={svgH}
          zones={zoneLayouts}
          onZonePress={handleZonePress}
          powerByZone={powerByZone}
          alertsByZone={alertsByZone}
        />
      </View>

      {/* Légende */}
      <Card>
        <View className="flex-row items-center gap-2 mb-3">
          <Text className="text-xs text-text-secondary font-medium">LÉGENDE</Text>
          <InfoTooltip
            tooltipKey="twin-legend"
            title="Légende du jumeau numérique"
            description="La couleur de chaque zone reflète sa puissance actuelle rapportée à sa capacité maximale (somme des puissances max de ses circuits)."
          />
        </View>
        <View className="flex-row flex-wrap gap-3">
          {RATIO_LEGEND.map(({ color, label }) => (
            <View key={label} className="flex-row items-center gap-2">
              <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
              <Text className="text-xs text-text-secondary">{label}</Text>
            </View>
          ))}
        </View>
      </Card>

      {/* Liste des zones cliquables */}
      <View className="gap-2">
        <Text className="text-xs text-text-secondary font-medium px-1">ZONES — appuyer pour le détail</Text>
        {zoneLayouts.map(({ zone, maxPowerWatt }) => {
          const power = powerByZone[zone.id] ?? 0;
          const ratio = powerRatio(power, maxPowerWatt);
          const color = ratioToColor(ratio);
          const alert = alertsByZone[zone.id];
          return (
            <Pressable key={zone.id} onPress={() => handleZonePress(zone.id)}>
              <Card className="flex-row items-center gap-3">
                <View style={{ width: 10, height: 40, borderRadius: 5, backgroundColor: color }} />
                <View className="flex-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-text-primary font-medium text-sm">{zone.name}</Text>
                    {alert && (
                      <View className="bg-warning rounded px-1">
                        <Text className="text-xs text-white font-bold">!</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    {Math.round(ratio * 100)}% — max {fmt(maxPowerWatt)}
                  </Text>
                </View>
                <Text style={{ color }} className="font-mono font-bold text-base">
                  {fmt(power)}
                </Text>
              </Card>
            </Pressable>
          );
        })}
      </View>

    </ScrollView>
  );
}
