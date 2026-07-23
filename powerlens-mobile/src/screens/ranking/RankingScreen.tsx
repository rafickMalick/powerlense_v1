import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { Trophy, Medal, Building2, ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { Card, Badge, Chip, ProgressBar, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import * as rankingService from '@/services/ranking';
import type { RankingEntry, RankingPeriod, RankingResponse } from '@/services/ranking';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const PERIODS: { value: RankingPeriod; label: string }[] = [
  { value: 'week', label: 'Semaine' },
  { value: 'month', label: 'Mois' },
  { value: 'quarter', label: 'Trimestre' },
];

const BREAKDOWN_LABELS: Record<keyof RankingEntry['breakdown'], string> = {
  consumptionTrend: 'Tendance conso.',
  stability: 'Stabilité',
  alertFrequency: 'Fréquence alertes',
  recommendationCompliance: 'Conformité recommandations',
  efficiency: 'Efficacité (cos φ)',
};

// Fonction (et non constante) : suit la bascule clair/sombre.
const podiumColor = (i: number) => [palette.warning, palette.gray400, "#B45309"][i];

function RankRow({ entry }: { entry: RankingEntry }) {
  const [expanded, setExpanded] = useState(false);
  const TrendIcon = entry.improvementPercent >= 0 ? TrendingDown : TrendingUp;
  const trendColor = entry.improvementPercent >= 0 ? palette.success : palette.danger;

  return (
    <Card>
      <Pressable onPress={() => setExpanded((e) => !e)} className="flex-row items-center gap-3">
        <View className="w-7 h-7 rounded-full bg-surface-alt items-center justify-center">
          <Text className="text-sm font-bold text-text-secondary">{entry.rank}</Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-sm font-medium text-text-primary">{entry.zoneName}</Text>
            <Badge variant="outline">{entry.zoneType === 'ROOM' ? 'Salle' : 'Couloir'}</Badge>
            {entry.badge === 'CHAMPION' && <Badge className="bg-warning border-0">🏆 Champion</Badge>}
          </View>
          <View className="flex-row items-center gap-1 mt-1">
            <TrendIcon size={12} color={trendColor} />
            <Text style={{ color: trendColor }} className="text-xs">
              {entry.improvementPercent >= 0 ? '+' : ''}
              {entry.improvementPercent.toFixed(1)}% vs période précédente
            </Text>
            {entry.alertCount > 0 && (
              <Text className="text-xs text-text-muted"> · {entry.alertCount} alerte{entry.alertCount > 1 ? 's' : ''}</Text>
            )}
          </View>
        </View>
        <View className="items-end">
          <Text className="text-lg font-mono font-bold text-primary">{entry.score.toFixed(0)}</Text>
          {expanded ? (
            <ChevronUp size={14} color={palette.gray400} />
          ) : (
            <ChevronDown size={14} color={palette.gray400} />
          )}
        </View>
      </Pressable>

      {expanded && (
        <View className="mt-4 gap-3 pt-3 border-t border-border">
          {(Object.keys(entry.breakdown) as (keyof RankingEntry['breakdown'])[]).map((key) => (
            <View key={key}>
              <View className="flex-row justify-between mb-1">
                <Text className="text-xs text-text-secondary">{BREAKDOWN_LABELS[key]}</Text>
                <Text className="text-xs font-mono text-text-primary">{entry.breakdown[key].toFixed(0)}</Text>
              </View>
              <ProgressBar percent={entry.breakdown[key]} />
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export function RankingScreen() {
  useScreenViewLogging('Ranking');
  const building = useActiveBuilding();

  const [period, setPeriod] = useState<RankingPeriod>('month');
  const [data, setData] = useState<RankingResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!building) return;
    setLoading(true);
    try {
      const result = await rankingService.getRanking(building.id, period);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [building?.id, period]);

  useEffect(() => {
    load();
  }, [load]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const ranking = data?.ranking ?? [];
  const podium = ranking.slice(0, 3);

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View className="flex-row gap-2">
        {PERIODS.map((p) => (
          <Chip key={p.value} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />
        ))}
      </View>

      {loading && ranking.length === 0 ? (
        <View className="h-44 items-center justify-center">
          <ActivityIndicator color={palette.navy700} size="large" />
        </View>
      ) : ranking.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="Pas encore de classement"
          subtitle="Il faut au moins une période précédente complète (avec consommation) pour classer une salle ou un couloir."
        />
      ) : (
        <>
          {podium.length > 0 && (
            <Card>
              <Text className="text-sm font-medium text-text-secondary mb-4">PODIUM</Text>
              <View className="flex-row items-end justify-around">
                {podium.map((entry, i) => (
                  <View key={entry.zoneId} className="items-center flex-1">
                    <Medal color={podiumColor(i)} size={i === 0 ? 28 : 22} />
                    <Text className="text-xs text-text-primary font-medium mt-1 text-center" numberOfLines={1}>
                      {entry.zoneName}
                    </Text>
                    <Text className="text-base font-mono font-bold text-text-primary">{entry.score.toFixed(0)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          )}

          <View className="gap-2">
            <Text className="text-sm font-medium text-text-secondary px-1">CLASSEMENT COMPLET</Text>
            {ranking.map((entry) => (
              <RankRow key={entry.zoneId} entry={entry} />
            ))}
          </View>

          <Card>
            <Text className="text-xs text-text-muted leading-relaxed">
              Score composite : {Object.entries(data?.methodology.weights ?? {})
                .map(([k, w]) => `${BREAKDOWN_LABELS[k as keyof RankingEntry['breakdown']] ?? k} (${Math.round(w * 100)}%)`)
                .join(' · ')}
              . Les zones sans historique de la période précédente sont exclues du classement.
            </Text>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
