import { useState } from 'react';
import { View, Text, Pressable, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  MoreHorizontal,
  Receipt,
  Bell,
  FileText,
  Zap,
  Cpu,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react-native';
import { palette } from '@/theme/colors';
import { MODULE_REGISTRY } from '@/navigation/modules';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useAlertsStore } from '@/store/alertsStore';
import { triggerHaptic } from '@/utils/haptics';

/**
 * Navigation adaptative — un seul registre (MODULE_REGISTRY), trois rendus :
 *  - mobile  (<640)     : barre d'onglets horizontale en bas (comportement historique) ;
 *  - tablette (640-1024): rail vertical d'icônes à gauche ;
 *  - desktop (>1024)    : sidebar à gauche avec libellés + liens directs vers les
 *    écrans enfouis dans "Plus" (Facture, Alertes, Rapports, Équipements,
 *    Paramètres) — plus rien n'est à 2 niveaux de profondeur sur grand écran.
 * MainTabs bascule `tabBarPosition` en conséquence (bottom ↔ left).
 */

/** Liens secondaires de la sidebar desktop — pointent dans le stack "More". */
const SIDEBAR_SHORTCUTS: {
  label: string;
  icon: LucideIcon;
  screen: 'Devices' | 'Alerts' | 'Reports' | 'Equipment';
  nested?: undefined;
}[] = [
  { label: 'Boîtiers', icon: Cpu, screen: 'Devices' },
  { label: 'Alertes', icon: Bell, screen: 'Alerts' },
  { label: 'Rapports', icon: FileText, screen: 'Reports' },
  { label: 'Équipements', icon: Zap, screen: 'Equipment' },
];

export function TabBar(props: BottomTabBarProps) {
  const breakpoint = useBreakpoint();
  if (breakpoint === 'mobile') return <BottomBar {...props} />;
  return <SideBar {...props} expanded={breakpoint === 'desktop'} />;
}

// ─── Mobile : barre horizontale en bas (inchangée) ───────────────────────────
function BottomBar({ state, navigation }: BottomTabBarProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const tabWidth = state.routes.length > 0 ? containerWidth / state.routes.length : 0;

  const indicatorStyle = useAnimatedStyle(() => ({
    width: tabWidth,
    transform: [{ translateX: withTiming(state.index * tabWidth, { duration: 200 }) }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setContainerWidth(e.nativeEvent.layout.width);

  return (
    <View className="bg-surface border-t border-border flex-row p-2" onLayout={onLayout}>
      {tabWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[{ position: 'absolute', top: 4, height: 2, backgroundColor: palette.navy700, borderRadius: 1 }, indicatorStyle]}
        />
      )}
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const mod = MODULE_REGISTRY.find((m) => m.name === route.name);
        const Icon: LucideIcon = mod?.icon ?? MoreHorizontal;

        return (
          <Pressable
            key={route.key}
            onPress={() => {
              triggerHaptic('selection');
              navigation.navigate(route.name);
            }}
            className="flex-1 items-center justify-center py-2 rounded"
          >
            <Icon size={20} color={focused ? palette.navy700 : palette.gray400} />
            <Text className={`text-xs mt-1 ${focused ? 'text-primary font-medium' : 'text-text-muted'}`}>
              {mod?.label ?? route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Tablette (rail icônes) / Desktop (sidebar libellée + raccourcis) ────────
function SideBar({ state, navigation, expanded }: BottomTabBarProps & { expanded: boolean }) {
  const unreadAlerts = useAlertsStore((s) => s.alerts.filter((a) => !a.acknowledged).length);

  return (
    <View
      className="bg-surface border-r border-border py-4 px-2"
      style={{ width: expanded ? 220 : 68 }}
    >
      {/* Modules principaux */}
      <View className="gap-1">
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const mod = MODULE_REGISTRY.find((m) => m.name === route.name);
          const Icon: LucideIcon = mod?.icon ?? MoreHorizontal;

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                triggerHaptic('selection');
                navigation.navigate(route.name);
              }}
              className={`flex-row items-center gap-3 rounded px-3 py-2.5 ${
                focused ? 'bg-primary-tint' : ''
              } ${expanded ? '' : 'justify-center'}`}
            >
              <Icon size={20} color={focused ? palette.navy700 : palette.gray400} />
              {expanded && (
                <Text className={`text-sm ${focused ? 'text-primary font-medium' : 'text-text-secondary'}`}>
                  {mod?.label ?? route.name}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Raccourcis directs (desktop uniquement) — écrans du hub "Plus" */}
      {expanded && (
        <>
          <View className="h-px bg-border my-4" />
          <Text className="text-xs text-text-muted px-3 mb-2">ACCÈS DIRECT</Text>
          <View className="gap-1">
            <SidebarLink
              icon={Receipt}
              label="Facture"
              onPress={() => navigation.navigate('More', { screen: 'Settings', params: { screen: 'Billing' } })}
            />
            {SIDEBAR_SHORTCUTS.map((link) => (
              <SidebarLink
                key={link.screen}
                icon={link.icon}
                label={link.label}
                badge={link.screen === 'Alerts' ? unreadAlerts : undefined}
                onPress={() => navigation.navigate('More', { screen: link.screen })}
              />
            ))}
            <SidebarLink
              icon={SettingsIcon}
              label="Paramètres"
              onPress={() => navigation.navigate('More', { screen: 'Settings', params: { screen: 'SettingsHome' } })}
            />
          </View>
        </>
      )}
    </View>
  );
}

function SidebarLink({
  icon: Icon,
  label,
  badge,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        triggerHaptic('selection');
        onPress();
      }}
      className="flex-row items-center gap-3 rounded px-3 py-2.5"
    >
      <Icon size={18} color={palette.gray500} />
      <Text className="text-sm text-text-secondary flex-1">{label}</Text>
      {!!badge && (
        <View className="bg-danger rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
          <Text className="text-[10px] text-white font-bold">{badge > 99 ? '99+' : badge}</Text>
        </View>
      )}
    </Pressable>
  );
}
