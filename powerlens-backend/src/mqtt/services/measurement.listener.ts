import { forwardRef, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AlertLevel } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MqttService } from '../mqtt.service';
import {
  RuleEngineService,
  RuleAction,
  RuleDecision,
} from '../../modules/rules/rules-engine.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../../modules/audit/audit.service';
import { AlertsService } from '../../modules/alerts/alerts.service';
import logger from '../../utils/logger';
import { PrismaService } from '../../prisma.service';
import { mqttConfig, commandTopic, parseTopic } from '../config/mqtt.config';
import { MeasurementPayloadDto } from '../dto/measurement-payload.dto';
import { CommandTrackerService } from './command-tracker.service';

interface MeasurementPayload {
  zoneId?: string;
  circuitId?: string;
  voltage?: number;
  current?: number;
  power?: number;
  energyKwh?: number;
  measuredAt?: string;
  eventName?: string;
  buildingId?: string;
  deviceId?: string;
  [key: string]: unknown;
}

interface AckPayload {
  correlationId?: string;
  status?: string;
}

interface DeviceStatusPayload {
  online?: unknown;
}

/** Auto-déclaration d'un boîtier (topic `announce`) — cf. mqtt.config.ts. */
interface AnnouncePayload {
  deviceUid?: string;
  name?: string;
  zoneId?: string;
  zoneName?: string;
  firmware?: string;
  charges?: {
    circuitId?: string;
    name?: string;
    pin?: number;
    isActive?: boolean;
  }[];
}

/** Bâtiment unique auto-créé auquel se rattachent tous les boîtiers (décision D3). */
const DEFAULT_BUILDING_NAME = 'Bâtiment par défaut';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Plages physiques plausibles (alignées sur les @Min/@Max du DTO). Un champ
// hors plage (bruit capteur PZEM, lecture transitoire) est traité comme une
// donnée absente (null en base, cf. schema.prisma EnergyMeasurement — tous
// les champs de mesure sont nullable) plutôt que de faire échouer toute la
// mesure : voltage/power valides ne doivent pas être perdus pour un seul
// champ foireux.
const PHYSICAL_RANGES: Partial<Record<keyof MeasurementPayload, [number, number]>> = {
  voltage: [0, 500],
  current: [-100, 100],
  power: [-50000, 50000], // borne large = voltage max × current max (V*A)
  energyKwh: [0, Infinity],
  frequency: [0, 70],
  powerFactor: [0, 1],
  luminosity: [0, Infinity],
  temperature: [-50, 100],
};

function sanitizeNumericFields(payload: MeasurementPayload): MeasurementPayload {
  const sanitized = { ...payload };
  const droppedFields: string[] = [];
  for (const [field, range] of Object.entries(PHYSICAL_RANGES)) {
    if (!range) continue;
    const [min, max] = range;
    const value = sanitized[field];
    if (typeof value !== 'number') continue;
    if (Number.isNaN(value) || value < min || value > max) {
      logger.warn('Mesure hors plage physique — champ traité comme absent', {
        field,
        value,
        zoneId: payload.zoneId,
      });
      droppedFields.push(field);
      delete sanitized[field];
    }
  }
  if (droppedFields.length > 0) {
    logger.warn('Payload brut associé aux champs neutralisés (diagnostic hardware)', {
      droppedFields,
      zoneId: payload.zoneId,
      rawPayload: payload,
    });
  }
  return sanitized;
}

@Injectable()
export class MeasurementListener implements OnModuleInit {
  constructor(
    private readonly mqttService: MqttService,
    private readonly ruleEngine: RuleEngineService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly auditService: AuditService,
    private readonly commandTracker: CommandTrackerService,
    @Inject(forwardRef(() => AlertsService))
    private readonly alertsService: AlertsService,
  ) {}

