import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CircuitType, ZoneType } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MqttService } from '../mqtt/mqtt.service';
import { AuditService } from '../modules/audit/audit.service';
import { measureTopic } from '../mqtt/config/mqtt.config';
import logger from '../utils/logger';

interface BuildingTotals {
  power: number;
  current: number;
  voltageSum: number;
  freqSum: number;
  pfSum: number;
  count: number;
}

/**
 * Simulateur MQTT : publie des mesures réalistes pour chaque zone
 * ROOM/CORRIDOR, puis synthétise une mesure BUILDING (départ général) par
 * bâtiment = somme des zones ROOM/CORRIDOR + légères pertes de distribution.
 * Cette mesure simulée tient lieu de valeur par défaut tant qu'aucun module
 * matériel dédié n'est branché sur le départ général — dès qu'une vraie
 * mesure existe pour cette zone, `measurements.service.ts` bascule dessus.
 * Contrôlé dynamiquement par ProviderSwitcherService (startSimulation / stopSimulation).
 * Chaque payload inclut _sim:true pour que le switcher distingue les données
 * simulées des vraies mesures ESP32.
 */
@Injectable()
export class SimulatorService implements OnModuleDestroy {
  private interval?: NodeJS.Timeout;
  private energyByZone = new Map<string, number>();
  // En demo mode, le temps simulé avance indépendamment de l'horloge réelle
  private demoSimulatedHour = new Date().getHours();

  constructor(
    private prisma: PrismaService,
    private mqttService: MqttService,
    private auditService: AuditService,
  ) {}

  onModuleDestroy() {
    this.stopSimulation();
  }

  startSimulation(): void {
    if (this.interval) return;

    const intervalMs = this.getIntervalMs();
    logger.info(`[Simulator] Démarrage (intervalle ${intervalMs}ms)`);

    this.interval = setInterval(() => {
      this.tick().catch((err: unknown) =>
        logger.error('[Simulator] Erreur tick', {
          err: err instanceof Error ? err.message : String(err),
        }),
      );
    }, intervalMs);

    void this.auditService.log({
      actorType: 'SYSTEM',
      action: 'SIMULATOR_STARTED',
      targetType: 'SYSTEM',
      metadata: { intervalMs },
    });
  }

  stopSimulation(): void {
    if (!this.interval) return;
    clearInterval(this.interval);
    this.interval = undefined;
    logger.info('[Simulator] Arrêt');

    void this.auditService.log({
      actorType: 'SYSTEM',
      action: 'SIMULATOR_STOPPED',
      targetType: 'SYSTEM',
    });
  }

  isRunning(): boolean {
    return !!this.interval;
  }

  private getIntervalMs(): number {
    const raw = Number(process.env.SIMULATOR_INTERVAL_MS);
    return Number.isFinite(raw) && raw >= 100 && raw <= 60000 ? raw : 2000;
  }

  /**
   * Facteur de charge basé sur l'heure (profil bureautique type Afrique de l'Ouest).
   * Retourne une valeur dans [0, 1] avec un léger bruit aléatoire (±5 %).
   */
  private getLoadFactor(hour?: number): number {
    const h = hour ?? new Date().getHours();
    const profile: Record<number, number> = {
      0: 0.05, 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.08,
      6: 0.15, 7: 0.35, 8: 0.65, 9: 0.80, 10: 0.95, 11: 0.90,
      12: 0.55, 13: 0.50, 14: 0.75, 15: 0.95, 16: 0.85, 17: 0.70,
      18: 0.45, 19: 0.25, 20: 0.15, 21: 0.10, 22: 0.08, 23: 0.05,
    };
    const base = profile[h] ?? 0.1;
    return Math.max(0, Math.min(1, base + (Math.random() * 0.1 - 0.05)));
  }

