import { useState } from 'react';
import { View, Text, Image, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Eye, EyeOff } from 'lucide-react-native';
import { useAuthStore } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { Card, Input, Label, Button } from '@/components/ui';
import { palette } from '@/theme/colors';

export function LoginScreen() {
  const login    = useAuthStore((s) => s.login);
  const status   = useAuthStore((s) => s.status);
  const showToast = useUiStore((s) => s.showToast);

  const [email, setEmail]           = useState('admin@powerlens.local');
  const [password, setPassword]     = useState('');
  const [showPassword, setShowPwd]  = useState(false);

  const loading = status === 'loading';

  const handleSubmit = async () => {
    console.log('[Login] Tentative →', email.trim());
    try {
      await login(email.trim(), password);
      console.log('[Login] ✅ Succès');
      showToast('Connexion réussie !', 'success', 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      console.log('[Login] ❌ Échec:', msg);
      showToast('Identifiants invalides', 'error');
    }
  };

  return (
    <LinearGradient
      colors={[palette.gray50, palette.navy50, palette.gray50]}
      style={{ flex: 1 }}
    >
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="items-center mb-8">
            <Image
              source={require('../../../assets/logo.jpeg')}
              style={{ width: 220, height: 180 }}
              resizeMode="contain"
            />
            <Text className="text-text-secondary mt-1">Gestion énergétique intelligente</Text>
          </View>

          <Card className="shadow-elevated">
            <Label>Email</Label>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="admin@powerlens.local"
            />

            <Label className="mt-4">Mot de passe</Label>
            <View style={{ position: 'relative' }}>
              <Input
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="••••••••"
                className="pr-10"
              />
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                hitSlop={8}
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 0,
                  bottom: 0,
                  justifyContent: 'center',
                }}
              >
                {showPassword
                  ? <EyeOff color={palette.gray400} size={18} />
                  : <Eye    color={palette.gray400} size={18} />}
              </Pressable>
            </View>

            <Button
              className="mt-6"
              onPress={handleSubmit}
              loading={loading}
              disabled={!email || !password || loading}
            >
              Se connecter
            </Button>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}
