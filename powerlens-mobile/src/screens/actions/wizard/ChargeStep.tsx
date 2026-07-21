import { ActivityIndicator, Text, View } from 'react-native';
import { Card, Chip } from '@/components/ui';
import type { Circuit } from '@/types/models';
import type { WizardState } from './ruleWizardMapping';

interface Props {
  circuits: Circuit[];
  loading: boolean;
  state: WizardState;
  patch: (partial: Partial<WizardState>) => void;
}

export function ChargeStep({ circuits, loading, state, patch }: Props) {
  const toggleCircuit = (id: string) => {
    const selected = state.circuitIds.includes(id);
    patch({
      chargeMode: 'CIRCUITS',
      circuitIds: selected ? state.circuitIds.filter((c) => c !== id) : [...state.circuitIds, id],
    });
  };

  if (loading) {
    return <ActivityIndicator className="mt-8" />;
  }

  return (
    <Card>
      <Text className="text-sm font-medium text-text-primary mb-3">Choisir la ou les charges</Text>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="Toute la zone"
          selected={state.chargeMode === 'ZONE'}
          onPress={() => patch({ chargeMode: 'ZONE', circuitIds: [] })}
        />
        {circuits.map((circuit) => (
          <Chip
            key={circuit.id}
            label={circuit.name}
            selected={state.chargeMode === 'CIRCUITS' && state.circuitIds.includes(circuit.id)}
            onPress={() => toggleCircuit(circuit.id)}
          />
        ))}
      </View>
      {state.chargeMode === 'ZONE' && (
        <Text className="text-xs text-text-secondary mt-3">
          S'applique à tous les circuits actifs non-critiques de la zone.
        </Text>
      )}
    </Card>
  );
}
