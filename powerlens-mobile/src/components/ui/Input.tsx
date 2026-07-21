import { TextInput, type TextInputProps } from 'react-native';
import { palette } from '@/theme/colors';

interface InputProps extends TextInputProps {
  className?: string;
}

export function Input({ className = '', ...props }: InputProps) {
  return (
    <TextInput
      placeholderTextColor={palette.gray400}
      className={`bg-surface-alt border border-border text-text-primary rounded px-3 py-2 mt-1 ${className}`}
      {...props}
    />
  );
}
