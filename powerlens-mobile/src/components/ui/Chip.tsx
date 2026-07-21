import { Pressable, Text, type PressableProps } from 'react-native';

interface ChipProps extends Omit<PressableProps, 'children'> {
  label: string;
  selected?: boolean;
  className?: string;
}

/** Pastille de sélection interactive (filtres) — distincte de `Badge` (label statique). */
export function Chip({ label, selected = false, className = '', ...props }: ChipProps) {
  return (
    <Pressable
      className={`px-3 py-2 rounded-full border ${
        selected ? 'bg-primary border-primary' : 'bg-surface border-border'
      } ${className}`}
      {...props}
    >
      <Text className={`text-sm font-medium ${selected ? 'text-white' : 'text-text-secondary'}`}>{label}</Text>
    </Pressable>
  );
}
