import { Expose, Type } from 'class-transformer';

class DeviceSummaryDto {
  @Expose() id: string;
  @Expose() deviceUid: string;
  @Expose() status: string;
}

class RoomSummaryDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() floor: number | null;
}

export class CircuitResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() maxPowerWatt: number | null;
  @Expose() isActive: boolean;
  @Expose() deviceId: string;
  @Expose() roomId: string | null;

  @Expose()
  @Type(() => DeviceSummaryDto)
  device?: DeviceSummaryDto;

  @Expose()
  @Type(() => RoomSummaryDto)
  room?: RoomSummaryDto | null;
}
