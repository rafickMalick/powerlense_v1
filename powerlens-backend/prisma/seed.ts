/**
 * SEED POWERLENS — minimal, post auto-déclaration des boîtiers.
 *
 * Depuis le passage aux boîtiers auto-déclarés, la TOPOLOGIE (devices, zones,
 * circuits) n'est plus seedée : chaque boîtier la déclare lui-même au backend
 * via son message MQTT `announce` (cf. MeasurementListener.handleAnnounce).
 * Ce seed ne pose donc que ce qui ne peut pas venir du matériel :
 *
 *   - le compte administrateur de démonstration ;
 *   - le « Bâtiment par défaut » auquel les boîtiers se rattachent
 *     (MÊME NOM que DEFAULT_BUILDING_NAME côté listener — ne pas le changer
 *     d'un côté sans l'autre) ;
 *   - un tarif SBEE par défaut rattaché à ce bâtiment ;
 *   - deux règles d'exemple, volontairement SANS circuit ciblé (elles ne
 *     dépendent d'aucune charge précise, donc restent valides quels que soient
 *     les boîtiers déclarés).
 *
 * Idempotent : peut être relancé sans créer de doublons.
 * L'ancien seed de démonstration est conservé dans `seed.legacy.ts.bak`.
 */
import { PrismaClient, UserRole, AlertLevel, RuleType, TariffCategory } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcryptjs';

dotenv.config();

// Prisma 7 : le client nécessite l'adaptateur pg (comme PrismaService côté app).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Doit rester identique à DEFAULT_BUILDING_NAME (measurement.listener.ts). */
const DEFAULT_BUILDING_NAME = 'Bâtiment par défaut';

async function seedAdmin() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  await prisma.user.upsert({
    where: { email: 'admin@powerlens.local' },
    update: {},
    create: {
      fullName: 'Admin PowerLens',
      email: 'admin@powerlens.local',
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      role: UserRole.ADMIN,
    },
  });
  console.log('  → Compte admin prêt (admin@powerlens.local)');
}

/** Bâtiment unique de rattachement — créé ici ET/OU par l'annonce d'un boîtier. */
async function seedDefaultBuilding() {
  const existing = await prisma.building.findFirst({
    where: { name: DEFAULT_BUILDING_NAME },
  });
  if (existing) {
    console.log('  → Bâtiment par défaut déjà présent');
    return existing;
  }
  const building = await prisma.building.create({
    data: {
      name: DEFAULT_BUILDING_NAME,
      location: 'Non renseigné',
      description: 'Rattachement automatique des boîtiers auto-déclarés',
    },
  });
  console.log('  → Bâtiment par défaut créé');
  return building;
}

async function seedTariffPlan(buildingId: string) {
  const existing = await prisma.tariffPlan.findFirst({
    where: { name: 'SBEE BT2 Professionnel' },
  });
  const tariff =
    existing ??
    (await prisma.tariffPlan.create({
      data: {
        name: 'SBEE BT2 Professionnel',
        category: TariffCategory.BT2_PRO,
        pricePerKwhFcfa: 125, // grille SBEE BT2 (tranche unique)
        vatRate: 0.18, // TVA 18 %
        // Charges fixes (D/E/F) inconnues → 0 par défaut, à renseigner par abonné.
      },
    }));

  await prisma.building.update({
    where: { id: buildingId },
    data: { tariffPlanId: tariff.id },
  });
  console.log('  → Tarif SBEE BT2 Professionnel assigné (111 FCFA/kWh)');
}

/** Crée une règle si aucune du même nom n'existe déjà sur ce bâtiment. */
async function ensureRule(
  buildingId: string,
  name: string,
  ruleType: RuleType,
  conditions: unknown,
  actions: unknown,
) {
  const existing = await prisma.rule.findFirst({ where: { buildingId, name } });
  if (existing) return;
  await prisma.rule.create({
    data: {
      name,
      ruleType,
      buildingId,
      conditions: conditions as never,
      actions: actions as never,
    },
  });
  console.log(`  → Règle "${name}" créée`);
}

/**
 * Règles d'exemple SANS cible de circuit : elles alertent seulement, donc elles
 * restent valides quels que soient les boîtiers et charges déclarés ensuite.
 */
async function seedExampleRules(buildingId: string) {
  await ensureRule(
    buildingId,
    'Alerte surconsommation',
    RuleType.THRESHOLD,
    { type: 'THRESHOLD', field: 'power', operator: '>', value: 3000 },
    [
      {
        type: 'ALERT',
        payload: {
          level: AlertLevel.WARNING,
          message: 'Consommation anormalement élevée détectée',
        },
      },
    ],
  );

  await ensureRule(
    buildingId,
    'Alerte température élevée',
    RuleType.THRESHOLD,
    { type: 'THRESHOLD', field: 'temperature', operator: '>', value: 32 },
    [
      {
        type: 'ALERT',
        payload: {
          level: AlertLevel.INFO,
          message: 'Température élevée relevée dans une zone',
        },
      },
    ],
  );
}

async function main() {
  console.log('Seed PowerLens (minimal — la topologie vient des boîtiers)...');

  await seedAdmin();
  const building = await seedDefaultBuilding();
  await seedTariffPlan(building.id);
  await seedExampleRules(building.id);

  console.log(
    '\n✅ Seed terminé. Aucun boîtier/zone/charge créé : branche un boîtier,\n' +
      '   configure-le via son portail, il apparaîtra automatiquement dans l\'app.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