  onModuleInit() {
    // FLUX 1 : Mesures (persistance + diffusion temps réel + moteur de règles)
    this.mqttService.subscribe(
      mqttConfig.topics.measureSub,
      (topic, message) => {
        void (async () => {
          try {
            const { buildingId, deviceId, segment } = parseTopic(topic);
            // Le callback global (mqtt.js) reçoit TOUS les messages, tous topics
            // confondus : ne traiter que le segment 'measure' (évite d'interpréter
            // ack/event/status comme des mesures — bruit de log + faux emit).
            if (segment !== 'measure') return;
            const payload = JSON.parse(
              message.toString(),
            ) as MeasurementPayload;
            await this.handleMeasurement({ ...payload, buildingId, deviceId });
          } catch (err) {
            logger.error('Erreur traitement mesure', {
              err: getErrorMessage(err),
            });
          }
        })();
      },
    );

    // FLUX 2 : Événements (déclenche les règles de type EVENT)
    this.mqttService.subscribe(mqttConfig.topics.eventSub, (topic, message) => {
      void (async () => {
        try {
          const payload = JSON.parse(message.toString()) as MeasurementPayload;
          const { buildingId, deviceId } = parseTopic(topic);
          await this.handleRuleDecisions(
            await this.ruleEngine.evaluateMeasurement({
              ...payload,
              buildingId,
              deviceId,
            }),
            { buildingId, deviceId, zoneId: payload.zoneId },
          );
        } catch (err) {
          logger.error('Erreur traitement événement', {
            err: getErrorMessage(err),
          });
        }
      })();
    });

    // FLUX 3 : Acks (confirmation matérielle d'une commande)
    this.mqttService.subscribe(mqttConfig.topics.ackSub, (topic, message) => {
      void (async () => {
        try {
          const payload = JSON.parse(message.toString()) as AckPayload;
          const { last: circuitId } = parseTopic(topic);
          if (!circuitId) return;

          // Corrèle l'ACK à la commande d'origine (ON ou OFF) via
          // correlationId — évite de deviner l'état voulu (cf. bug
          // historique : un ACK de succès forçait isActive=false même
          // pour une commande ON).
          const resolved = payload.correlationId
            ? this.commandTracker.resolve(
                payload.correlationId,
                payload.status === 'SUCCESS',
              )
            : null;

          await this.auditService.log({
            actorType: 'HARDWARE',
            action: resolved?.isActive ? 'SWITCH_ON_ACK' : 'SWITCH_OFF_ACK',
            targetType: 'CIRCUIT',
            targetId: circuitId,
            metadata: { ...payload, status: payload.status ?? 'UNKNOWN' },
          });

          if (!resolved) {
            logger.warn(
              'ACK reçu sans commande suivie correspondante (expirée ou correlationId inconnu)',
              { circuitId, correlationId: payload.correlationId },
            );
            return;
          }

          const circuit = await this.prisma.circuit.update({
            where: { id: circuitId },
            data: { isActive: resolved.isActive },
          });

          this.realtime.emitCircuitStatus({
            circuitId: circuit.id,
            isActive: circuit.isActive,
          });

          logger.info(`ACK reçu et traité pour le circuit ${circuitId}`);
        } catch (err) {
          logger.error('Erreur traitement ACK', { err: getErrorMessage(err) });
        }
      })();
    });

    // FLUX 4 : Statut device (LWT) — présence/absence matérielle immédiate.
    // Le device publie {online:true} retained à la connexion (+ republication
    // périodique) ; le broker publie {online:false} retained à sa place quand il
    // le déclare mort. Détection primaire, sans attendre le silence des mesures.
    this.mqttService.subscribe(mqttConfig.topics.statusSub, (topic, message) => {
      void (async () => {
        try {
          const { segment, buildingId, deviceId } = parseTopic(topic);
          // Le callback global (mqtt.js) reçoit TOUS les messages, tous topics
          // confondus : ne traiter que ceux du segment 'status'.
          if (segment !== 'status') return;
          await this.handleDeviceStatus(message.toString(), buildingId, deviceId);
        } catch (err) {
          logger.error('Erreur traitement statut device', {
            err: getErrorMessage(err),
          });
        }
      })();
    });

    // FLUX 5 : Auto-déclaration d'un boîtier (`announce`, retained). Le boîtier
    // décrit lui-même sa topologie ; le backend l'enregistre (upsert). C'est ce
    // qui fait apparaître un nouveau boîtier et ses charges dans l'application,
    // sans aucun identifiant codé en dur ni seed préalable.
    this.mqttService.subscribe(
      mqttConfig.topics.announceSub,
      (topic, message) => {
        void (async () => {
          try {
            const { segment } = parseTopic(topic);
            if (segment !== 'announce') return;
            await this.handleAnnounce(message.toString());
          } catch (err) {
            logger.error("Erreur traitement annonce d'un boîtier", {
              err: getErrorMessage(err),
            });
          }
        })();
      },
    );
  }

