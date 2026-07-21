import { Expose, Type } from 'class-transformer';

class BuildingSummaryDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() location: string;
}

export class RoomResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() floor: number | null;
  @Expose() buildingId: string;

  @Expose()
  @Type(() => BuildingSummaryDto)
  building?: BuildingSummaryDto;
}
