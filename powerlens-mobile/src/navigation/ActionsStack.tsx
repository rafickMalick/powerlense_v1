import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Header } from '@/components/layout/Header';
import { ActionsReactionsScreen } from '@/screens/actions/ActionsReactionsScreen';
import { RuleFormScreen } from '@/screens/actions/RuleFormScreen';
import type { ActionsStackParamList } from './types';

const Stack = createNativeStackNavigator<ActionsStackParamList>();

export function ActionsStack() {
  return (
    <Stack.Navigator>
      {/* Racine de l'onglet "Règles" (plus de flèche retour depuis la refonte
          responsive : l'écran n'est plus imbriqué sous le hub "Plus"). */}
      <Stack.Screen
        name="ActionsReactions"
        component={ActionsReactionsScreen}
        options={{ header: () => <Header /> }}
      />
      <Stack.Screen
        name="RuleForm"
        component={RuleFormScreen}
        options={{ presentation: 'modal', title: 'Nouvelle règle' }}
      />
    </Stack.Navigator>
  );
}
