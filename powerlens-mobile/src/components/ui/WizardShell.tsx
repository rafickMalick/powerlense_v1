import { View, Text, ScrollView } from 'react-native';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';

interface WizardShellProps {
  stepIndex: number;
  stepCount: number;
  title: string;
  canGoNext: boolean;
  isLastStep: boolean;
  submitting?: boolean;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/** Coquille générique d'assistant en étapes : progression + navigation
 * Retour/Suivant/Annuler. Ne connaît rien du contenu — réutilisable pour tout
 * flux en plusieurs écrans, pas seulement les règles. */
export function WizardShell({
  stepIndex,
  stepCount,
  title,
  canGoNext,
  isLastStep,
  submitting = false,
  onBack,
  onNext,
  onCancel,
  children,
}: WizardShellProps) {
  return (
    <View className="flex-1 bg-surface-alt">
      <View className="p-4 gap-2">
        <ProgressBar percent={((stepIndex + 1) / stepCount) * 100} />
        <Text className="text-text-secondary text-xs">
          Étape {stepIndex + 1} / {stepCount}
        </Text>
        <Text className="text-text-primary text-lg font-semibold">{title}</Text>
      </View>

      <ScrollView className="flex-1" contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 16 }}>
        {children}
      </ScrollView>

      <View className="flex-row gap-2 p-4 border-t border-border">
        <Button variant="outline" className="flex-1" onPress={stepIndex === 0 ? onCancel : onBack}>
          {stepIndex === 0 ? 'Annuler' : 'Retour'}
        </Button>
        <Button className="flex-1" onPress={onNext} disabled={!canGoNext} loading={submitting}>
          {isLastStep ? 'Enregistrer' : 'Suivant'}
        </Button>
      </View>
    </View>
  );
}
