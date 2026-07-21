import { View } from 'react-native';
import { Card, Label, Input, Select, TimeInput, Chip } from '@/components/ui';
import { THRESHOLD_FIELDS, type WizardState } from './ruleWizardMapping';

const CONDITION_TYPE_OPTIONS = [
  { label: 'Seuil (tension, courant, puissance, température)', value: 'THRESHOLD' },
  { label: 'Intervalle horaire', value: 'SCHEDULE' },
  { label: 'Présence', value: 'PRESENCE' },
];

const OPERATOR_OPTIONS = [
  { label: 'Supérieur à (>)', value: '>' },
  { label: 'Inférieur à (<)', value: '<' },
];

const DAYS_PRESET_OPTIONS: { label: string; value: WizardState['schedule']['daysPreset'] }[] = [
  { label: 'Tous les jours', value: 'ALL' },
  { label: 'Semaine (lun-ven)', value: 'WEEKDAYS' },
  { label: 'Week-end', value: 'WEEKEND' },
];

interface Props {
  state: WizardState;
  patch: (partial: Partial<WizardState>) => void;
}

export function ConditionTypeStep({ state, patch }: Props) {
  return (
    <View className="gap-4">
      <Card>
        <Label>Type de condition</Label>
        <View className="mt-1">
          <Select
            value={state.conditionType}
            onValueChange={(v) => patch({ conditionType: v as WizardState['conditionType'] })}
            options={CONDITION_TYPE_OPTIONS}
            title="Type de condition"
          />
        </View>
      </Card>

      {state.conditionType === 'THRESHOLD' && (
        <Card className="gap-3">
          <View>
            <Label>Capteur</Label>
            <View className="mt-1">
              <Select
                value={state.threshold.field}
                onValueChange={(v) =>
                  patch({ threshold: { ...state.threshold, field: v as WizardState['threshold']['field'] } })
                }
                options={THRESHOLD_FIELDS.map((f) => ({ label: `${f.label} (${f.unit})`, value: f.value }))}
                title="Capteur"
              />
            </View>
          </View>
          <View>
            <Label>Comparaison</Label>
            <View className="mt-1">
              <Select
                value={state.threshold.operator}
                onValueChange={(v) => patch({ threshold: { ...state.threshold, operator: v as '>' | '<' } })}
                options={OPERATOR_OPTIONS}
                title="Comparaison"
              />
            </View>
          </View>
          <View>
            <Label>Valeur seuil</Label>
            <Input
              value={state.threshold.value}
              onChangeText={(v) => patch({ threshold: { ...state.threshold, value: v } })}
              keyboardType="numeric"
              placeholder="Ex: 500"
            />
          </View>
        </Card>
      )}

      {state.conditionType === 'SCHEDULE' && (
        <Card className="gap-4">
          <View className="flex-row gap-4">
            <View className="flex-1">
              <TimeInput
                label="Début"
                value={state.schedule.startTime}
                onChange={(v) => patch({ schedule: { ...state.schedule, startTime: v } })}
              />
            </View>
            <View className="flex-1">
              <TimeInput
                label="Fin"
                value={state.schedule.endTime}
                onChange={(v) => patch({ schedule: { ...state.schedule, endTime: v } })}
              />
            </View>
          </View>
          <View>
            <Label>Jours</Label>
            <View className="flex-row flex-wrap gap-2 mt-1">
              {DAYS_PRESET_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  selected={state.schedule.daysPreset === opt.value}
                  onPress={() => patch({ schedule: { ...state.schedule, daysPreset: opt.value } })}
                />
              ))}
            </View>
          </View>
        </Card>
      )}

      {state.conditionType === 'PRESENCE' && (
        <Card>
          <Label>Présence attendue</Label>
          <View className="flex-row gap-2 mt-1">
            <Chip
              label="Présent"
              selected={state.presence.expected === 'PRESENT'}
              onPress={() => patch({ presence: { expected: 'PRESENT' } })}
            />
            <Chip
              label="Absent"
              selected={state.presence.expected === 'ABSENT'}
              onPress={() => patch({ presence: { expected: 'ABSENT' } })}
            />
          </View>
        </Card>
      )}
    </View>
  );
}
