import { useEffect } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming, Easing } from 'react-native-reanimated';

interface SkeletonProps extends ViewProps {
  className?: string;
}

/** Placeholder de chargement pulsé — remplace les ActivityIndicator nus sur les listes/cartes. */
export function Skeleton({ className = '', style, ...props }: SkeletonProps) {
  const opacity = useSharedValue(0.5);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      className={`bg-surface-secondary rounded ${className}`}
      style={[animatedStyle, style]}
      {...props}
    />
  );
}

/** Groupe de lignes de squelette imitant une carte de contenu (titre + 2 lignes). */
export function SkeletonCard() {
  return (
    <View className="bg-surface rounded-lg border border-border p-4 gap-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-3 w-32" />
    </View>
  );
}
