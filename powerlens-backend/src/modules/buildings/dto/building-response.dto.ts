import { Expose } from 'class-transformer';

export class BuildingResponseDto {
  @Expose() id: string;
  @Expose() name: string;
  @Expose() location: string;
  @Expose() description: string | null;
  @Expose() createdAt: Date;
}
