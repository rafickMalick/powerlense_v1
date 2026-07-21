import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabBar } from '@/components/layout/TabBar';
import { Header } from '@/components/layout/Header';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { MODULE_REGISTRY } from './modules';
import type { MainTabParamList } from './types';

const NO_HEADER = { headerShown: false } as const;

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  // Navigation adaptative : barre en bas sur mobile, rail/sidebar à gauche sur
  // tablette/desktop (le rendu lui-même vit dans components/layout/TabBar).
  const breakpoint = useBreakpoint();

  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        header: () => <Header />,
        tabBarPosition: breakpoint === 'mobile' ? 'bottom' : 'left',
      }}
    >
      {MODULE_REGISTRY.map((mod) => (
        <Tab.Screen
          key={mod.name}
          name={mod.name as keyof MainTabParamList}
          component={mod.component}
          options={mod.headerShown === false ? NO_HEADER : undefined}
        />
      ))}
    </Tab.Navigator>
  );
}
