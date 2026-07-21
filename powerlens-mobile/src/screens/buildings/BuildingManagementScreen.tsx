import { useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Building2, Edit2, CheckCircle, AlertTriangle, Power } from 'lucide-react-native';
import { useBuildingStore, type BuildingUi, type BuildingFormInput } from '@/store/buildingStore';
import { Card, Button, Input, Label, Modal } from '@/components/ui';
import { palette } from '@/theme/colors';
import type { BuildingPowerStatus } from '@/types/models';
import { useScreenViewLogging } from '@/hooks/useScreenViewLogging';

const STATUS_CONFIG: Record<BuildingPowerStatus, { color: string; text: string; icon: typeof CheckCircle }> = {
  POWERED: { color: 'bg-success', text: 'Alimenté', icon: CheckCircle },
  LIMITED: { color: 'bg-warning', text: 'Limité', icon: AlertTriangle },
  CUTOFF: { color: 'bg-danger', text: 'Coupé', icon: Power },
};

const EMPTY_FORM: BuildingFormInput = { name: '', location: '', maxPower: 350 };

export function BuildingManagementScreen() {
  useScreenViewLogging('BuildingManagement');
  const buildings = useBuildingStore((s) => s.buildings);
  const activeBuildingId = useBuildingStore((s) => s.activeBuildingId);
  const setActiveBuilding = useBuildingStore((s) => s.setActiveBuilding);
  const updateBuildingInfo = useBuildingStore((s) => s.updateBuildingInfo);

  const [showEditModal, setShowEditModal] = useState(false);
  const [selected, setSelected] = useState<BuildingUi | null>(null);
  const [form, setForm] = useState<BuildingFormInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const openEdit = (building: BuildingUi) => {
    setSelected(building);
    setForm({ name: building.name, location: building.location, maxPower: building.maxPower });
    setShowEditModal(true);
  };

  const handleEdit = async () => {
    if (!selected || !form.name.trim()) return;
    setSubmitting(true);
    try {
      await updateBuildingInfo(selected.id, form);
      setShowEditModal(false);
      setSelected(null);
      setForm(EMPTY_FORM);
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item: building }: { item: BuildingUi }) => {
    const isActive = activeBuildingId === building.id;
    const statusConfig = STATUS_CONFIG[building.powerStatus];
    const StatusIcon = statusConfig.icon;

    return (
      <Card className={isActive ? 'border-primary' : ''}>
        <Pressable onPress={() => setActiveBuilding(building.id)}>
          <View className="flex-row items-start justify-between">
            <View className="flex-1">
              <View className="flex-row items-center gap-2 mb-1">
                <Building2 color={palette.navy700} size={20} />
                <Text className="font-semibold text-text-primary">{building.name}</Text>
                {isActive && (
                  <View className="bg-primary px-2 py-0.5 rounded-full">
                    <Text className="text-xs text-white">Actif</Text>
                  </View>
                )}
              </View>
              <Text className="text-sm text-text-secondary">{building.location}</Text>
            </View>
            <View className={`${statusConfig.color} p-2 rounded`}>
              <StatusIcon color={palette.white} size={16} />
            </View>
          </View>

          <View className="flex-row gap-3 mt-4">
            <View className="flex-1 bg-surface-alt rounded p-2">
              <Text className="text-xs text-text-secondary">Puissance</Text>
              <Text className="text-lg font-mono font-bold text-success">{building.currentPower} kW</Text>
            </View>
            <View className="flex-1 bg-surface-alt rounded p-2">
              <Text className="text-xs text-text-secondary">Max</Text>
              <Text className="text-lg font-mono font-bold text-text-primary">{building.maxPower} kW</Text>
            </View>
          </View>
        </Pressable>

        <View className="mt-3 pt-3 border-t border-border">
          <Button variant="outline" onPress={() => openEdit(building)}>
            <View className="flex-row items-center gap-2">
              <Edit2 color={palette.navy700} size={14} />
              <Text className="text-sm text-text-primary">Modifier les informations</Text>
            </View>
          </Button>
        </View>
      </Card>
    );
  };

  return (
    <View className="flex-1 bg-surface-alt">
      <FlatList
        contentContainerStyle={{ padding: 16, gap: 12 }}
        data={buildings}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View className="h-3" />}
        ListHeaderComponent={
          <View className="mb-3">
            <Text className="text-xl font-semibold text-text-primary">Bâtiments supervisés</Text>
            <Text className="text-sm text-text-secondary">{buildings.length} bâtiment(s) enregistré(s)</Text>
            <Text className="text-xs text-text-muted mt-1">
              La structure physique est gérée par le système matériel.
            </Text>
          </View>
        }
        renderItem={renderItem}
      />

      {/* Édition métadonnées bâtiment */}
      <Modal
        visible={showEditModal}
        onClose={() => setShowEditModal(false)}
        title="Modifier le Bâtiment"
        description="Modifiez le nom et la localisation du bâtiment"
        footer={
          <View className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => setShowEditModal(false)}>
              Annuler
            </Button>
            <Button className="flex-1" onPress={handleEdit} loading={submitting} disabled={!form.name.trim()}>
              Enregistrer
            </Button>
          </View>
        }
      >
        <View className="gap-3">
          <View>
            <Label>Nom du bâtiment</Label>
            <Input value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          </View>
          <View>
            <Label>Localisation</Label>
            <Input value={form.location} onChangeText={(v) => setForm((f) => ({ ...f, location: v }))} />
          </View>
          <View>
            <Label>Puissance maximale (kW)</Label>
            <Input
              value={String(form.maxPower)}
              onChangeText={(v) => setForm((f) => ({ ...f, maxPower: parseInt(v, 10) || 0 }))}
              keyboardType="numeric"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}