  /**
   * Enregistre (upsert) un boîtier auto-déclaré : son bâtiment de rattachement,
   * la zone qu'il supervise, lui-même, puis ses charges. Les NOMS proviennent du
   * portail de configuration du boîtier — c'est lui la source de vérité de la
   * topologie ; le backend en est le miroir.
   */
  private async handleAnnounce(raw: string): Promise<void> {
    let payload: AnnouncePayload;
    try {
      payload = JSON.parse(raw) as AnnouncePayload;
    } catch {
      logger.warn('Annonce boîtier illisible (JSON invalide), ignorée', { raw });
      return;
    }

    const { deviceUid, name, zoneId, zoneName, charges } = payload;
    if (!deviceUid || !zoneId) {
      logger.warn('Annonce boîtier incomplète (deviceUid/zoneId requis), ignorée', {
        raw,
      });
      return;
    }

    // 1. Bâtiment par défaut (créé une seule fois, partagé par tous les boîtiers).
    const building =
      (await this.prisma.building.findFirst({
        where: { name: DEFAULT_BUILDING_NAME },
      })) ??
      (await this.prisma.building.create({
        data: { name: DEFAULT_BUILDING_NAME, location: 'Non renseigné' },
      }));

    // 2. Zone supervisée par ce boîtier (son UUID vient du boîtier).
    const zoneLabel = zoneName || name || deviceUid;
    await this.prisma.monitoringZone.upsert({
      where: { id: zoneId },
      update: { name: zoneLabel },
      create: {
        id: zoneId,
        name: zoneLabel,
        type: 'ROOM',
        buildingId: building.id,
      },
    });

    // 3. Le boîtier lui-même.
    const device = await this.prisma.device.upsert({
      where: { deviceUid },
      update: { name: name ?? undefined, buildingId: building.id },
      create: { deviceUid, name: name ?? null, buildingId: building.id },
    });

    // 4. Ses charges — le nom saisi dans le portail devient `Circuit.name`.
    for (const charge of charges ?? []) {
      if (!charge.circuitId) continue;
      const chargeName = charge.name || `Pin ${charge.pin ?? '?'}`;
      await this.prisma.circuit
        .upsert({
          where: { id: charge.circuitId },
          update: {
            name: chargeName,
            pin: charge.pin ?? null,
            deviceId: device.id,
            zoneId,
          },
          create: {
            id: charge.circuitId,
            name: chargeName,
            type: 'SOCKET', // type par défaut — affinable ensuite depuis l'app
            pin: charge.pin ?? null,
            isActive: charge.isActive ?? true,
            deviceId: device.id,
            zoneId,
          },
        })
        .catch((err: unknown) => {
          logger.warn("Charge ignorée à l'enregistrement", {
            circuitId: charge.circuitId,
            err: getErrorMessage(err),
          });
        });
    }

    logger.info('Boîtier enregistré (auto-déclaration)', {
      deviceUid,
      name,
      zoneId,
      charges: charges?.length ?? 0,
    });

    await this.auditService.log({
      actorType: 'HARDWARE',
      action: 'DEVICE_ANNOUNCED',
      targetType: 'DEVICE',
      targetId: deviceUid,
      metadata: { name, zoneId, charges: charges?.length ?? 0 },
    });
  }

