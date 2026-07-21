import {
  IsBoolean,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** État d'un relais rapporté par le device dans son propre paquet de mesure (zone possédée uniquement). */
class CircuitStateDto {
  @IsUUID()
  circuitId!: string;

  @IsBoolean()
  isActive!: boolean;

  /** Numéro de pin physique du relais sur le device (mapping configuré côté ESP). */
  @IsOptional()
  @IsNumber()
  pin?: number;

  /** Libellé local configuré sur l'ESP (informatif — le nom de référence reste `Circuit.name`). */
  @IsOptional()
  @IsString()
  label?: string;
}

export class MeasurementPayloadDto {
  @IsUUID()
  zoneId!: string;

  /** Conservé pour compatibilité — non utilisé pour l'ingestion (les mesures sont désormais rattachées à une zone, pas à un circuit). */
  @IsOptional()
  @IsUUID()
  circuitId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  voltage?: number;

  @IsOptional()
  @IsNumber()
  @Min(-100)
  @Max(100)
  current?: number;

  @IsOptional()
  @IsNumber()
  @Min(-50000)
  @Max(50000)
  power?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  energyKwh?: number;

  @IsISO8601()
  measuredAt!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(70)
  frequency?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  powerFactor?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  luminosity?: number;

  @IsOptional()
  @IsBoolean()
  presence?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-50)
  @Max(100)
  temperature?: number;

  @IsOptional()
  @IsString()
  buildingId?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;

  /** État réel des relais de la zone possédée par le device émetteur (absent pour les paquets secours). */
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CircuitStateDto)
  circuits?: CircuitStateDto[];
}
