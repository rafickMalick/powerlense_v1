import { BarChart } from 'react-native-gifted-charts';
import { palette } from '@/theme/colors';

export interface CircuitConsumptionPoint {
  name: string;
  value: number;
}

interface CircuitBarChartProps {
  data: CircuitConsumptionPoint[];
  width: number;
}

export function CircuitBarChart({ data, width }: CircuitBarChartProps) {
  const barData = data.map((point) => ({ value: point.value, label: point.name, frontColor: palette.navy700 }));

  return (
    <BarChart
      data={barData}
      width={width}
      height={200}
      barWidth={28}
      spacing={24}
      yAxisColor={palette.gray200}
      xAxisColor={palette.gray200}
      yAxisTextStyle={{ color: palette.gray500, fontSize: 10 }}
      xAxisLabelTextStyle={{ color: palette.gray500, fontSize: 10 }}
      rulesColor={palette.gray200}
      rulesType="dashed"
      noOfSections={4}
    />
  );
}
