import { ScrollView, Text, View } from 'react-native';
import { Button, Card } from '@/components/ui';
import { getActionDisplay, getConditionDisplay } from '@/utils/ruleDisplay';
import type { Rule } from '@/types/models';

interface Props {
  rule: Rule;
  reason: string;
  onBack: () => void;
}

/**
 * Filet de sécurité anti-corruption : affiché quand une règle existante ne
 * peut pas être reconstruite intégralement dans l'assistant guidé (ex.
 * combinaison AND/OR, cibles sur plusieurs zones). Aucun chemin de
 * sauvegarde n'existe ici — la règle reste inchangée en base.
 */
export function NonConformingRuleView({ rule, reason, onBack }: Props) {
  const condition = getConditionDisplay(rule.conditions);

  return (
    <View className="flex-1 bg-surface-alt">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card className="border-warning/40 bg-warning/10">
          <Text className="text-warning font-medium mb-1">Configuration avancée</Text>
          <Text className="text-text-secondary text-sm">
            Cette règle utilise une configuration non prise en charge par l'assistant guidé. Modification bloquée
            pour éviter toute perte de données.
          </Text>
          <Text className="text-text-secondary text-xs mt-2">{reason}</Text>
        </Card>

        <Card className="gap-2">
          <Text className="text-sm font-medium text-text-primary">{rule.name}</Text>
          <Text className="text-text-secondary text-sm">
            SI {condition.label} — {condition.value}
          </Text>
          {rule.actions.map((action, i) => {
            const display = getActionDisplay(action);
            return (
              <Text key={i} className="text-text-secondary text-sm">
                ALORS {display.label} {display.target ? `— ${display.target}` : ''}
              </Text>
            );
          })}
        </Card>
      </ScrollView>

      <View className="p-4 border-t border-border">
        <Button variant="outline" onPress={onBack}>
          Retour
        </Button>
      </View>
    </View>
  );
}
