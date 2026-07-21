import { View, Text } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { palette } from '@/theme/colors';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  subtitle?: string;
  onRetry?: () => void;
  className?: string;
}

/** Distinct de EmptyState ("rien ici") — signale un échec (chargement, requête) avec une option de nouvelle tentative. */
export function ErrorState({ title = 'Une erreur est survenue', subtitle, onRetry, className = '' }: ErrorStateProps) {
  return (
    <View className={`flex-1 items-center justify-center p-8 gap-3 ${className}`}>
      <AlertCircle size={48} color={palette.danger} />
      <Text className="text-text-primary font-medium text-center">{title}</Text>
      {subtitle && <Text className="text-text-secondary text-xs text-center">{subtitle}</Text>}
      {onRetry && (
        <Button variant="outline" onPress={onRetry} className="mt-2 px-4">
          Réessayer
        </Button>
      )}
    </View>
  );
}
