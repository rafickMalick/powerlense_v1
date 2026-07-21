import { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { User, Shield, Bell, Settings as SettingsIcon, ChevronRight, Lock, LogOut, Building2, HelpCircle } from 'lucide-react-native';
import { useAuthStore } from '@/store/authStore';
import { useActiveBuilding } from '@/store/buildingStore';
import { useOnboardingStore } from '@/store/onboardingStore';
import { Card, Badge, Switch, Modal, EmptyState } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { UserRole } from '@/types/models';
import type { SettingsStackParamList } from '@/navigation/types';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

type Props = NativeStackScreenProps<SettingsStackParamList, 'SettingsHome'>;

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Administrateur',
  ADMIN: 'Administrateur',
  MANAGER: 'Gestionnaire Énergie',
  VIEWER: 'Observateur',
};

const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-danger',
  ADMIN: 'bg-primary',
  MANAGER: 'bg-success',
  VIEWER: 'bg-gray-500',
};

const ROLES_INFO: { role: UserRole; permissions: string[] }[] = [
  {
    role: 'SUPER_ADMIN',
    permissions: [
      'Toutes les actions critiques',
      'Gestion des bâtiments',
      'Modification des règles',
      'Export des données',
      'Accès historique complet',
    ],
  },
  {
    role: 'ADMIN',
    permissions: [
      'Actions de limitation et coupure',
      'Création et modification de règles',
      'Gestion des circuits',
      'Consultation historique',
    ],
  },
  {
    role: 'MANAGER',
    permissions: ['Actions de limitation', 'Création de règles', 'Export des rapports', 'Consultation historique'],
  },
  {
    role: 'VIEWER',
    permissions: ['Lecture seule', 'Consultation dashboard', 'Aucune action possible'],
  },
];

