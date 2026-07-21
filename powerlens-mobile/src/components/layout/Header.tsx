import { useEffect, useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bell, Building2, ChevronDown, ChevronLeft, WifiOff, Cpu } from 'lucide-react-native';
import { useBuildingStore, useActiveBuilding } from '@/store/buildingStore';
import { useAlertsStore } from '@/store/alertsStore';
import { useUiStore } from '@/store/uiStore';
import { Modal } from '@/components/ui';
import { Badge } from '@/components/ui';
import { palette } from '@/theme/colors';

interface HeaderProps {
  /** Affiche une flèche retour — pour les racines de stacks imbriquées (ex.
   * ActionsStack/SettingsStack sous le hub "Plus") qui ne sont PAS des
   * racines d'onglet et n'ont donc pas de header natif avec back auto. */
  showBack?: boolean;
}

export function Header({ showBack = false }: HeaderProps) {
  const navigation = useNavigation<any>();
  const [open, setOpen] = useState(false);
  const buildings = useBuildingStore((s) => s.buildings);
  const setActiveBuilding = useBuildingStore((s) => s.setActiveBuilding);
  const activeBuilding = useActiveBuilding();
  const socketConnected = useUiStore((s) => s.socketConnected);
  const providerMode = useUiStore((s) => s.providerMode);
  const deviceOnline = useUiStore((s) => s.deviceOnline);
  // ESP attendu (mode matériel) mais absent : détecté immédiatement via le LWT,
  // sans attendre le basculement du provider (silence des mesures).
  const espUnreachable = providerMode === 'mqtt' && !deviceOnline;
  const unreadAlerts = useAlertsStore((s) => s.alerts.filter((a) => !a.acknowledged).length);
  const fetchInitialAlerts = useAlertsStore((s) => s.fetchInitial);

  // Badge alertes exact dès le premier rendu (pas seulement les alertes reçues
  // en direct) — même logique que MoreHomeScreen, mais visible partout.
  useEffect(() => {
    if (activeBuilding) void fetchInitialAlerts(activeBuilding.id);
  }, [activeBuilding?.id, fetchInitialAlerts]);

  return (
    <View className="bg-surface border-b border-border px-4 py-3 flex-row items-center justify-between">
      <View className="flex-row items-center gap-2">
        {showBack && (
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            className="w-7 h-7 items-center justify-center -ml-1"
          >
            <ChevronLeft color={palette.gray900} size={20} />
          </Pressable>
        )}
        <View className="flex-row items-center gap-2">
          <Image
            source={require('../../../assets/logo.jpeg')}
            style={{ width: 32, height: 26 }}
            resizeMode="contain"
          />
          <Text className="text-base font-semibold text-text-primary">PowerLens</Text>
        </View>
        {!socketConnected && (
          <View className="flex-row items-center gap-1 bg-danger-tint border border-danger rounded px-2 py-0.5">
            <WifiOff size={12} color={palette.danger} />
            <Text className="text-xs text-danger">Hors ligne</Text>
          </View>
        )}
        {socketConnected && espUnreachable && (
          <View className="flex-row items-center gap-1 bg-danger-tint border border-danger rounded px-2 py-0.5">
            <WifiOff size={12} color={palette.danger} />
            <Text className="text-xs text-danger">ESP hors ligne</Text>
          </View>
        )}
        {socketConnected && !espUnreachable && providerMode === 'simulator' && (
          <View className="flex-row items-center gap-1 bg-warning-tint border border-warning rounded px-2 py-0.5">
            <Cpu size={12} color={palette.warning} />
            <Text className="text-xs text-warning">Simulation</Text>
          </View>
        )}
      </View>

      <View className="flex-row items-center gap-2">
        {/* Cloche Alertes — accès 1 tap depuis n'importe quel onglet */}
        <Pressable
          onPress={() => navigation.navigate('More', { screen: 'Alerts' })}
          hitSlop={8}
          className="w-8 h-8 items-center justify-center rounded"
          accessibilityLabel={`Alertes${unreadAlerts ? ` (${unreadAlerts} non lues)` : ''}`}
        >
          <Bell size={18} color={palette.gray500} />
          {unreadAlerts > 0 && (
            <View className="absolute -top-0.5 -right-0.5 bg-danger rounded-full min-w-[16px] h-4 items-center justify-center px-0.5">
              <Text className="text-[9px] text-white font-bold">
                {unreadAlerts > 99 ? '99+' : unreadAlerts}
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          onPress={() => setOpen(true)}
          className="flex-row items-center gap-2 bg-surface-alt rounded px-2 py-1.5"
        >
          <Building2 size={16} color={palette.navy700} />
          <Text className="text-sm text-text-primary" numberOfLines={1}>
            {activeBuilding?.name ?? 'Aucun bâtiment'}
          </Text>
          <ChevronDown size={14} color={palette.gray400} />
        </Pressable>
      </View>

      <Modal visible={open} onClose={() => setOpen(false)} title="Bâtiments">
        {buildings.map((building) => (
          <Pressable
            key={building.id}
            onPress={() => {
              setActiveBuilding(building.id);
              setOpen(false);
            }}
            className="flex-row items-center justify-between p-3 bg-surface-alt rounded mb-2"
          >
            <View className="flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="text-text-primary font-medium">{building.name}</Text>
                {building.id === activeBuilding?.id && <Badge>Actif</Badge>}
              </View>
              <Text className="text-xs text-text-secondary mt-1">{building.location}</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          onPress={() => {
            setOpen(false);
            navigation.navigate('More', { screen: 'Settings', params: { screen: 'BuildingManagement' } });
          }}
          className="p-3 mt-1"
        >
          <Text className="text-primary text-sm text-center font-medium">Gérer les bâtiments</Text>
        </Pressable>
      </Modal>
    </View>
  );
}
