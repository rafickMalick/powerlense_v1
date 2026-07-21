import { View, Text, ScrollView, Pressable } from 'react-native';
import { Info, HelpCircle, Zap } from 'lucide-react-native';
import { Card } from '@/components/ui';
import { useActiveBuilding } from '@/store/buildingStore';
import { useOnboardingStore } from '@/store/onboardingStore';
import { palette } from '@/theme/colors';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const APP_VERSION = '1.0.0';

export function InfoScreen() {
  useScreenViewLogging('Info');
  const building = useActiveBuilding();
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <View className="flex-row items-center gap-3 mb-3">
          <View className="w-10 h-10 rounded-md bg-primary items-center justify-center">
            <Zap color={palette.white} size={20} />
          </View>
          <View>
            <Text className="text-base font-semibold text-text-primary">PowerLens</Text>
            <Text className="text-xs text-text-secondary">Version {APP_VERSION}</Text>
          </View>
        </View>
        <Text className="text-sm text-text-secondary leading-relaxed">
          Application de monitoring et contrôle énergétique. Fonctionnement basé sur des règles
          logiques déterministes et un module d'analyse Smart Supervisor, sans dépendance à une API
          IA externe.
        </Text>
      </Card>

      <Card>
        <View className="flex-row items-center gap-3 mb-3">
          <Info color={palette.navy700} size={18} />
          <Text className="text-sm font-medium text-text-secondary">SYSTÈME</Text>
        </View>
        <View className="gap-2">
          <View className="flex-row justify-between">
            <Text className="text-sm text-text-secondary">Bâtiment actif</Text>
            <Text className="text-sm text-text-primary">{building?.name ?? '—'}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-text-secondary">Mode</Text>
            <Text className="text-sm text-success">Production</Text>
          </View>
        </View>
      </Card>

      <Card>
        <Pressable onPress={resetOnboarding} className="flex-row items-center gap-2">
          <HelpCircle color={palette.navy700} size={16} />
          <Text className="text-sm text-primary font-medium">Revoir l'introduction</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}
