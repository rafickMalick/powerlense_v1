import { Test, TestingModule } from '@nestjs/testing';
import { ProviderSwitcherService } from './provider-switcher.service';
import { SimulatorService } from './simulator.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../modules/audit/audit.service';
import { MqttService } from '../mqtt/mqtt.service';

// Types locaux pour les mocks
type MqttHandler = (topic: string, message: Buffer) => void;
type Handler = (payload: unknown) => void;

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSimulator = {
  startSimulation: jest.fn(),
  stopSimulation: jest.fn(),
  isRunning: jest.fn().mockReturnValue(false),
};

const mockRealtime = {
  emitProviderSwitch: jest.fn(),
  emitAlert: jest.fn(),
};

const mockPrisma = {
  alert: { create: jest.fn().mockResolvedValue({ id: 'alert-1', level: 'WARNING', message: 'test', createdAt: new Date().toISOString(), acknowledged: false }) },
};

const mockAuditService = {
  log: jest.fn().mockResolvedValue(undefined),
};

let mqttSubscribeHandler: MqttHandler | null = null;
const mockMqtt = {
  subscribe: jest.fn((_, handler: MqttHandler) => { mqttSubscribeHandler = handler; }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function publishRealMessage(payload: Record<string, unknown>) {
  mqttSubscribeHandler?.(
    'powerlens/bldg-1/ESP32-001/measure',
    Buffer.from(JSON.stringify(payload)),
  );
}

function publishSimulatedMessage() {
  mqttSubscribeHandler?.(
    'powerlens/bldg-1/ESP32-001/measure',
    Buffer.from(JSON.stringify({ _sim: true, power: 100, circuitId: 'c1' })),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProviderSwitcherService', () => {
  let service: ProviderSwitcherService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mqttSubscribeHandler = null;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderSwitcherService,
        { provide: SimulatorService, useValue: mockSimulator },
        { provide: RealtimeGateway, useValue: mockRealtime },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditService, useValue: mockAuditService },
        { provide: MqttService, useValue: mockMqtt },
      ],
    }).compile();

    service = module.get<ProviderSwitcherService>(ProviderSwitcherService);
    // Supprime les timers créés par onModuleInit afin de les contrôler manuellement
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    service.onModuleDestroy();
  });

  // ── 1. Initialisation ───────────────────────────────────────────────────

  it('s\'abonne au topic MQTT au démarrage', async () => {
    service.onModuleInit();
    expect(mockMqtt.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('+/+/measure'),
      expect.any(Function),
    );
  });

  // ── 2. Détection trafic réel ─────────────────────────────────────────────

  it('ignore les messages simulés (_sim=true) pour la détection', () => {
    service.onModuleInit();
    publishSimulatedMessage();
    expect(service['lastRealTrafficAt']).toBeNull();
  });

  it('enregistre lastRealTrafficAt à la réception d\'un message ESP réel', () => {
    service.onModuleInit();
    const before = Date.now();
    publishRealMessage({ power: 200, circuitId: 'c1' });
    expect(service['lastRealTrafficAt']).not.toBeNull();
    expect(service['lastRealTrafficAt']!.getTime()).toBeGreaterThanOrEqual(before);
  });

  // ── 3. Bascule vers simulateur (pas d'ESP) ───────────────────────────────

  it('active le simulateur si aucun ESP ne publie après le délai initial', async () => {
    process.env.ESP_STARTUP_WAIT_MS = '100';
    process.env.ESP_CHECK_INTERVAL_MS = '99999';
    process.env.ESP_TIMEOUT_MS = '500';

    service.onModuleInit();
    expect(service.getIsSimulating()).toBe(false);

    // Avance le temps pour déclencher l'évaluation initiale
    jest.advanceTimersByTime(200);
    // Donne la chance aux Promises internes de se résoudre
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSimulator.startSimulation).toHaveBeenCalledTimes(1);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROVIDER_SWITCHED_TO_SIMULATOR' }),
    );
    expect(mockPrisma.alert.create).toHaveBeenCalledTimes(1);
    expect(mockRealtime.emitProviderSwitch).toHaveBeenCalledWith({ mode: 'simulator', reason: 'esp_timeout' });

    delete process.env.ESP_STARTUP_WAIT_MS;
    delete process.env.ESP_CHECK_INTERVAL_MS;
    delete process.env.ESP_TIMEOUT_MS;
  });

  // ── 4. Bascule vers MQTT (ESP reconnecté) ────────────────────────────────

  it('arrête le simulateur lorsque des données ESP arrivent', async () => {
    process.env.ESP_STARTUP_WAIT_MS = '100';
    process.env.ESP_CHECK_INTERVAL_MS = '200';
    process.env.ESP_TIMEOUT_MS = '500';

    service.onModuleInit();

    // D'abord activer le simulateur (aucun ESP)
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSimulator.startSimulation).toHaveBeenCalledTimes(1);

    // Simuler un message ESP réel
    publishRealMessage({ power: 350, circuitId: 'c1' });

    // Déclencher le check suivant
    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSimulator.stopSimulation).toHaveBeenCalledTimes(1);
    expect(mockAuditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PROVIDER_SWITCHED_TO_MQTT' }),
    );
    expect(mockRealtime.emitProviderSwitch).toHaveBeenCalledWith({ mode: 'mqtt', reason: 'esp_reconnected' });

    delete process.env.ESP_STARTUP_WAIT_MS;
    delete process.env.ESP_CHECK_INTERVAL_MS;
    delete process.env.ESP_TIMEOUT_MS;
  });

  // ── 4bis. ESP déjà présent dès le démarrage (jamais simulé) ──────────────

  it('émet quand même provider:switched(mqtt) si un ESP réel publie avant la 1ère évaluation', async () => {
    process.env.ESP_STARTUP_WAIT_MS = '100';
    process.env.ESP_CHECK_INTERVAL_MS = '99999';
    process.env.ESP_TIMEOUT_MS = '500';

    service.onModuleInit();

    // Un ESP réel publie AVANT que le simulateur n'ait jamais été activé
    // (isSimulating encore à sa valeur initiale, jamais passé par `true`).
    publishRealMessage({ power: 200, circuitId: 'c1' });

    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();

    // Sans le correctif, isSimulating démarre à `false` et la condition
    // `hasReal && this.isSimulating` reste fausse : aucun évènement n'est
    // jamais émis, le frontend reste bloqué sur son mode par défaut.
    expect(mockSimulator.startSimulation).not.toHaveBeenCalled();
    expect(mockRealtime.emitProviderSwitch).toHaveBeenCalledWith({ mode: 'mqtt', reason: 'esp_reconnected' });

    delete process.env.ESP_STARTUP_WAIT_MS;
    delete process.env.ESP_CHECK_INTERVAL_MS;
    delete process.env.ESP_TIMEOUT_MS;
  });

  // ── 5. Pas de double bascule ─────────────────────────────────────────────

  it('ne bascule pas si l\'état n\'a pas changé', async () => {
    process.env.ESP_STARTUP_WAIT_MS = '9999';
    process.env.ESP_CHECK_INTERVAL_MS = '100';
    process.env.ESP_TIMEOUT_MS = '500';

    service.onModuleInit();

    // Simulateur déjà actif (état initial isSimulating=false, pas d'ESP → ne doit pas re-déclencher)
    // On simule le cas où isSimulating est déjà true
    service['isSimulating'] = true;

    // Check : simulateur déjà actif, toujours pas d'ESP → aucun changement
    jest.advanceTimersByTime(150);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSimulator.startSimulation).not.toHaveBeenCalled();
    expect(mockSimulator.stopSimulation).not.toHaveBeenCalled();

    delete process.env.ESP_STARTUP_WAIT_MS;
    delete process.env.ESP_CHECK_INTERVAL_MS;
    delete process.env.ESP_TIMEOUT_MS;
  });

  // ── 6. ESP injoignable payload malformé ─────────────────────────────────

  it('ignore les messages MQTT non-JSON sans planter', () => {
    service.onModuleInit();
    expect(() => {
      mqttSubscribeHandler?.(
        'powerlens/bldg-1/ESP32-001/measure',
        Buffer.from('NOT_JSON'),
      );
    }).not.toThrow();
    expect(service['lastRealTrafficAt']).toBeNull();
  });
});
