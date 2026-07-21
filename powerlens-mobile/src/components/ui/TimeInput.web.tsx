import { Text, View } from 'react-native';
import { palette } from '@/theme/colors';

interface Props {
  value: string;        // format "HH:MM"
  onChange: (time: string) => void;
  label?: string;
}

export function TimeInput({ value, onChange, label }: Props) {
  return (
    <View>
      {label && (
        <Text style={{ color: palette.gray500, fontSize: 13, fontWeight: '500', marginBottom: 4 }}>
          {label}
        </Text>
      )}
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: palette.gray100,
          border: `1px solid ${palette.gray200}`,
          borderRadius: 6,
          color: palette.gray900,
          padding: '8px 12px',
          fontSize: 14,
          width: '100%',
          colorScheme: 'light',
          boxSizing: 'border-box',
          marginTop: 4,
        }}
      />
    </View>
  );
}
