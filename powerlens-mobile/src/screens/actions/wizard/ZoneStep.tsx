import { ActivityIndicator, Text, View } from 'react-native';
import { Card, Chip } from '@/components/ui';
import type { MonitoringZone } from '@/types/models';
import type { WizardState } from './ruleWizardMapping';

interface Props {
  zones: MonitoringZone[];
  loading: boolean;
  state: WizardState;
  patch: (partial: Partial<WizardState>) => void;
}

export function ZoneStep({ zones, loading, state, patch }: Props) {
  if (loading) {
    return <ActivityIndicator className="mt-8" />;
  }

  return (
    <Card>
      <Text className="text-sm font-medium text-text-primary mb-3">Choisir une salle ou un couloir</Text>
      <View className="flex-row flex-wrap gap-2">
        {zones.map((zone) => (
          <Chip
            key={zone.id}
            label={zone.name}
            selected={state.zoneId === zone.id}
            onPress={() => patch({ zoneId: zone.id, chargeMode: 'CIRCUITS', circuitIds: [] })}
          />
        ))}
      </View>
    </Card>
  );
}