  /**
   * Traite un message de présence (LWT) : {online:boolean}. Un payload illisible
   * ou sans booléen `online` est journalisé puis ignoré (ne fait pas planter le
   * flux). Émet un WebSocket `device:status` et journalise l'événement (audit).
   */
  private async handleDeviceStatus(
    raw: string,
    buildingId?: string,
    deviceUid?: string,
  ): Promise<void> {
    let parsed: DeviceStatusPayload;
    try {
      parsed = JSON.parse(raw) as DeviceStatusPayload;
    } catch {
      logger.warn('Statut device invalide (JSON illisible), ignoré', {
        raw,
        deviceUid,
      });
      return;
    }
    if (typeof parsed.online !== 'boolean') {
      logger.warn('Statut device invalide (champ online manquant), ignoré', {
        raw,
        deviceUid,
      });
      return;
    }

    const online = parsed.online;
    const at = new Date().toISOString();

    this.realtime.emitDeviceStatus({ buildingId, deviceUid, online, at });

    await this.auditService.log({
      actorType: 'HARDWARE',
      action: online ? 'DEVICE_ONLINE' : 'DEVICE_OFFLINE',
      targetType: 'DEVICE',
      targetId: deviceUid,
      metadata: { buildingId, online },
    });
  }

  private async handleMeasurement(payload: MeasurementPayload) {
    // Diffusion temps réel immédiate, avant toute écriture en base (CLAUDE.md §1)
    this.realtime.emitMeasurement(payload);

    const dto = plainToInstance(
      MeasurementPayloadDto,
      sanitizeNumericFields(payload),
    );
    const errors = await validate(dto);
    if (errors.length > 0) {
      logger.warn('Payload de mesure invalide, écriture ignorée', {
        errors: errors.map((e) => e.toString()),
      });
    } else {
      // Résout le type de zone pour appliquer le garde-fou environnemental —
      // PZEM004T+SHT35+PIR sont câblés sur ROOM et CORRIDOR (cf. code_arduno.ino),
      // jamais sur BUILDING (départ général, pas de sonde environnementale).
      const zone = await this.prisma.monitoringZone
        .findUnique({ where: { id: dto.zoneId } })
        .catch(() => null);

      const supportsEnvFields = zone?.type === 'ROOM' || zone?.type === 'CORRIDOR';

      if (
        (dto.temperature !== undefined || dto.presence !== undefined || dto.luminosity !== undefined) &&
        !supportsEnvFields
      ) {
        logger.warn(
          `Env fields (temperature/presence/luminosity) dropped: zone ${dto.zoneId} is of type ${zone?.type ?? 'unknown'}, not ROOM/CORRIDOR`,
        );
      }

      this.prisma.energyMeasurement
        .create({
          data: {
            zoneId: dto.zoneId,
            voltage: dto.voltage,
            current: dto.current,
            power: dto.power,
            energyKwh: dto.energyKwh,
            frequency: dto.frequency,
            powerFactor: dto.powerFactor,
            luminosity: supportsEnvFields ? dto.luminosity : undefined,
            presence: supportsEnvFields ? dto.presence : undefined,
            temperature: supportsEnvFields ? dto.temperature : undefined,
            measuredAt: new Date(dto.measuredAt),
          },
        })
        .then(() => {
          // Silencieux par défaut (LOG_LEVEL=info) — passer LOG_LEVEL=debug
          // pour confirmer en direct qu'une zone/device précis est bien reçu
          // et enregistré, sans attendre un warning/error (qui n'apparaît
          // que si quelque chose cloche).
          logger.debug('Mesure enregistrée', {
            zoneId: dto.zoneId,
            deviceId: payload.deviceId,
            power: dto.power,
          });
        })
        .catch((err) => {
          logger.error('Échec insertion mesure', {
            err: getErrorMessage(err),
          });
        });

      // État réel des relais rapporté par le device (zone possédée
      // uniquement) — best-effort, non bloquant : un circuitId inconnu ou
      // une erreur transitoire est ignoré(e) plutôt que de faire échouer
      // l'ingestion de la mesure. Réutilise l'événement WebSocket existant
      // 'circuit:status' (déjà émis par CircuitsService.setActive pour les
      // commandes utilisateur) — aucun changement mobile requis.
      if (dto.circuits?.length) {
        for (const c of dto.circuits) {
          this.prisma.circuit
            .update({
              where: { id: c.circuitId },
              // Met à jour l'état ET la pin physique rapportée par le device
              // (mapping provisionné côté ESP) — la pin n'est écrite que si
              // fournie, pour ne pas l'effacer avec un ancien firmware.
              data: {
                isActive: c.isActive,
                ...(typeof c.pin === 'number' ? { pin: c.pin } : {}),
              },
            })
            .then((circuit) => {
              this.realtime.emitCircuitStatus({
                circuitId: circuit.id,
                isActive: circuit.isActive,
              });
            })
            .catch((err) => {
              logger.debug('Mise à jour isActive ignorée (circuit inconnu ou erreur)', {
                circuitId: c.circuitId,
                err: getErrorMessage(err),
              });
            });
        }
      }
    }

    const decisions = await this.ruleEngine.evaluateMeasurement(payload);
    await this.handleRuleDecisions(decisions, payload);
  }