  private async tick() {
    const isDemoMode = process.env.DEMO_MODE === 'true';
    const intervalMs = this.getIntervalMs();

    // En demo mode, l'heure simulée avance d'1h à chaque tick
    if (isDemoMode) {
      this.demoSimulatedHour = (this.demoSimulatedHour + 1) % 24;
    }
    const simulatedHour = isDemoMode ? this.demoSimulatedHour : undefined;
    const load = this.getLoadFactor(simulatedHour);
    const now = isDemoMode
      ? new Date(Date.now() - this.demoSimulatedHour * 3600000)
      : new Date();

    const zones = await this.prisma.monitoringZone.findMany({
      where: { type: { in: [ZoneType.ROOM, ZoneType.CORRIDOR] } },
      include: { circuits: { include: { device: true } } },
    });

    // Accumulateurs par bâtiment — servent à synthétiser la mesure BUILDING
    // (départ général) ci-dessous, tant qu'aucun module dédié ne la publie.
    const buildingTotals = new Map<string, BuildingTotals>();

    for (const zone of zones) {
      const device = zone.circuits[0]?.device;
      if (!device) {
        logger.warn(`[Simulator] Zone "${zone.name}" sans circuit/device — tick ignoré`);
        continue;
      }

      const payload = this.buildZonePayload(zone, load, intervalMs, now);

      this.mqttService.publish(
        measureTopic(zone.buildingId, device.deviceUid),
        payload,
      );

      const totals = buildingTotals.get(zone.buildingId) ?? {
        power: 0, current: 0, voltageSum: 0, freqSum: 0, pfSum: 0, count: 0,
      };
      totals.power += payload.power as number;
      totals.current += payload.current as number;
      totals.voltageSum += payload.voltage as number;
      totals.freqSum += payload.frequency as number;
      totals.pfSum += payload.powerFactor as number;
      totals.count += 1;
      buildingTotals.set(zone.buildingId, totals);
    }

    if (buildingTotals.size === 0) return;

    const buildingZones = await this.prisma.monitoringZone.findMany({
      where: { type: ZoneType.BUILDING, buildingId: { in: [...buildingTotals.keys()] } },
    });

    for (const bz of buildingZones) {
      const totals = buildingTotals.get(bz.buildingId);
      if (!totals || totals.count === 0) continue;

      const device = await this.prisma.device.findFirst({ where: { buildingId: bz.buildingId } });
      if (!device) continue;

      const payload = this.buildBuildingPayload(bz.id, totals, intervalMs, now);
      this.mqttService.publish(measureTopic(bz.buildingId, device.deviceUid), payload);
    }
  }

  /** Puissance instantanée d'UN circuit selon son type — inchangé, réutilisé pour sommer par zone. */
  private computeCircuitPower(circuitType: CircuitType, maxPowerWatt: number, load: number): number {
    let power: number;
    switch (circuitType) {
      case CircuitType.LIGHTING: {
        // Éclairage allumé si load > 0.3, puissance quasi-constante (éclairage LED)
        const isOn = load > 0.3;
        power = isOn ? maxPowerWatt * (0.85 + Math.random() * 0.1) : maxPowerWatt * 0.01;
        break;
      }
      case CircuitType.HVAC:
        // Climatisation monte progressivement avec la chaleur (plus de load = plus chaud)
        power = maxPowerWatt * (load * 0.9 + Math.random() * 0.1);
        break;
      case CircuitType.FAN:
        // Ventilateur suit le même profil que HVAC mais moins puissant
        power = maxPowerWatt * (load * 0.7 + Math.random() * 0.1);
        break;
      default: // SOCKET
        power = maxPowerWatt * (load * 0.8 + Math.random() * 0.15);
    }
    return Math.max(0, Math.min(maxPowerWatt * 1.05, power));
  }

