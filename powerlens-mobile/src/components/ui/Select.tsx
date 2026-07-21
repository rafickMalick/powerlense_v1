import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { palette } from '@/theme/colors';
import { Modal } from './Modal';

export interface SelectOption {
  label: string;
  value: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  title?: string;
}

export function Select({ value, onValueChange, options, className = '', title = 'Sélectionner' }: SelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className={`flex-row items-center justify-between bg-surface-alt border border-border rounded px-3 py-3 ${className}`}
      >
        <Text className="text-text-primary text-sm">{selected?.label ?? title}</Text>
        <ChevronDown size={16} color={palette.gray400} />
      </Pressable>
      <Modal visible={open} onClose={() => setOpen(false)} title={title}>
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => {
              onValueChange(opt.value);
              setOpen(false);
            }}
            className="py-3 border-b border-border"
          >
            <Text className={`text-sm ${opt.value === value ? 'text-primary font-medium' : 'text-text-primary'}`}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </Modal>
    </>
  );
}
