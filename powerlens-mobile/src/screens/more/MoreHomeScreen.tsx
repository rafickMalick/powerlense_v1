import { useEffect } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  Power,
  Cpu,
  Zap,
  Bell,
  FileText,
  Trophy,
  Settings as SettingsIcon,
  Receipt,
  Sparkles,
  LifeBuoy,
  Info,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react-native';
import { useAuthStore } from '@/store/authStore';
import { useActiveBuilding } from '@/store/buildingStore';
import { useAlertsStore } from '@/store/alertsStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { Card, Badge } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { MoreStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<MoreStackParamList, 'MoreHome'>;

interface MenuRow {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  badge?: number;
}

function MenuSection({ title, rows }: { title: string; rows: MenuRow[] }) {
  return (
    <Card>
      <Text className="text-sm font-medium text-text-secondary mb-3">{title}</Text>
      <View className="gap-1">
        {rows.map((row) => (
          <Pressable
            key={row.label}
            onPress={row.onPress}
            className="flex-row items-center justify-between p-3 bg-surface-alt rounded active:bg-surface-secondary"
          >
            <View className="flex-row items-center gap-3">
              <row.icon color={palette.navy700} size={16} />
              <Text className="text-sm text-text-primary">{row.label}</Text>
            </View>
            <View className="flex-row items-center gap-2">
              {!!row.badge && <Badge className="bg-primary border-0">{row.badge}</Badge>}
              <ChevronRight color={palette.gray400} size={16} />
            </View>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

export function MoreHomeScreen({ navigation }: Props) {
  useScreenViewLogging('More');
  const user = useAuthStore((s) => s.user);
  const building = useActiveBuilding();
  const alerts = useAlertsStore((s) => s.alerts);
  const fetchInitialAlerts = useAlertsStore((s) => s.fetchInitial);
  const recommendations = useSupervisorStore((s) => s.recommendations);
  const fetchRecommendations = useSupervisorStore((s) => s.fetchRecommendations);

  const isSupervisorAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';

  useEffect(() => {
    if (isSupervisorAdmin) fetchRecommendations({ status: 'PENDING' });
  }, [isSupervisorAdmin, fetchRecommendations]);

  useEffect(() => {
    // Compte exact du badge "Alertes" dès l'ouverture du hub (pas seulement
    // les alertes reçues en direct depuis le démarrage de l'app).
    if (building) fetchInitialAlerts(building.id);
  }, [building?.id, fetchInitialAlerts]);

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <MenuSection
        title="FACTURATION"
        rows={[
          {
            icon: Receipt,
            label: 'Factures',
            onPress: () => navigation.navigate('Settings', { screen: 'Billing' }),
          },
        ]}
      />

      <MenuSection
        title="BÂTIMENT"
        rows={[
          { icon: Cpu, label: 'Boîtiers', onPress: () => navigation.navigate('Devices') },
          { icon: Power, label: 'Centre de contrôle', onPress: () => navigation.navigate('ControlCenter') },
          { icon: Zap, label: 'Équipements', onPress: () => navigation.navigate('Equipment') },
        ]}
      />

      <MenuSection
        title="SUIVI"
        rows={[
          { icon: Bell, label: 'Alertes', onPress: () => navigation.navigate('Alerts'), badge: alerts.filter((a) => !a.acknowledged).length },
          { icon: FileText, label: 'Rapports & Historique', onPress: () => navigation.navigate('Reports') },
          { icon: Trophy, label: 'Classement', onPress: () => navigation.navigate('Ranking') },
        ]}
      />

      {isSupervisorAdmin && (
        <MenuSection
          title="INTELLIGENCE ARTIFICIELLE"
          rows={[
            {
              icon: Sparkles,
              label: 'Recommandations IA',
              onPress: () => navigation.navigate('Settings', { screen: 'RecommendationsList' }),
              badge: recommendations.length,
            },
          ]}
        />
      )}

      <MenuSection
        title="COMPTE"
        rows={[
          {
            icon: SettingsIcon,
            label: 'Paramètres',
            onPress: () => navigation.navigate('Settings', { screen: 'SettingsHome' }),
          },
        ]}
      />

      <MenuSection
        title="SUPPORT & INFORMATIONS"
        rows={[
          { icon: LifeBuoy, label: 'Support', onPress: () => navigation.navigate('Support') },
          { icon: Info, label: 'Informations', onPress: () => navigation.navigate('Info') },
        ]}
      />
    </ScrollView>
  );
}
