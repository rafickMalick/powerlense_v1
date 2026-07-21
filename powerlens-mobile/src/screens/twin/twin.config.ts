/**
 * Configuration du jumeau numérique 3D (TwinScreen.web.tsx uniquement).
 *
 * La scène 3D a une géométrie fixe à 2 salles de part et d'autre d'un
 * couloir (portes, éclairage, caméra positionnées en dur) — généraliser
 * cette géométrie à un nombre dynamique de zones est hors scope. La vue 2D
 * (TwinScreen.tsx) n'utilise PAS ce fichier : elle charge les zones
 * dynamiquement via /zones et calcule sa mise en page automatiquement.
 *
 * `maxPowerWatt` = somme des `maxPowerWatt` des circuits de la zone
 * (recalculer si les circuits du bâtiment changent).
 */
export interface ZoneConfig {
  zoneId: string;
  zoneName: string;
  maxPowerWatt: number;
}

export interface TwinConfig {
  buildingName: string;
  zones: ZoneConfig[];
}

export const TWIN_CONFIG: TwinConfig = {
  buildingName: 'SCOP — Cotonou',
  zones: [
    {
      zoneId: 'baf11948-4740-4d42-be62-f0d787bb8d5a',
      zoneName: 'Salle de Réunion',
      maxPowerWatt: 3650, // 500 (éclairage) + 1000 (prises) + 2000 (clim) + 150 (brasseur)
    },
    {
      zoneId: '90698502-aa98-494f-90cb-fbebcc99e7ec',
      zoneName: 'Open Space',
      maxPowerWatt: 3650,
    },
  ],
};
