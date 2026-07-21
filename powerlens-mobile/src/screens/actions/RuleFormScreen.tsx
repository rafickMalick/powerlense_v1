import { useEffect, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useActiveBuilding } from '@/store/buildingStore';
import { useRulesStore } from '@/store/rulesStore';
import { EmptyState, WizardShell } from '@/components/ui';
import * as zonesService from '@/services/zones';
import * as rulesService from '@/services/rules';
import type { Circuit, MonitoringZone, Rule } from '@/types/models';
import type { ActionsStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';
import { useRuleWizard, WIZARD_STEP_TITLES } from './wizard/useRuleWizard';
import { ConditionTypeStep } from './wizard/ConditionTypeStep';
import { ZoneStep } from './wizard/ZoneStep';
import { ChargeStep } from './wizard/ChargeStep';
import { ActionStep } from './wizard/ActionStep';
import { ReviewStep } from './wizard/ReviewStep';
import { NonConformingRuleView } from './wizard/NonConformingRuleView';
import { buildActionsFromWizard, buildConditionFromWizard, mapRuleToWizardState, ruleTypeFromWizard } from './wizard/ruleWizardMapping';

type Props = NativeStackScreenProps<ActionsStackParamList, 'RuleForm'>;

export function RuleFormScreen({ navigation, route }: Props) {
  useScreenViewLogging('RuleForm');
  const building = useActiveBuilding();
  const createRule = useRulesStore((s) => s.createRule);
  const updateRule = useRulesStore((s) => s.updateRule);

  const ruleId = route.params?.ruleId;
  const isEditMode = !!ruleId;

  const wizard = useRuleWizard();

  const [loadingRule, setLoadingRule] = useState(isEditMode);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nonConforming, setNonConforming] = useState<{ rule: Rule; reason: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [zones, setZones] = useState<MonitoringZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(true);
  const [circuits, setCircuits] = useState<Circuit[]>([]);
  const [loadingCircuits, setLoadingCircuits] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: isEditMode ? 'Modifier la règle' : 'Nouvelle règle' });
  }, [navigation, isEditMode]);

  useEffect(() => {
    if (!building) return undefined;
    let active = true;
    setLoadingZones(true);
    Promise.all([
      zonesService.getZones({ buildingId: building.id, type: 'ROOM' }),
      zonesService.getZones({ buildingId: building.id, type: 'CORRIDOR' }),
    ])
      .then(([rooms, corridors]) => {
        if (active) setZones([...rooms, ...corridors]);
      })
      .finally(() => {
        if (active) setLoadingZones(false);
      });
    return () => {
      active = false;
    };
  }, [building]);

  useEffect(() => {
    if (!wizard.state.zoneId) {
      setCircuits([]);
      return undefined;
    }
    let active = true;
    setLoadingCircuits(true);
    zonesService
      .getZoneCircuits(wizard.state.zoneId)
      .then((data) => {
        if (active) setCircuits(data);
      })
      .finally(() => {
        if (active) setLoadingCircuits(false);
      });
    return () => {
      active = false;
    };
  }, [wizard.state.zoneId]);

  useEffect(() => {
    if (!ruleId) return undefined;
    let active = true;
    rulesService
      .getRule(ruleId)
      .then(async (rule) => {
        const result = await mapRuleToWizardState(rule);
        if (!active) return;
        if (result.conforming) {
          wizard.setState(result.state);
        } else {
          setNonConforming({ rule, reason: result.reason });
        }
      })
      .catch(() => {
        if (active) setLoadError('Impossible de charger la règle.');
      })
      .finally(() => {
        if (active) setLoadingRule(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleId]);

  if (!building) {
    return <EmptyState title="Aucun bâtiment sélectionné" />;
  }
  if (loadingRule) {
    return <EmptyState title="Chargement de la règle..." />;
  }
  if (loadError) {
    return <EmptyState title={loadError} />;
  }
  if (nonConforming) {
    return (
      <NonConformingRuleView
        rule={nonConforming.rule}
        reason={nonConforming.reason}
        onBack={() => navigation.goBack()}
      />
    );
  }

  const isLastStep = wizard.stepIndex === WIZARD_STEP_TITLES.length - 1;

  const handleNext = async () => {
    if (!isLastStep) {
      wizard.goNext();
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: wizard.state.name.trim(),
        ruleType: ruleTypeFromWizard(wizard.state.conditionType),
        conditions: buildConditionFromWizard(wizard.state),
        actions: buildActionsFromWizard(wizard.state),
        buildingId: building.id,
      };
      if (isEditMode && ruleId) {
        await updateRule(ruleId, payload);
      } else {
        await createRule(payload);
      }
      navigation.goBack();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardShell
      stepIndex={wizard.stepIndex}
      stepCount={wizard.stepCount}
      title={wizard.stepTitle}
      canGoNext={wizard.canGoNext}
      isLastStep={isLastStep}
      submitting={submitting}
      onBack={wizard.goBack}
      onNext={handleNext}
      onCancel={() => navigation.goBack()}
    >
      {wizard.stepIndex === 0 && <ConditionTypeStep state={wizard.state} patch={wizard.patch} />}
      {wizard.stepIndex === 1 && (
        <ZoneStep zones={zones} loading={loadingZones} state={wizard.state} patch={wizard.patch} />
      )}
      {wizard.stepIndex === 2 && (
        <ChargeStep circuits={circuits} loading={loadingCircuits} state={wizard.state} patch={wizard.patch} />
      )}
      {wizard.stepIndex === 3 && <ActionStep state={wizard.state} patch={wizard.patch} />}
      {wizard.stepIndex === 4 && (
        <ReviewStep state={wizard.state} patch={wizard.patch} zones={zones} circuits={circuits} />
      )}
    </WizardShell>
  );
}
