import { View, type ViewProps } from 'react-native';

interface CardProps extends ViewProps {
  className?: string;
}

/** Carte du design system : rayon 16px et ombre douce (tokens du handoff). */
export function Card({ className = '', ...props }: CardProps) {
  return (
    <View
      className={`bg-surface rounded-card border border-border p-4 shadow-card ${className}`}
      {...props}
    />
  );
}
