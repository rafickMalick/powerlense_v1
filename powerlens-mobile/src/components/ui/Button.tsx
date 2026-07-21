import { Pressable, Text, ActivityIndicator, type PressableProps } from 'react-native';

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'destructive' | 'success' | 'warning';

interface ButtonProps extends Omit<PressableProps, 'children'> {
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
  textClassName?: string;
  loading?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, string> = {
  default: 'bg-primary active:bg-primary-hover shadow-card',
  outline: 'bg-transparent border border-border active:bg-surface-alt',
  ghost: 'bg-transparent active:bg-surface-alt',
  destructive: 'bg-danger active:bg-danger shadow-card',
  success: 'bg-success active:bg-success shadow-card',
  warning: 'bg-warning active:bg-warning shadow-card',
};

const TEXT_STYLES: Record<ButtonVariant, string> = {
  default: 'text-white',
  outline: 'text-text-primary',
  ghost: 'text-primary',
  destructive: 'text-white',
  success: 'text-white',
  warning: 'text-white',
};

export function Button({
  children,
  variant = 'default',
  className = '',
  textClassName = '',
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <Pressable
      disabled={disabled || loading}
      className={`flex-row items-center justify-center gap-2 p-3 rounded-lg ${VARIANT_STYLES[variant]} ${
        disabled ? 'opacity-50' : ''
      } ${className}`}
      {...props}
    >
      {loading && <ActivityIndicator color="#fff" size="small" />}
      {typeof children === 'string' ? (
        <Text className={`font-medium ${TEXT_STYLES[variant]} ${textClassName}`}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
