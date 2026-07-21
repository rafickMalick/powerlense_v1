import { Text, type TextProps } from 'react-native';

interface LabelProps extends TextProps {
  className?: string;
}

export function Label({ className = '', ...props }: LabelProps) {
  return <Text className={`text-sm text-text-secondary font-medium ${className}`} {...props} />;
}