  private buildZonePayload(
    zone: {
      id: string;
      type: ZoneType;
      circuits: Array<{ type: CircuitType; maxPowerWatt: number | null; isActive: boolean }>;
    },
    load: number,
    intervalMs: number,
    now: Date,
  ): Record<string, unknown> {
    const voltage = 220 + (Math.random() * 6 - 3); // 217-223 V

    let power = 0;
    let hasLighting = false;
    let hasHvac = false;
    for (const circuit of zone.circuits) {
      if (!circuit.isActive) continue; // circuit éteint → contribution nulle
      power += this.computeCircuitPower(circuit.type, circuit.maxPowerWatt ?? 500, load);
      if (circuit.type === CircuitType.LIGHTING) hasLighting = true;
      if (circuit.type === CircuitType.HVAC) hasHvac = true;
    }

    const current = power / voltage;
    const frequency = 50 + (Math.random() * 0.2 - 0.1);
    const powerFactor = hasHvac
      ? 0.70 + Math.random() * 0.15 // moteur → faible FP
      : 0.90 + Math.random() * 0.09;

    const previousEnergy = this.energyByZone.get(zone.id) ?? 0;
    const energyKwh = previousEnergy + (power / 1000) / (3600000 / intervalMs);
    this.energyByZone.set(zone.id, energyKwh);

    const isRoom = zone.type === ZoneType.ROOM;
    const isCorridor = zone.type === ZoneType.CORRIDOR;

    let luminosity: number | undefined;
    let presence: boolean | undefined;
    let temperature: number | undefined;

    if (isRoom || isCorridor) {
      const lightingOn = hasLighting && load > 0.3;
      luminosity = Math.round(lightingOn ? 300 + Math.random() * 500 : Math.random() * 20);
      presence = load > 0.4;

      // Température ambiante (SHT35 câblé sur ROOM et CORRIDOR, cf. code_arduno.ino) :
      // fraîche la nuit, monte en journée avec la présence.
      const baseTemp = 18 + load * 10;
      temperature = Number((baseTemp + Math.random() * 2 - 1).toFixed(1));
    }

    return {
      _sim: true, // marqueur interne — ignoré par MeasurementPayloadDto, lu par ProviderSwitcherService
      zoneId: zone.id,
      voltage: Number(voltage.toFixed(2)),
      current: Number(current.toFixed(3)),
      power: Number(power.toFixed(2)),
      energyKwh: Number(energyKwh.toFixed(4)),
      frequency: Number(frequency.toFixed(3)),
      powerFactor: Number(powerFactor.toFixed(3)),
      measuredAt: now.toISOString(),
      ...(luminosity !== undefined && { luminosity }),
      ...(presence !== undefined && { presence }),
      ...(temperature !== undefined && { temperature }),
    };
  }

  /**
   * Mesure BUILDING (départ général) synthétisée = somme des zones
   * ROOM/CORRIDOR du bâtiment + légères pertes de distribution (~1.5-2.5 %).
   * Pas de luminosity/presence/temperature au niveau bâtiment (matrice V4).
   */
  private buildBuildingPayload(
    zoneId: string,
    totals: BuildingTotals,
    intervalMs: number,
    now: Date,
  ): Record<string, unknown> {
    const lossFactor = 1 + (0.015 + Math.random() * 0.01);
    const power = totals.power * lossFactor;
    const current = totals.current * lossFactor;
    const voltage = totals.voltageSum / totals.count;
    const frequency = totals.freqSum / totals.count;
    const powerFactor = totals.pfSum / totals.count;

    const previousEnergy = this.energyByZone.get(zoneId) ?? 0;
    const energyKwh = previousEnergy + (power / 1000) / (3600000 / intervalMs);
    this.energyByZone.set(zoneId, energyKwh);

    return {
      _sim: true,
      zoneId,
      voltage: Number(voltage.toFixed(2)),
      current: Number(current.toFixed(3)),
      power: Number(power.toFixed(2)),
      energyKwh: Number(energyKwh.toFixed(4)),
      frequency: Number(frequency.toFixed(3)),
      powerFactor: Number(powerFactor.toFixed(3)),
      measuredAt: now.toISOString(),
    };
  }
}
