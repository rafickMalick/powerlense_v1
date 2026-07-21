import { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Lightbulb, TrendingUp, AlertTriangle } from 'lucide-react-native';
import { useSupervisorStore } from '@/store/supervisorStore';
import { Card, Badge, Button, Input, Label, EmptyState } from '@/components/ui';
import { getConditionDisplay, getActionDisplay } from '@/utils/ruleDisplay';
import { getAttentionPoints } from '@/utils/recommendationDisplay';
import { palette } from '@/theme/colors';
import { InfoTooltip } from '@/components/onboarding/InfoTooltip';
import type { SettingsStackParamList } from '@/navigation/types';
import type { RecommendationConfidence, RuleAction, RuleCondition } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<SettingsStackParamList, 'RecommendationDetail'>;

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

const TYPE_LABELS = {
  CREATE_RULE: 'Création de règle',
  MODIFY_RULE: 'Modification de règle',
  DELETE_RULE: 'Suppression de règle',
};

function ConditionSummary({ condition }: { condition: RuleCondition }) {
  const display = getConditionDisplay(condition);
  return (
    <View className="flex-row items-center gap-2">
      <Badge>{display.label}</Badge>
      <Text className="font-mono text-success text-sm">{display.value}</Text>
    </View>
  );
}

function ActionSummary({ action }: { action: RuleAction }) {
  const display = getActionDisplay(action);
  return (
    <View className="flex-row items-center gap-2">
      <View className={`${display.color} px-2 py-1 rounded`}>
        <Text className="text-xs text-white">{display.label}</Text>
      </View>
      <Text className="text-text-primary text-sm flex-1">{display.target}</Text>
    </View>
  );
}

