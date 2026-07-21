import { useEffect, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Plus, Trash2, Pencil, Play, Pause, Building2 } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useRulesStore } from '@/store/rulesStore';
import { Card, Button, Switch, Badge, EmptyState, Modal } from '@/components/ui';
import { palette } from '@/theme/colors';
import { getActionDisplay, getConditionDisplay } from '@/utils/ruleDisplay';
import type { ActionsStackParamList } from '@/navigation/types';
import type { Rule } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<ActionsStackParamList, 'ActionsReactions'>;

export function ActionsReactionsScreen({ navigation }: Props) {
  useScreenViewLogging('ActionsReactions');
  const building = useActiveBuilding();
  const rules = useRulesStore((s) => s.rules);
  const fetchRules = useRulesStore((s) => s.fetchRules);
  const toggleRule = useRulesStore((s) => s.toggleRule);
  const deleteRule = useRulesStore((s) => s.deleteRule);

  const [pendingDeleteRule, setPendingDeleteRule] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const confirmDelete = async () => {
    if (!pendingDeleteRule) return;
    setDeleting(true);
    try {
      await deleteRule(pendingDeleteRule.id);
    } finally {
      setDeleting(false);
      setPendingDeleteRule(null);
    }
  };

  const renderItem = ({ item: rule }: { item: Rule }) => {
    const condition = getConditionDisplay(rule.conditions);
    const action = getActionDisplay(rule.actions[0] ?? { device: '—', state: 0 });

    return (
      <Card className={rule.isActive ? 'border-primary/30' : undefined}>
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-2 mb-1">
              <Text className="font-medium text-text-primary">{rule.name}</Text>
              {rule.isActive ? (
                <Badge className="bg-success">
                  <View className="flex-row items-center gap-1">
                    <Play color={palette.white} size={12} />
                    <Text className="text-xs text-white font-medium">Actif</Text>
                  </View>
                </Badge>
              ) : (
                <Badge variant="secondary">
                  <View className="flex-row items-center gap-1">
                    <Pause color={palette.gray500} size={12} />
                    <Text className="text-xs text-text-secondary font-medium">Inactif</Text>
                  </View>
                </Badge>
              )}
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            <Text onPress={() => navigation.navigate('RuleForm', { ruleId: rule.id })}>
              <Pencil color={palette.gray500} size={16} />
            </Text>
            <Text onPress={() => setPendingDeleteRule(rule)}>
              <Trash2 color={palette.danger} size={16} />
            </Text>
          </View>
        </View>

        <View className="bg-surface-alt rounded p-3 mb-3 flex-row flex-wrap items-center gap-2">
          <Text className="text-text-secondary text-sm">SI</Text>
          <Badge>{condition.label}</Badge>
          <Text className="font-mono text-success text-sm">{condition.value}</Text>
          <Text className="text-text-secondary text-sm">→</Text>
          <View className={`${action.color} px-2 py-1 rounded`}>
            <Text className="text-xs text-white">{action.label}</Text>
          </View>
          <Text className="text-text-primary text-sm">{action.target}</Text>
        </View>

        <View className="flex-row items-center justify-between pt-3 border-t border-border">
          <Text className="text-sm text-text-secondary">Règle active</Text>
          <Switch value={rule.isActive} onValueChange={() => toggleRule(rule)} />
        </View>
      </Card>
    );
  };

  return (
    <>
      <FlatList
        className="flex-1 bg-surface-alt"
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={rules}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListHeaderComponent={
          <View className="gap-3 mb-3">
            <Card>
              <Text className="text-sm font-medium text-text-secondary mb-1">ACTIONS & RÉACTIONS</Text>
              <Text className="text-2xl font-bold text-text-primary">{rules.length} Règles</Text>
              <Text className="text-xs text-text-secondary mt-1">{building.name}</Text>
            </Card>

            <Button onPress={() => navigation.navigate('RuleForm', undefined)}>
              <View className="flex-row items-center gap-2">
                <Plus color={palette.white} size={20} />
                <Text className="text-white font-medium">Créer une Règle</Text>
              </View>
            </Button>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={Play}
            title="Aucune règle configurée"
            subtitle="Les règles permettent d'automatiser les actions"
          />
        }
        renderItem={renderItem}
      />

      <Modal
        visible={pendingDeleteRule !== null}
        onClose={() => setPendingDeleteRule(null)}
        title="Supprimer la règle ?"
        description={pendingDeleteRule ? `"${pendingDeleteRule.name}" sera désactivée définitivement.` : undefined}
        footer={
          <View className="flex-row gap-3">
            <Button variant="outline" className="flex-1" onPress={() => setPendingDeleteRule(null)}>
              Annuler
            </Button>
            <Button variant="destructive" className="flex-1" onPress={confirmDelete} loading={deleting}>
              Supprimer
            </Button>
          </View>
        }
      />
    </>
  );
}
