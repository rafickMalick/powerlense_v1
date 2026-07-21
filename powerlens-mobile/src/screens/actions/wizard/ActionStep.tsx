import { Text, View } from 'react-native';
import { Card, Chip } from '@/components/ui';
import type { WizardState } from './ruleWizardMapping';

interface Props {
  state: WizardState;
  patch: (partial: Partial<WizardState>) => void;
}

export function ActionStep({ state, patch }: Props) {
  return (
    <Card>
      <Text className="text-sm font-medium text-text-primary mb-3">Quand la condition est remplie</Text>
      <View className="flex-row gap-2">
        <Chip label="Couper" selected={state.action === 'SWITCH_OFF'} onPress={() => patch({ action: 'SWITCH_OFF' })} />
        <Chip label="Maintenir" selected={state.action === 'MAINTAIN'} onPress={() => patch({ action: 'MAINTAIN' })} />
      </View>
      <Text className="text-xs text-text-secondary mt-3">
        {state.action === 'SWITCH_OFF'
          ? 'Envoie une commande de coupure réelle à la charge sélectionnée.'
          : "Aucune commande n'est envoyée — utile pour documenter une intention sans agir sur le matériel."}
      </Text>
    </Card>
  );
}