export function RecommendationDetailScreen({ route, navigation }: Props) {
  useScreenViewLogging('RecommendationDetail');
  const { id } = route.params;
  const recommendations = useSupervisorStore((s) => s.recommendations);
  const approve = useSupervisorStore((s) => s.approve);
  const reject = useSupervisorStore((s) => s.reject);

  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);

  const recommendation = useMemo(
    () => recommendations.find((r) => r.id === id),
    [recommendations, id],
  );

  if (!recommendation) {
    return <EmptyState title="Recommandation introuvable" />;
  }

  const isPending = recommendation.status === 'PENDING';

  const handleApprove = async () => {
    setSubmitting('approve');
    try {
      await approve(recommendation.id, comment ? { comment } : undefined);
      navigation.goBack();
    } finally {
      setSubmitting(null);
    }
  };

  const handleReject = async () => {
    setSubmitting('reject');
    try {
      await reject(recommendation.id, comment || undefined);
      navigation.goBack();
    } finally {
      setSubmitting(null);
    }
  };

  const attentionPoints = getAttentionPoints(recommendation);

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View>
        <Text className="text-text-primary text-lg font-semibold mb-2">{recommendation.title}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge variant="outline" textClassName="text-primary">
            {TYPE_LABELS[recommendation.type]}
          </Badge>
          <Badge className={`${CONFIDENCE_COLORS[recommendation.confidence]} border-0`}>
            {CONFIDENCE_LABELS[recommendation.confidence]}
          </Badge>
          <InfoTooltip
            tooltipKey="supervisor-confidence"
            title="Niveaux de confiance"
            description="Élevée : détection basée sur un historique riche et un signal clair. Moyenne : signal présent mais moins de données. Faible : tendance émergente, à valider avec prudence."
          />
        </View>
      </View>

      {/* Pourquoi */}
      <Card>
        <View className="flex-row items-center gap-2 mb-2">
          <Lightbulb color={palette.navy700} size={16} />
          <Text className="text-sm font-medium text-text-primary">POURQUOI</Text>
        </View>
        <Text className="text-sm text-text-secondary leading-relaxed">{recommendation.justification}</Text>
      </Card>

      {/* Gains */}
      <View className="bg-success-tint border border-success/30 rounded-lg p-4">
        <View className="flex-row items-center gap-2 mb-2">
          <TrendingUp color={palette.success} size={16} />
          <Text className="text-sm font-medium text-success">GAINS</Text>
        </View>
        <Text className="text-sm text-text-secondary mb-2">{recommendation.estimatedImpact}</Text>
        {(recommendation.estimatedSavingsKwh != null || recommendation.estimatedSavingsEur != null) && (
          <View className="flex-row gap-4 mt-1">
            {recommendation.estimatedSavingsKwh != null && (
              <Text className="text-sm font-semibold text-success">
                ~{recommendation.estimatedSavingsKwh.toFixed(1)} kWh / mois
              </Text>
            )}
            {recommendation.estimatedSavingsEur != null && (
              <Text className="text-sm font-semibold text-success">
                ~{recommendation.estimatedSavingsEur.toFixed(2)} € / mois
              </Text>
            )}
          </View>
        )}
      </View>

      {/* Points d'attention — dérivés côté client, pas un champ backend (cf. utils/recommendationDisplay.ts) */}
      {attentionPoints.length > 0 && (
        <View className="bg-warning-tint border border-warning/30 rounded-lg p-4">
          <View className="flex-row items-center gap-2 mb-2">
            <AlertTriangle color={palette.warning} size={16} />
            <Text className="text-sm font-medium text-warning">POINTS D'ATTENTION</Text>
          </View>
          <View className="gap-1.5">
            {attentionPoints.map((point) => (
              <Text key={point} className="text-sm text-text-secondary">• {point}</Text>
            ))}
          </View>
        </View>
      )}

      {recommendation.targetRule && (
        <Card>
          <Text className="text-sm font-medium text-text-primary mb-3">RÈGLE ACTUELLE</Text>
          <Text className="text-sm text-text-secondary mb-2">{recommendation.targetRule.name}</Text>
          <View className="bg-surface-alt rounded p-3 gap-2">
            <ConditionSummary condition={recommendation.targetRule.conditions} />
            {recommendation.targetRule.actions.map((action, i) => (
              <ActionSummary key={i} action={action} />
            ))}
          </View>
        </Card>
      )}

      {(recommendation.proposedConditions || recommendation.proposedActions) && (
        <Card>
          <Text className="text-sm font-medium text-text-primary mb-3">
            {recommendation.type === 'CREATE_RULE' ? 'RÈGLE PROPOSÉE' : 'NOUVELLE CONFIGURATION PROPOSÉE'}
          </Text>
          <View className="bg-surface-alt rounded p-3 gap-2">
            {recommendation.proposedConditions && (
              <ConditionSummary condition={recommendation.proposedConditions} />
            )}
            {recommendation.proposedActions?.map((action, i) => <ActionSummary key={i} action={action} />)}
          </View>
        </Card>
      )}

      {recommendation.status !== 'PENDING' && (
        <Card>
          <Text className="text-sm font-medium text-text-primary mb-2">STATUT</Text>
          <Text className="text-sm text-text-secondary">{recommendation.status}</Text>
          {recommendation.reviewComment && (
            <Text className="text-sm text-text-muted mt-2">"{recommendation.reviewComment}"</Text>
          )}
        </Card>
      )}

      {isPending && (
        <Card>
          <Label>Commentaire (optionnel)</Label>
          <Input
            value={comment}
            onChangeText={setComment}
            placeholder="Ajouter un commentaire pour le journal d'audit"
            multiline
          />
        </Card>
      )}

      {isPending && (
        <View className="flex-row gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            onPress={handleReject}
            loading={submitting === 'reject'}
            disabled={submitting !== null}
          >
            Rejeter
          </Button>
          <Button
            variant="success"
            className="flex-1"
            onPress={handleApprove}
            loading={submitting === 'approve'}
            disabled={submitting !== null}
          >
            Approuver
          </Button>
        </View>
      )}
    </ScrollView>
  );
}
