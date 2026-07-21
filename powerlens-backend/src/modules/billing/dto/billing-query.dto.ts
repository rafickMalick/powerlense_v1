import { IsUUID } from 'class-validator';

export class BillingQueryDto {
  @IsUUID()
  buildingId: string;
}
