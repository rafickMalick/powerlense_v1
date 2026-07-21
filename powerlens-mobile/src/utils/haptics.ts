import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

export type HapticType = 'impact' | 'success' | 'error' | 'selection';

/** No-op sur web (expo-haptics n'a pas d'effet natif dans un navigateur) — un seul point d'appel, pas de Platform.OS dispersé dans les écrans. */
export function triggerHaptic(type: HapticType): void {
  if (Platform.OS === 'web') return;

  switch (type) {
    case 'impact':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'error':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    case 'selection':
      Haptics.selectionAsync();
      break;
  }
}
