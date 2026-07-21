<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# PowerLens — Backend (NestJS)

API centrale de **PowerLens**, plateforme de supervision et de pilotage
énergétique temps réel pour des bâtiments (campus, bureaux, etc.).

## 1. Vue d'ensemble

```
ESP32 (capteurs) <-> MQTT (broker Mosquitto) <-> NestJS (ce dépôt) <-> WebSocket <-> App mobile (React Native / Expo)
```

- **Temps réel** : les mesures reçues via MQTT sont retransmises
  **instantanément** aux clients via WebSocket ; l'écriture en base
  (`energy_measurements`) se fait de manière asynchrone en arrière-plan.
- **Single point of truth** : l'API NestJS porte toute la logique métier
  (authentification, moteur de règles, commandes) — l'app mobile ne fait
  qu'afficher des états et envoyer des requêtes.
- **Stack** : NestJS 11 + Prisma 7 + PostgreSQL, MQTT (`mqtt`), WebSocket
  (`@nestjs/websockets` + socket.io), JWT (`@nestjs/jwt` + Passport).

## 2. Démarrage rapide

```bash
npm install
npm run prisma:generate
npm run prisma:seed     # données de démo (admin, bâtiment, salles, circuits...)
npm run start:dev       # API sur http://localhost:3000
```

Variables d'environnement requises (`.env`), notamment `DATABASE_URL` et
`JWT_SECRET` (obligatoire — l'app refuse de démarrer sans). Voir le détail
complet, y compris l'activation du simulateur de mesures pour tester sans
matériel, dans **[`docs/setup.md`](../docs/setup.md)**.

## 3. Scripts utiles

```bash
npm run start:dev    # mode watch
npm run build        # build de production
npm run lint         # ESLint (--fix)
npm run test         # tests unitaires (Jest)
npm run test:e2e     # tests end-to-end
npm run prisma:migrate  # migrations Prisma
npm run prisma:seed     # rejoue le seed de démo
```

## 4. Documentation (`docs/`)

L'ensemble de la documentation fonctionnelle et technique se trouve dans
[`docs/`](../docs/) à la racine du dépôt. Pour comprendre le projet et le
tester, commencer par **`setup.md`** puis **`architecture.md`**.

| Fichier | Rôle |
|---|---|
| [`setup.md`](../docs/setup.md) | Guide d'installation et de démarrage (backend + mobile) : prérequis, variables d'environnement, base de données/seed, activation du simulateur MQTT, démo complète de bout en bout, identifiants par défaut. **Point d'entrée pour prendre le projet en main.** |
| [`architecture.md`](../docs/architecture.md) | Vue d'ensemble de l'architecture (backend + mobile), règles architecturales non négociables, modules NestJS, modèle de données Prisma, flux de données ESP32 → mobile. |
| [`api.md`](../docs/api.md) | Référence de l'API REST : tous les endpoints (`/auth`, `/buildings`, `/rooms`, `/circuits`, `/measurements`, `/rules`), formats de requêtes/réponses, endpoints protégés (🔒 = JWT requis). |
| [`mqtt.md`](../docs/mqtt.md) | Contrat MQTT : configuration du broker, topics (mesure/commande/ack/événement), formats des messages JSON, fonctionnement du simulateur matériel, résilience (reconnexion). |
| [`websocket.md`](../docs/websocket.md) | Passerelle WebSocket temps réel (`RealtimeGateway`) : événements diffusés (`measurement`, `alert`, `circuit:status`), intégration côté mobile. |
| [`rapport-phase-A.md`](../docs/rapport-phase-A.md) | Rapport de fin de Phase A — état du backend NestJS/Prisma/PostgreSQL, fichiers créés/modifiés/supprimés, décisions d'architecture. |
| [`rapport-phase-B.md`](../docs/rapport-phase-B.md) | Rapport de fin de Phase B — application mobile (Expo/React Native), mapping UI ↔ backend. |
| [`rapport-phase-C.md`](../docs/rapport-phase-C.md) | Rapport de fin de Phase C — synthèse de la documentation produite et points notés pendant sa rédaction. |

## 5. Ressources NestJS

- [Documentation NestJS](https://docs.nestjs.com)
- [Documentation Prisma](https://www.prisma.io/docs)
