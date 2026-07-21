import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import { useUiStore } from '@/store/uiStore';
import { palette } from '@/theme/colors';

const useNative = Platform.OS !== 'web';

const BG: Record<string, string> = {
  success: palette.success,
  error:   palette.danger,
  info:    palette.navy700,
};

const ICON: Record<string, string> = {
  success: '✓',
  error:   '✕',
  info:    'ℹ',
};

export function Toast() {
  const toast = useUiStore((s) => s.toast);
  const opacity    = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  // Garde la dernière data pour l'afficher pendant le fade-out
  const [displayed, setDisplayed] = useState(toast);

  useEffect(() => {
    if (toast) {
      // Nouvelle notification : on met à jour le contenu et on fade in
      setDisplayed(toast);
      opacity.setValue(0);
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 1, duration: 200, useNativeDriver: useNative }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: useNative }),
      ]).start();
    } else {
      // Dismissal : fade out puis on vide le contenu
      Animated.parallel([
        Animated.timing(opacity,    { toValue: 0, duration: 250, useNativeDriver: useNative }),
        Animated.timing(translateY, { toValue: 16, duration: 250, useNativeDriver: useNative }),
      ]).start(({ finished }) => {
        if (finished) setDisplayed(null);
      });
    }
  }, [toast?.id ?? null]);

  if (!displayed) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        opacity,
        transform: [{ translateY }],
        position: 'absolute',
        bottom: 90,
        left: 16,
        right: 16,
        zIndex: 9999,
      }}
    >
      <View
        style={{
          backgroundColor: BG[displayed.type],
          borderRadius: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          elevation: 8,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3,
          shadowRadius: 8,
        }}
      >
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold', lineHeight: 20 }}>
          {ICON[displayed.type]}
        </Text>
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 }}>
          {displayed.message}
        </Text>
      </View>
    </Animated.View>
  );
}