export function SettingsScreen({ navigation }: Props) {
  useScreenViewLogging('Settings');
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const building = useActiveBuilding();
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);

  const [showRoleInfo, setShowRoleInfo] = useState(false);
  const [doubleConfirm, setDoubleConfirm] = useState(true);
  const [notifications, setNotifications] = useState({
    overload: true,
    cutoff: true,
    limit: true,
    manual: false,
    auto: false,
  });

  if (!building || !user) {
    return <EmptyState icon={Building2} title="Aucun bâtiment sélectionné" />;
  }

  return (
    <ScrollView className="flex-1 bg-surface-alt" contentContainerStyle={{ padding: 16, gap: 16 }}>
      {/* Profil utilisateur */}
      <Card>
        <View className="flex-row items-start gap-4">
          <View className="bg-primary p-3 rounded-full">
            <User color={palette.white} size={24} />
          </View>
          <View className="flex-1">
            <Text className="font-medium text-text-primary">{user.fullName}</Text>
            <Text className="text-sm text-text-secondary">{user.email}</Text>
            <View className="mt-2 self-start">
              <Badge className={`${ROLE_COLORS[user.role]} border-0`}>{ROLE_LABELS[user.role]}</Badge>
            </View>
          </View>
        </View>
      </Card>

      {/* Sécurité */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">SÉCURITÉ</Text>
        <View className="gap-3">
          <Pressable
            onPress={() => setShowRoleInfo(true)}
            className="flex-row items-center justify-between p-3 bg-surface-alt rounded active:bg-surface-secondary"
          >
            <View className="flex-row items-center gap-3">
              <Shield color={palette.navy700} size={16} />
              <Text className="text-sm text-text-primary">Rôles & Permissions</Text>
            </View>
            <ChevronRight color={palette.gray400} size={16} />
          </Pressable>

          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3">
              <Lock color={palette.warning} size={16} />
              <Text className="text-sm text-text-primary">Double confirmation</Text>
            </View>
            <Switch value={doubleConfirm} onValueChange={setDoubleConfirm} />
          </View>

          <View className="p-3 bg-primary-tint border border-primary/30 rounded">
            <View className="flex-row items-center gap-2">
              <Shield color={palette.navy700} size={12} />
              <Text className="text-xs text-primary flex-1">
                Historique non modifiable - Toutes les actions sont tracées
              </Text>
            </View>
          </View>
        </View>
      </Card>

      {/* Notifications */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">NOTIFICATIONS</Text>
        <View className="gap-3">
          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3 flex-1">
              <Bell color={palette.danger} size={16} />
              <View>
                <Text className="text-sm text-text-primary">Surcharges</Text>
                <Text className="text-xs text-text-secondary">Alertes critiques</Text>
              </View>
            </View>
            <Switch
              value={notifications.overload}
              onValueChange={(v) => setNotifications((n) => ({ ...n, overload: v }))}
            />
          </View>

          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3 flex-1">
              <Bell color={palette.warning} size={16} />
              <View>
                <Text className="text-sm text-text-primary">Coupures</Text>
                <Text className="text-xs text-text-secondary">Coupures électriques</Text>
              </View>
            </View>
            <Switch
              value={notifications.cutoff}
              onValueChange={(v) => setNotifications((n) => ({ ...n, cutoff: v }))}
            />
          </View>

          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3 flex-1">
              <Bell color={palette.warning} size={16} />
              <View>
                <Text className="text-sm text-text-primary">Limitations</Text>
                <Text className="text-xs text-text-secondary">Limitations de puissance</Text>
              </View>
            </View>
            <Switch
              value={notifications.limit}
              onValueChange={(v) => setNotifications((n) => ({ ...n, limit: v }))}
            />
          </View>

          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3 flex-1">
              <Bell color={palette.navy700} size={16} />
              <View>
                <Text className="text-sm text-text-primary">Actions manuelles</Text>
                <Text className="text-xs text-text-secondary">Actions utilisateurs</Text>
              </View>
            </View>
            <Switch
              value={notifications.manual}
              onValueChange={(v) => setNotifications((n) => ({ ...n, manual: v }))}
            />
          </View>

          <View className="flex-row items-center justify-between p-3 bg-surface-alt rounded">
            <View className="flex-row items-center gap-3 flex-1">
              <Bell color={palette.success} size={16} />
              <View>
                <Text className="text-sm text-text-primary">Actions automatiques</Text>
                <Text className="text-xs text-text-secondary">Règles déclenchées</Text>
              </View>
            </View>
            <Switch
              value={notifications.auto}
              onValueChange={(v) => setNotifications((n) => ({ ...n, auto: v }))}
            />
          </View>
        </View>
      </Card>

      {/* Bâtiments */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">BÂTIMENTS</Text>
        <Pressable
          onPress={() => navigation.navigate('BuildingManagement')}
          className="flex-row items-center justify-between p-3 bg-surface-alt rounded active:bg-surface-secondary"
        >
          <View className="flex-row items-center gap-3">
            <Building2 color={palette.navy700} size={16} />
            <Text className="text-sm text-text-primary">Gestion des bâtiments</Text>
          </View>
          <ChevronRight color={palette.gray400} size={16} />
        </Pressable>
      </Card>

      {/* Système */}
      <Card>
        <Text className="text-sm font-medium text-text-secondary mb-4">SYSTÈME</Text>
        <View className="gap-2">
          <View className="flex-row justify-between">
            <Text className="text-sm text-text-secondary">Version</Text>
            <Text className="text-sm font-mono text-text-primary">1.0.0</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-text-secondary">Bâtiment</Text>
            <Text className="text-sm text-text-primary">{building.name}</Text>
          </View>
          <View className="flex-row justify-between">
            <Text className="text-sm text-text-secondary">Mode</Text>
            <Text className="text-sm text-success">Production</Text>
          </View>
        </View>
      </Card>

      {/* À propos */}
      <Card>
        <View className="flex-row items-center gap-3 mb-3">
          <SettingsIcon color={palette.navy700} size={16} />
          <Text className="text-sm font-medium text-text-primary">POWERLENS</Text>
        </View>
        <Text className="text-xs text-text-secondary leading-relaxed mb-3">
          Application de monitoring et contrôle énergétique. Fonctionnement basé sur règles logiques
          déterministes, sans intelligence artificielle ni API externe.
        </Text>
        <Pressable onPress={resetOnboarding} className="flex-row items-center gap-2">
          <HelpCircle color={palette.navy700} size={14} />
          <Text className="text-xs text-primary font-medium">Revoir l'introduction</Text>
        </Pressable>
      </Card>

      {/* Déconnexion */}
      <Pressable
        onPress={logout}
        className="flex-row items-center justify-center gap-2 p-3 bg-danger-tint border border-danger/30 rounded"
      >
        <LogOut color={palette.danger} size={16} />
        <Text className="text-sm text-danger">Déconnexion</Text>
      </Pressable>

      {/* Modale Rôles & Permissions */}
      <Modal
        visible={showRoleInfo}
        onClose={() => setShowRoleInfo(false)}
        title="Rôles & Permissions"
        description="Niveaux d'accès et autorisations"
      >
        <View className="gap-3">
          {ROLES_INFO.map((roleInfo) => (
            <View key={roleInfo.role} className="bg-surface-alt rounded-lg p-4">
              <View className="flex-row items-center gap-2 mb-3">
                <Badge className={`${ROLE_COLORS[roleInfo.role]} border-0`}>{ROLE_LABELS[roleInfo.role]}</Badge>
                {user.role === roleInfo.role && (
                  <Badge variant="outline" textClassName="text-primary">
                    Votre rôle
                  </Badge>
                )}
              </View>
              <View className="gap-1">
                {roleInfo.permissions.map((permission) => (
                  <View key={permission} className="flex-row items-center gap-2">
                    <View className="w-1 h-1 rounded-full bg-primary" />
                    <Text className="text-sm text-text-secondary">{permission}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      </Modal>
    </ScrollView>
  );
}