  private async handleRuleDecisions(
    decisions: RuleDecision[],
    context: { buildingId?: string; deviceId?: string; zoneId?: string },
  ) {
    for (const decision of decisions) {
      logger.info('Règle déclenchée — exécution des actions', {
        ruleId: decision.ruleId,
        actionTypes: decision.actions.map((a) => a.type),
      });

      const results = await Promise.allSettled(
        decision.actions.map(async (action: RuleAction) => {
          if (action.type === 'SWITCH_OFF' && action.targetId) {
            if (action.targetType === 'ZONE') {
              // Cible tous les circuits actifs non-critiques de la zone —
              // les circuits critiques (isCritical) ne sont jamais coupés
              // automatiquement par une action de portée zone.
              const circuits = await this.prisma.circuit.findMany({
                where: { zoneId: action.targetId, isActive: true, isCritical: false },
              });
              await Promise.all(
                circuits.map((c) =>
                  this.publishCommand(c.id, 'OFF', decision.ruleId, `${c.id}-${Date.now()}`),
                ),
              );
            } else {
              await this.publishCommand(
                action.targetId,
                'OFF',
                decision.ruleId,
                `${action.targetId}-${Date.now()}`,
              );
            }
          }

          if (action.type === 'ALERT') {
            const payload = action.payload as
              | { level?: AlertLevel; message?: string }
              | undefined;
            await this.alertsService.createAndPublish({
              level: payload?.level ?? AlertLevel.INFO,
              message: payload?.message ?? 'Alerte déclenchée',
              ruleId: decision.ruleId,
              buildingId: context.buildingId,
              zoneId: context.zoneId,
            });
          }

          // MAINTAIN est volontairement un no-op : aucune commande MQTT n'est
          // publiée (décision produit). On journalise quand même pour que ce
          // déclenchement reste visible en terminal, sinon il serait totalement
          // silencieux (contrairement à SWITCH_OFF/ALERT qui laissent une trace
          // via publishCommand/AlertsService).
          if (action.type === 'MAINTAIN') {
            logger.info('Action MAINTAIN — aucune commande envoyée (comportement voulu)', {
              ruleId: decision.ruleId,
              targetId: action.targetId,
              targetType: action.targetType,
            });
          }
        }),
      );

      results.forEach((result, i) => {
        if (result.status === 'rejected') {
          logger.error('Échec exécution action de règle', {
            ruleId: decision.ruleId,
            action: decision.actions[i],
            err: getErrorMessage(result.reason),
          });
        }
      });
    }
  }

  /**
   * Publie une commande ON/OFF vers powerlens/{buildingId}/{deviceId}/command/{circuitId}
   * en résolvant buildingId/deviceId à partir du circuit ciblé.
   */
  private async publishCommand(
    circuitId: string,
    command: 'ON' | 'OFF',
    ruleId: string,
    correlationId: string,
  ) {
    const circuit = await this.prisma.circuit.findUnique({
      where: { id: circuitId },
      include: { device: true, zone: { include: { building: true } } },
    });

    if (!circuit) return;

    const buildingId = circuit.zone.building.id;
    const cmdTopic = commandTopic(
      buildingId,
      circuit.device.deviceUid,
      circuitId,
    );

    this.mqttService.publish(cmdTopic, {
      command,
      ruleId,
      correlationId,
      timestamp: new Date().toISOString(),
    });
    this.commandTracker.track(correlationId, circuitId, command === 'ON');

    await this.auditService.log({
      actorType: 'SYSTEM',
      action: command === 'OFF' ? 'SWITCH_OFF_SENT' : 'SWITCH_ON_SENT',
      targetType: 'CIRCUIT',
      targetId: circuitId,
      metadata: { correlationId, status: 'PENDING', ruleId },
    });
  }
}
