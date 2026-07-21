import { Switch as RNSwitch, type SwitchProps } from 'react-native';
import { palette } from '@/theme/colors';

export function Switch(props: SwitchProps) {
  return (
    <RNSwitch
      trackColor={{ false: palette.gray200, true: palette.navy700 }}
      thumbColor={palette.white}
      ios_backgroundColor={palette.gray200}
      {...props}
    />
  );
}
