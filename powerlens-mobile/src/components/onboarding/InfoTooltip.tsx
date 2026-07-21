import { useState } from 'react';
import { Pressable } from 'react-native';
import { Info } from 'lucide-react-native';
import { Modal } from '@/components/ui';
import { palette } from '@/theme/colors';
import { useOnboardingStore } from '@/store/onboardingStore';

interface InfoTooltipProps {
  /** Clé unique — sert à mémoriser si l'utilisateur a déjà consulté ce tooltip. */
  tooltipKey: string;
  title: string;
  description: string;
}

/** Icône "?" contextuelle ouvrant une explication courte — invoquée sur les écrans clés. */
export function InfoTooltip({ tooltipKey, title, description }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const dismissTooltip = useOnboardingStore((s) => s.dismissTooltip);

  return (
    <>
      <Pressable onPress={() => setOpen(true)} hitSlop={8}>
        <Info size={16} color={palette.gray400} />
      </Pressable>
      <Modal
        visible={open}
        onClose={() => {
          setOpen(false);
          dismissTooltip(tooltipKey);
        }}
        title={title}
        description={description}
      />
    </>
  );
}
