import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Receipt, Building2, TrendingUp, PiggyBank, LineChart } from 'lucide-react-native';
import { useActiveBuilding } from '@/store/buildingStore';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { ConsumptionAreaChart } from '@/components/charts/ConsumptionAreaChart';
import { palette } from '@/theme/colors';
import * as billingService from '@/services/billing';
import type { BillingEstimate, BillingRecord, TariffPlan } from '@/services/billing';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

function fmtFcfa(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} FCFA`;
}

function fmtPeriod(periodStart: string): string {
  return new Date(periodStart).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function fmtPeriodShort(periodStart: string): string {
  return new Date(periodStart).toLocaleDateString('fr-FR', { month: 'short' });
}

function fmtVariation(percent: number): string {
  const sign = percent > 0 ? '+' : '';
  return `${sign}${percent.toFixed(1)}%`;
}

/** Ligne « libellé …… montant » du détail de facture. */
function BillLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between py-1">
      <Text className="text-sm text-text-secondary">{label}</Text>
      <Text className="text-sm font-mono text-text-primary">{value}</Text>
    </View>
  );
}

export function BillingScreen() {
  useScreenViewLogging('Billing');
  const building = useActiveBuilding();
  const { width } = useWindowDimensions();

  const [tariff, setTariff] = useState<TariffPlan | null>(null);
  const [estimate, setEstimate] = useState<BillingEstimate | null>(null);
  const [history, setHistory] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [noTariff, setNoTariff] = useState(false);

  const load = useCallback(async () => {
    if (!building) return;
    setLoading(true);
    setNoTariff(false);
    try {
      const [tariffResult, estimateResult, historyResult] = await Promise.allSettled([
        billingService.getTariff(building.id),
        billingService.getCurrentEstimate(building.id),
        billingService.getHistory(building.id),
      ]);

      if (tariffResult.status === 'fulfilled') setTariff(tariffResult.value);
      else setNoTariff(true);

      setEstimate(estimateResult.status === 'fulfilled' ? estimateResult.value : null);
      setHistory(historyResult.status === 'fulfilled' ? historyResult.value : []);
    } finally {
      setLoading(false);
    }
  }, [building?.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  if (loading && !tariff && !estimate) {
    return (
      <View className="flex-1 bg-surface-alt items-center justify-center">
        <ActivityIndicator color={palette.navy700} size="large" />
      </View>
    );
  }

  if (noTariff) {
    return (
      <EmptyState
        icon={Receipt}
        title="Aucun tarif configuré"
        subtitle="Ce bâtiment n'a pas encore de plan tarifaire assigné."
      />
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Tarif actif */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-1">TARIF ACTIF</Text>
        <Text className="text-text-primary font-bold text-base">{tariff?.name}</Text>
        <View className="flex-row gap-4 mt-3">
          <View>
            <Text className="text-xs text-text-secondary">Prix du kWh</Text>
            <Text className="font-mono text-text-primary text-sm mt-0.5">
              {estimate ? `${estimate.currentPricePerKwhFcfa.toFixed(0)} FCFA/kWh` : '—'}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-text-secondary">TVA</Text>
            <Text className="font-mono text-text-primary text-sm mt-0.5">
              {estimate?.vatRate != null ? `${(estimate.vatRate * 100).toFixed(0)} %` : '18 %'}
            </Text>
          </View>
        </View>
        <Text className="text-xs text-text-muted mt-3">
          Facturation SBEE Base Tension (grille officielle : consommation + charges fixes + TVA).
        </Text>
      </Card>

      {/* Détail de la facture SBEE (HT → TVA → Net à payer) */}
      {estimate && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-3">DÉTAIL DE LA FACTURE</Text>
          <BillLine label="Consommation" value={fmtFcfa(estimate.consumptionCostFcfa ?? 0)} />
          {!!estimate.fixedChargeDFcfa && (
            <BillLine label="Prime fixe (D)" value={fmtFcfa(estimate.fixedChargeDFcfa)} />
          )}
          {!!(estimate.taxEFcfa || estimate.taxFFcfa) && (
            <BillLine
              label="Taxes (E + F)"
              value={fmtFcfa((estimate.taxEFcfa ?? 0) + (estimate.taxFFcfa ?? 0))}
            />
          )}
          <BillLine label="Montant HT" value={fmtFcfa(estimate.montantHTFcfa ?? 0)} />
          <BillLine
            label={`TVA (${((estimate.vatRate ?? 0.18) * 100).toFixed(0)} %)`}
            value={fmtFcfa(estimate.tvaFcfa ?? 0)}
          />
          <View className="h-px bg-border my-2" />
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-text-primary">Net à payer</Text>
            <Text className="text-base font-bold text-success">
              {fmtFcfa(estimate.netAPayerFcfa ?? estimate.totalCostFcfa)}
            </Text>
          </View>
        </Card>
      )}

      {/* Estimation du mois en cours */}
      <View className="flex-row gap-4">
        <StatCard
          className="flex-1"
          label="Consommation du mois"
          icon={TrendingUp}
          iconColor={palette.navy700}
          value={estimate ? `${estimate.totalKwh.toFixed(1)} kWh` : '—'}
        />
        <StatCard
          className="flex-1"
          label="Net à payer estimé"
          icon={Receipt}
          iconColor={palette.success}
          valueClassName="text-success"
          value={estimate ? fmtFcfa(estimate.totalCostFcfa) : '—'}
          trend={
            estimate?.variationPercent != null
              ? {
                  direction: estimate.variationPercent > 0 ? 'up' : 'down',
                  label: `${fmtVariation(estimate.variationPercent)} vs mois dernier`,
                }
              : undefined
          }
        />
      </View>

      {/* Économies estimées (Smart Supervisor) + prévision */}
      {(estimate?.estimatedSavingsFcfa || history[0]?.forecastNextMonthFcfa) && (
        <View className="flex-row gap-4">
          {!!estimate?.estimatedSavingsFcfa && (
            <StatCard
              className="flex-1"
              label="Économie estimée (règles IA)"
              icon={PiggyBank}
              iconColor={palette.success}
              valueClassName="text-success"
              value={fmtFcfa(estimate.estimatedSavingsFcfa)}
            />
          )}
          {!!history[0]?.forecastNextMonthFcfa && (
            <StatCard
              className="flex-1"
              label="Prévision mois prochain"
              icon={LineChart}
              iconColor={palette.warning}
              value={fmtFcfa(history[0].forecastNextMonthFcfa)}
            />
          )}
        </View>
      )}

      {/* Évolution du coût mensuel */}
      {history.length > 1 && (
        <Card>
          <Text className="text-sm font-medium text-text-secondary mb-4">ÉVOLUTION DU COÛT MENSUEL</Text>
          <ConsumptionAreaChart
            data={[...history]
              .reverse()
              .map((r) => ({ time: fmtPeriodShort(r.periodStart), value: Math.round(r.totalCostFcfa) }))}
            width={Math.max(200, width - 64)}
          />
        </Card>
      )}

      {/* Historique des factures */}
      <View className="gap-2">
        <Text className="text-sm font-medium text-text-secondary px-1">
          HISTORIQUE DES FACTURES {history.length > 0 ? `(${history.length})` : ''}
        </Text>
        {history.length === 0 ? (
          <Card>
            <Text className="text-text-secondary text-sm text-center py-2">
              Aucune facture générée pour le moment
            </Text>
          </Card>
        ) : (
          history.map((record) => (
            <Card key={record.id}>
              <View className="flex-row items-center justify-between">
                <View className="flex-1">
                  <Text className="text-text-primary font-medium text-sm capitalize">
                    {fmtPeriod(record.periodStart)}
                  </Text>
                  <Text className="text-text-secondary text-xs mt-0.5">
                    {record.totalKwh.toFixed(1)} kWh · {record.pricePerKwhFcfa} FCFA/kWh de base
                  </Text>
                  {!!record.estimatedSavingsFcfa && (
                    <Text className="text-success text-xs mt-0.5">
                      Économie IA : {fmtFcfa(record.estimatedSavingsFcfa)}
                    </Text>
                  )}
                </View>
                <View className="items-end">
                  <Text className="font-mono font-bold text-text-primary text-base">
                    {fmtFcfa(record.totalCostFcfa)}
                  </Text>
                  {record.variationPercent != null && (
                    <Text className={`text-xs mt-0.5 ${record.variationPercent > 0 ? 'text-danger' : 'text-success'}`}>
                      {fmtVariation(record.variationPercent)}
                    </Text>
                  )}
                </View>
              </View>
            </Card>
          ))
        )}
      </View>
    </ScrollView>
  );
}
