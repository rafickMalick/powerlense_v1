import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuthStore } from '@/store/authStore';
import { useBuildingStore } from '@/store/buildingStore';
import { useUiStore } from '@/store/uiStore';
import { palette } from '@/theme/colors';
import { WelcomeCarousel } from '@/components/onboarding/WelcomeCarousel';
import { AuthStack } from './AuthStack';
import { MainTabs } from './MainTabs';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: palette.gray50,
    card: palette.white,
    border: palette.gray200,
    primary: palette.navy700,
    text: palette.gray900,
  },
};

export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const restore = useAuthStore((s) => s.restore);
  const fetchBuildings = useBuildingStore((s) => s.fetchBuildings);
  const initSocket = useUiStore((s) => s.initSocket);
  const teardownSocket = useUiStore((s) => s.teardownSocket);

  useEffect(() => {
    restore();
  }, [restore]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchBuildings();
      initSocket();
      return () => teardownSocket();
    }
  }, [status, fetchBuildings, initSocket, teardownSocket]);

  if (status === 'idle' || status === 'loading') {
    return (
      <View className="flex-1 bg-surface-alt items-center justify-center">
        <ActivityIndicator color={palette.navy700} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {status === 'authenticated' ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Auth" component={AuthStack} />
        )}
      </Stack.Navigator>
      {status === 'authenticated' && <WelcomeCarousel />}
    </NavigationContainer>
  );
}
