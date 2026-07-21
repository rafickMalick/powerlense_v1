import { View, Text } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { palette } from '@/theme/colors';

export interface RoomComparisonPoint {
  room: string;
  avant: number;
  apres: number;
}

interface ComparisonBarChartProps {
  data: RoomComparisonPoint[];
  width: number;
}

export function ComparisonBarChart({ data, width }: ComparisonBarChartProps) {
  const barData = data.flatMap((point) => [
    { value: point.avant, label: point.room, frontColor: palette.warning, spacing: 2 },
    { value: point.apres, frontColor: palette.success, spacing: 18 },
  ]);

  return (
    <View>
      <BarChart
        data={barData}
        width={width}
        height={200}
        barWidth={14}
        spacing={18}
        yAxisColor={palette.gray200}
        xAxisColor={palette.gray200}
        yAxisTextStyle={{ color: palette.gray500, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: palette.gray500, fontSize: 10 }}
        rulesColor={palette.gray200}
        rulesType="dashed"
        noOfSections={4}
      />
      <View className="flex-row gap-4 mt-3 justify-center">
        <View className="flex-row items-center gap-1">
          <View className="w-3 h-3 rounded-sm bg-warning" />
          <Text className="text-xs text-text-secondary">Avant</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View className="w-3 h-3 rounded-sm bg-success" />
          <Text className="text-xs text-text-secondary">Après</Text>
        </View>
      </View>
    </View>
  );
}
