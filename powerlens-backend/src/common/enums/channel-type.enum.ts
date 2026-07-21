export enum ChannelType {
  VOLTAGE = 'VOLTAGE',
  CURRENT = 'CURRENT',
  POWER = 'POWER',
  ENERGY = 'ENERGY',
}

export const CHANNEL_UNITS: Record<ChannelType, string> = {
  [ChannelType.VOLTAGE]: 'V',
  [ChannelType.CURRENT]: 'A',
  [ChannelType.POWER]: 'W',
  [ChannelType.ENERGY]: 'kWh',
};
