import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Header } from '@/components/layout/Header';
import { RoomsListScreen } from '@/screens/rooms/RoomsListScreen';
import { RoomDetailScreen } from '@/screens/rooms/RoomDetailScreen';
import { CircuitDetailScreen } from '@/screens/rooms/CircuitDetailScreen';
import type { RoomsStackParamList } from './types';

const Stack = createNativeStackNavigator<RoomsStackParamList>();

export function RoomsStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="RoomsList" component={RoomsListScreen} options={{ header: () => <Header /> }} />
      <Stack.Screen
        name="RoomDetail"
        component={RoomDetailScreen}
        options={{ presentation: 'modal', title: 'Détail de la salle' }}
      />
      <Stack.Screen
        name="CircuitDetail"
        component={CircuitDetailScreen}
        options={{ presentation: 'modal', title: 'Détail du circuit' }}
      />
    </Stack.Navigator>
  );
}
