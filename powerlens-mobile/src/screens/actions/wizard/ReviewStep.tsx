import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { Card, Input, Label } from '@/components/ui';
import { getActionDisplay, getConditionDisplay } from '@/utils/ruleDisplay';
import type { Circuit, MonitoringZone } from '@/types/models';
import { buildActionsFromWizard, buildConditionFromWizard, type WizardState } from './ruleWizardMapping';

interface Props {
  state: WizardState;
  patch: (partial: Partial<WizardState>) => void;
  zones: MonitoringZone[];
  circuits: Circuit[];
}

export function ReviewStep({ state, patch, zones, circuits }: Props) {
  const zoneName = zones.find((z) => z.id === state.zoneId)?.name ?? '—';
  const chargeLabel =
    state.chargeMode === 'ZONE'
      ? 'Toute la zone'
      : circuits
          .filter((c) => state.circuitIds.includes(c.id))
          .map((c) => c.name)
          .join(', ') || '—';

  // Ne génère un nom par défaut qu'une seule fois, au premier affichage de
  // cette étape — ne doit pas écraser un nom déjà choisi/modifié par l'utilisateur.
  useEffect(() => {
    if (!state.name.trim()) {
      const verb = state.action === 'SWITCH_OFF' ? 'Couper' : 'Maintenir';
      patch({ name: `${verb} ${chargeLabel} — ${zoneName}` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const condition = buildConditionFromWizard(state);
  const actions = buildActionsFromWizard(state);
  const conditionDisplay = getConditionDisplay(condition);
  const actionDisplay = getActionDisplay(actions[0]);

  return (
    <View className="gap-4">
      <Card>
        <Label>Nom de la règle</Label>
        <Input value={state.name} onChangeText={(v) => patch({ name: v })} placeholder="Ex: Extinction éclairage salle" />
      </Card>

      <Card className="gap-2">
        <Text className="text-sm font-medium text-text-primary mb-1">Récapitulatif</Text>
        <Text className="text-text-secondary text-sm">
          SI <Text className="font-medium text-text-primary">{conditionDisplay.label}</Text> {conditionDisplay.value}
        </Text>
        <Text className="text-text-secondary text-sm">
          Zone : <Text className="font-medium text-text-primary">{zoneName}</Text>
        </Text>
        <Text className="text-text-secondary text-sm">
          Charge : <Text className="font-medium text-text-primary">{chargeLabel}</Text>
        </Text>
        <Text className="text-text-secondary text-sm">
          ALORS <Text className="font-medium text-text-primary">{actionDisplay.label}</Text>
        </Text>
        {state.preservedTailActions.length > 0 && (
          <Text className="text-xs text-text-secondary mt-2">
            + alerte conservée depuis la règle d'origine (non modifiable ici)
          </Text>
        )}
      </Card>
    </View>
  );
}
