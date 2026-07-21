import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Header } from '@/components/layout/Header';
import { MoreHomeScreen } from '@/screens/more/MoreHomeScreen';
import { DevicesScreen } from '@/screens/devices/DevicesScreen';
import { ControlCenterScreen } from '@/screens/control/ControlCenterScreen';
import { AlertsScreen } from '@/screens/alerts/AlertsScreen';
import { ReportsScreen } from '@/screens/reports/ReportsScreen';
import { RankingScreen } from '@/screens/ranking/RankingScreen';
import { SupportScreen } from '@/screens/more/SupportScreen';
import { InfoScreen } from '@/screens/more/InfoScreen';
import { EquipmentScreen } from '@/screens/equipment/EquipmentScreen';
import { SettingsStack } from './SettingsStack';
import type { MoreStackParamList } from './types';

const Stack = createNativeStackNavigator<MoreStackParamList>();

/**
 * Hub "Plus" — regroupe les modules qui n'ont plus d'onglet permanent
 * derrière un seul onglet `More`, en réutilisant tels quels les écrans/stacks
 * existants (pas de duplication). Depuis la refonte UX responsive : Actions
 * (Règles) est remonté en onglet permanent, Équipements descend ici.
 */
export function MoreStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MoreHome" component={MoreHomeScreen} options={{ header: () => <Header /> }} />
      <Stack.Screen name="Devices" component={DevicesScreen} options={{ title: 'Boîtiers' }} />
      <Stack.Screen name="ControlCenter" component={ControlCenterScreen} options={{ title: 'Centre de contrôle' }} />
      <Stack.Screen name="Alerts" component={AlertsScreen} options={{ title: 'Alertes' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Rapports' }} />
      <Stack.Screen name="Ranking" component={RankingScreen} options={{ title: 'Classement' }} />
      <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Support' }} />
      <Stack.Screen name="Info" component={InfoScreen} options={{ title: 'Informations' }} />
      <Stack.Screen name="Equipment" component={EquipmentScreen} options={{ title: 'Équipements' }} />
      <Stack.Screen name="Settings" component={SettingsStack} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
