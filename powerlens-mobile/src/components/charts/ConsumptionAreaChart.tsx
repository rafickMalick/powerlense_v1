import { LineChart } from 'react-native-gifted-charts';
import type { ConsumptionPoint } from '@/store/measurementsStore';
import { palette } from '@/theme/colors';

interface ConsumptionAreaChartProps {
  data: ConsumptionPoint[];
  width: number;
}

export function ConsumptionAreaChart({ data, width }: ConsumptionAreaChartProps) {
  const points = data.map((point) => ({ value: point.value, label: point.time }));

  return (
    <LineChart
      data={points}
      width={width}
      height={180}
      areaChart
      curved
      color={palette.navy700}
      thickness={2}
      startFillColor={palette.navy700}
      startOpacity={0.25}
      endFillColor={palette.navy700}
      endOpacity={0}
      yAxisColor={palette.gray200}
      xAxisColor={palette.gray200}
      yAxisTextStyle={{ color: palette.gray500, fontSize: 10 }}
      xAxisLabelTextStyle={{ color: palette.gray500, fontSize: 10 }}
      rulesColor={palette.gray200}
      rulesType="dashed"
      noOfSections={4}
      initialSpacing={8}
      hideDataPoints
    />
  );
}
