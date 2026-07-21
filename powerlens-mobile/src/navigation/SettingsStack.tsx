import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Header } from '@/components/layout/Header';
import { SettingsScreen } from '@/screens/settings/SettingsScreen';
import { BuildingManagementScreen } from '@/screens/buildings/BuildingManagementScreen';
import { RecommendationsListScreen } from '@/screens/supervisor/RecommendationsListScreen';
import { RecommendationDetailScreen } from '@/screens/supervisor/RecommendationDetailScreen';
import { BillingScreen } from '@/screens/billing/BillingScreen';
import type { SettingsStackParamList } from './types';

const Stack = createNativeStackNavigator<SettingsStackParamList>();

export function SettingsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="SettingsHome" component={SettingsScreen} options={{ header: () => <Header showBack /> }} />
      <Stack.Screen
        name="BuildingManagement"
        component={BuildingManagementScreen}
        options={{ presentation: 'modal', title: 'Gestion des bâtiments' }}
      />
      <Stack.Screen
        name="RecommendationsList"
        component={RecommendationsListScreen}
        options={{ title: 'Recommandations IA' }}
      />
      <Stack.Screen
        name="RecommendationDetail"
        component={RecommendationDetailScreen}
        options={{ presentation: 'modal', title: 'Recommandation' }}
      />
      <Stack.Screen
        name="Billing"
        component={BillingScreen}
        options={{ title: 'Facturation' }}
      />
    </Stack.Navigator>
  );
}
