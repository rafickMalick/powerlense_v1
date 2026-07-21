import { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Sparkles, Plus, Pencil, Trash2, Building2 } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { useSupervisorStore } from '@/store/supervisorStore';
import { Card, Badge, EmptyState, Chip, ErrorState } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { SettingsStackParamList } from '@/navigation/types';
import type { RecommendationConfidence, RecommendationStatus, RuleRecommendation } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<SettingsStackParamList, 'RecommendationsList'>;

const TABS: { label: string; statuses: RecommendationStatus[] }[] = [
  { label: 'En attente', statuses: ['PENDING'] },
  { label: 'Traitées', statuses: ['APPROVED', 'APPLIED', 'REJECTED'] },
];

const CONFIDENCE_LABELS: Record<RecommendationConfidence, string> = {
  HIGH: 'Confiance élevée',
  MEDIUM: 'Confiance moyenne',
  LOW: 'Confiance faible',
};

const CONFIDENCE_COLORS: Record<RecommendationConfidence, string> = {
  HIGH: 'bg-success',
  MEDIUM: 'bg-warning',
  LOW: 'bg-danger',
};

const TYPE_ICONS: Record<RuleRecommendation['type'], typeof Plus> = {
  CREATE_RULE: Plus,
  MODIFY_RULE: Pencil,
  DELETE_RULE: Trash2,
};

const TYPE_LABELS: Record<RuleRecommendation['type'], string> = {
  CREATE_RULE: 'Nouvelle règle',
  MODIFY_RULE: 'Modifier la règle',
  DELETE_RULE: 'Supprimer la règle',
};

const STATUS_LABELS: Record<RecommendationStatus, string> = {
  PENDING: 'En attente',
  APPROVED: 'Approuvée',
  APPLIED: 'Appliquée',
  REJECTED: 'Rejetée',
};

export function RecommendationsListScreen({ navigation }: Props) {
  useScreenViewLogging('RecommendationsList');
  const building = useActiveBuilding();
  const recommendations = useSupervisorStore((s) => s.recommendations);
  const loading = useSupervisorStore((s) => s.loading);
  const error = useSupervisorStore((s) => s.error);
  const fetchRecommendations = useSupervisorStore((s) => s.fetchRecommendations);
  const [tabIndex, setTabIndex] = useState(0);

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  if (error && recommendations.length === 0) {
    return <ErrorState title={error} onRetry={() => fetchRecommendations()} />;
  }

  const activeStatuses = TABS[tabIndex].statuses;
  const items = recommendations.filter((r) => activeStatuses.includes(r.status));

  const renderItem = ({ item }: { item: RuleRecommendation }) => {
    const Icon = TYPE_ICONS[item.type];

    return (
      <Pressable onPress={() => navigation.navigate('RecommendationDetail', { id: item.id })}>
        <Card>
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-row items-center gap-2 flex-1">
              <Icon color={palette.navy700} size={18} />
              <Text className="font-medium text-text-primary flex-1">{item.title}</Text>
            </View>
          </View>

          <View className="flex-row flex-wrap items-center gap-2 mb-2">
            <Badge variant="outline" textClassName="text-primary">
              {TYPE_LABELS[item.type]}
            </Badge>
            <Badge className={`${CONFIDENCE_COLORS[item.confidence]} border-0`}>
              {CONFIDENCE_LABELS[item.confidence]}
            </Badge>
            {item.status !== 'PENDING' && <Badge variant="secondary">{STATUS_LABELS[item.status]}</Badge>}
          </View>

          <Text className="text-sm text-text-secondary" numberOfLines={2}>
            {item.justification}
          </Text>

          {(item.estimatedSavingsKwh != null || item.estimatedSavingsEur != null) && (
            <View className="flex-row gap-4 mt-3 pt-3 border-t border-border">
              {item.estimatedSavingsKwh != null && (
                <Text className="text-xs font-semibold text-success">
                  ~{item.estimatedSavingsKwh.toFixed(1)} kWh / mois
                </Text>
              )}
              {item.estimatedSavingsEur != null && (
                <Text className="text-xs font-semibold text-success">
                  ~{item.estimatedSavingsEur.toFixed(2)} € / mois
                </Text>
              )}
            </View>
          )}
        </Card>
      </Pressable>
    );
  };

  return (
    <FlatList
      className="flex-1 bg-surface-alt"
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={items}
      keyExtractor={(item) => item.id}
      ItemSeparatorComponent={() => <View className="h-3" />}
      ListHeaderComponent={
        <View className="gap-3 mb-3">
          <Card>
            <View className="flex-row items-center gap-2 mb-1">
              <Sparkles color={palette.navy700} size={18} />
              <Text className="text-sm font-medium text-text-secondary">RECOMMANDATIONS IA</Text>
            </View>
            <Text className="text-2xl font-bold text-text-primary">{items.length} recommandation(s)</Text>
            <Text className="text-xs text-text-secondary mt-1">{building.name}</Text>
          </Card>

          <View className="flex-row gap-2">
            {TABS.map((tab, index) => (
              <Chip
                key={tab.label}
                label={tab.label}
                selected={tabIndex === index}
                onPress={() => setTabIndex(index)}
                className="flex-1 items-center"
              />
            ))}
          </View>
        </View>
      }
      ListEmptyComponent={
        !loading ? (
          <EmptyState
            icon={Sparkles}
            title="Aucune recommandation"
            subtitle="Le superviseur analysera les données chaque nuit"
          />
        ) : null
      }
      renderItem={renderItem}
    />
  );
}
