import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Power, AlertTriangle, Zap, Building2 } from 'lucide-react-native';
import { useActiveBuilding, useBuildingStore } from '@/store/buildingStore';
import { useUiStore } from '@/store/uiStore';
import { useMeasurementsStore } from '@/store/measurementsStore';
import { Card, Button, Modal, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import { InfoTooltip } from '@/components/onboarding/InfoTooltip';
import { triggerHaptic } from '@/utils/haptics';
import type { BuildingPowerStatus } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type ActionType = 'cutoff' | 'limit' | 'restore';

const STATUS_CONFIG: Record<BuildingPowerStatus, { color: string; label: string; icon: typeof Power }> = {
  POWERED: { color: 'bg-success', label: 'Alimenté', icon: Power },
  LIMITED: { color: 'bg-warning', label: 'Limité', icon: AlertTriangle },
  CUTOFF: { color: 'bg-danger', label: 'Coupé', icon: Power },
};

const ACTION_TO_STATUS: Record<ActionType, BuildingPowerStatus> = {
  cutoff: 'CUTOFF',
  limit: 'LIMITED',
  restore: 'POWERED',
};

export function ControlCenterScreen() {
  useScreenViewLogging('ControlCenter');
  const building = useActiveBuilding();
  const setBuildingPowerStatus = useBuildingStore((s) => s.setBuildingPowerStatus);
  const showToast = useUiStore((s) => s.showToast);
  const providerMode = useUiStore((s) => s.providerMode);
  const deviceOnline = useUiStore((s) => s.deviceOnline);
  // ESP attendu (mode matériel) mais absent : commandes grisées, elles
  // n'atteindraient aucun relais. En mode simulateur, les commandes restent
  // actives (démo sur données synthétiques).
  const espUnreachable = providerMode === 'mqtt' && !deviceOnline;
  const totalPower = useMeasurementsStore((s) => s.totalPower);
  const subscribe = useMeasurementsStore((s) => s.subscribe);
  const unsubscribe = useMeasurementsStore((s) => s.unsubscribe);
  const [pendingAction, setPendingAction] = useState<ActionType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    subscribe();
    return () => unsubscribe();
  }, [subscribe, unsubscribe]);

  if (!building) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  const statusConfig = STATUS_CONFIG[building.powerStatus];
  const StatusIcon = statusConfig.icon;
  const displayPower = (totalPower / 1000).toFixed(1);

  const confirmAction = async () => {
    if (!pendingAction) return;
    const newStatus = ACTION_TO_STATUS[pendingAction];

    setSubmitting(true);
    try {
      await setBuildingPowerStatus(building.id, newStatus);
      triggerHaptic(newStatus === 'CUTOFF' ? 'impact' : 'success');
      showToast(
        newStatus === 'CUTOFF'
          ? 'Alimentation coupée'
          : newStatus === 'LIMITED'
            ? 'Alimentation limitée'
            : 'Alimentation rétablie',
        newStatus === 'CUTOFF' ? 'error' : 'success',
      );
      setPendingAction(null);
    } catch {
      triggerHaptic('error');
      showToast("Échec de la commande — vérifier la connexion à l'API", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const dialogText = (action: ActionType) => {
    switch (action) {
      case 'cutoff':
        return "Êtes-vous sûr de vouloir couper l'alimentation du bâtiment ? Cette action affectera toutes les salles.";
      case 'limit':
        return 'Êtes-vous sûr de vouloir limiter la puissance du bâtiment ? Les équipements non-critiques seront limités.';
      case 'restore':
        return "Êtes-vous sûr de vouloir rétablir l'alimentation normale du bâtiment ?";
    }
  };

  const dialogRisk = (action: ActionType) => {
    switch (action) {
      case 'cutoff': return 'ÉLEVÉ';
      case 'limit': return 'MOYEN';
      case 'restore': return 'FAIBLE';
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 24 }}>
      {/* État du bâtiment */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">ÉTAT DU BÂTIMENT</Text>
        <View className="flex-row items-center gap-4">
          <View className={`${statusConfig.color} p-3 rounded-full`}>
            <StatusIcon color={palette.white} size={24} />
          </View>
          <View>
            <Text className="text-2xl font-bold text-text-primary">{statusConfig.label}</Text>
            <Text className="text-sm text-text-secondary">{building.name}</Text>
          </View>
        </View>
      </Card>

      {/* Stats de puissance (temps réel via WebSocket) */}
      <View className="flex-row gap-4">
        <Card className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Zap color={palette.success} size={14} />
            <Text className="text-xs text-text-secondary">Puissance Totale</Text>
          </View>
          <Text className="text-2xl font-mono font-bold text-success">{displayPower} kW</Text>
          <Text className="text-xs text-text-muted mt-1">temps réel</Text>
        </Card>
        <Card className="flex-1">
          <View className="flex-row items-center gap-2 mb-1">
            <Zap color={palette.gray400} size={14} />
            <Text className="text-xs text-text-secondary">Localisation</Text>
          </View>
          <Text className="text-lg font-bold text-text-primary">{building.location}</Text>
        </Card>
      </View>

      {/* Actions critiques */}
      <View className="gap-3">
        <Text className="text-sm font-medium text-text-secondary">ACTIONS CRITIQUES</Text>

        {building.powerStatus !== 'CUTOFF' && (
          <Button variant="destructive" disabled={espUnreachable} onPress={() => setPendingAction('cutoff')}>
            <View className="flex-row items-center gap-2">
              <Power color={palette.white} size={20} />
              <Text className="text-white font-medium">Couper l'Alimentation</Text>
            </View>
          </Button>
        )}

        {building.powerStatus !== 'LIMITED' && building.powerStatus !== 'CUTOFF' && (
          <Button variant="warning" disabled={espUnreachable} onPress={() => setPendingAction('limit')}>
            <View className="flex-row items-center gap-2">
              <AlertTriangle color={palette.white} size={20} />
              <Text className="text-white font-medium">Limiter la Puissance</Text>
            </View>
          </Button>
        )}

        {building.powerStatus !== 'POWERED' && (
          <Button variant="success" disabled={espUnreachable} onPress={() => setPendingAction('restore')}>
            <View className="flex-row items-center gap-2">
              <Power color={palette.white} size={20} />
              <Text className="text-white font-medium">Rétablir l'Alimentation</Text>
            </View>
          </Button>
        )}
      </View>

      {/* Confirmation */}
      <Modal
        visible={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title="Confirmation Requise"
        description={pendingAction ? dialogText(pendingAction) : undefined}
        footer={
          <View className="flex-row gap-3">
            <Button variant="outline" className="flex-1" onPress={() => setPendingAction(null)} disabled={submitting}>
              Annuler
            </Button>
            <Button className="flex-1" onPress={confirmAction} loading={submitting}>
              Confirmer
            </Button>
          </View>
        }
      >
        {pendingAction && (
          <View className="bg-warning-tint border border-warning rounded p-3 my-2">
            <View className="flex-row items-center gap-2">
              <AlertTriangle color={palette.warning} size={16} />
              <Text className="text-sm text-warning flex-1">Niveau de risque: {dialogRisk(pendingAction)}</Text>
              <InfoTooltip
                tooltipKey="control-risk-level"
                title="Niveau de risque"
                description="Élevé : coupe tout le bâtiment. Moyen : limite les circuits non critiques. Faible : rétablit l'alimentation normale."
              />
            </View>
          </View>
        )}
      </Modal>
    </ScrollView>
  );
}
