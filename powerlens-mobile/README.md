# PowerLens Mobile

Application mobile React Native (Expo SDK 56) pour le monitoring et le pilotage énergétique en temps réel des bâtiments connectés PowerLens.

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | React Native 0.85 / Expo SDK 56 |
| Navigation | React Navigation 7 (Bottom Tabs + Native Stacks) |
| État global | Zustand 5 |
| HTTP | Axios |
| Temps réel | Socket.IO Client (WebSocket) |
| Style | NativeWind (Tailwind CSS) |
| Graphiques | react-native-gifted-charts |
| Icônes | lucide-react-native |
| Stockage sécurisé | expo-secure-store (JWT) |

## Démarrage rapide

```bash
# Installer les dépendances
npm install

# Lancer sur Android (émulateur ou device)
npm run android

# Lancer sur iOS
npm run ios

# Lancer en mode web
npm run web
```

### Variables d'environnement (`.env`)

| Variable | Description | Exemple |
|----------|-------------|---------|
| `EXPO_PUBLIC_API_URL` | URL de l'API NestJS backend | `http://10.0.2.2:3000` (émulateur Android) |
| `EXPO_PUBLIC_USE_MOCKS` | Utiliser les données de démonstration si l'API est injoignable | `false` |

## Architecture

```
src/
├── components/       # Composants UI réutilisables (Card, Button, Toast, ProgressBar...)
│   ├── ui/           # Primitives UI
│   ├── charts/       # Graphiques (ConsumptionAreaChart)
│   └── layout/       # TabBar, Header
├── navigation/       # Configuration React Navigation
│   ├── RootNavigator.tsx   # Point d'entrée (Auth ou Main)
│   ├── MainTabs.tsx        # Barre d'onglets principale
│   └── *Stack.tsx          # Sous-navigations (Rooms, Actions, Settings)
├── screens/          # Écrans de l'application (détail ci-dessous)
├── services/         # Couche API et WebSocket
│   ├── api.ts        # Client Axios (intercepteurs auth/401)
│   ├── websocket.ts  # Client Socket.IO (mesures, alertes, statuts)
│   ├── buildings.ts  # REST /buildings
│   ├── rooms.ts      # REST /rooms
│   ├── circuits.ts   # REST /circuits
│   └── mocks/        # Données de démonstration (fallback)
├── store/            # Zustand stores
│   ├── authStore.ts         # Authentification (login, JWT, session)
│   ├── uiStore.ts           # Toast, état WebSocket
│   ├── buildingStore.ts     # Bâtiments, sélection active
│   ├── roomStore.ts         # Salles, circuits, équipements
│   ├── measurementsStore.ts # Mesures temps réel + historique 24h
│   ├── alertsStore.ts       # Alertes
│   ├── rulesStore.ts        # Règles du moteur
│   └── supervisorStore.ts   # Recommandations IA
└── types/
    └── models.ts     # Types TypeScript partagés (miroir Prisma)
```

## Flux de données

```
ESP32 → MQTT → Raspberry Pi → NestJS Backend → WebSocket → App Mobile
                                    ↕
                               PostgreSQL (historique)
```

- **Temps réel** : Les mesures MQTT sont retransmises instantanément via WebSocket (`measurement` event) sans passer par la base de données.
- **Historique** : L'app interroge l'API REST (`GET /circuits/:id/measurements`) pour le graphique 24h.
- **Commandes** : L'app envoie des requêtes REST (activer/désactiver circuit), le backend publie sur MQTT.

## Écrans

### Authentification

#### Login (`LoginScreen`)
- Saisie email / mot de passe
- Connexion via `POST /auth/login` → JWT stocké dans SecureStore
- Restauration de session automatique au lancement
- Toast de confirmation (2s) puis redirection vers le Dashboard

### Navigation principale (7 onglets)

#### 1. Centre de Contrôle (`ControlCenterScreen`)
- **Vue d'ensemble** de l'état électrique du bâtiment (alimenté / limité / coupé)
- Flux d'énergie visuels (réseau, solaire, batterie → bâtiment)
- **Actions critiques** : délestage général, limitation de puissance, coupure d'urgence
- Statut en temps réel via WebSocket

#### 2. Tableau de Bord (`DashboardScreen`)
- **Puissance instantanée** (kW) : somme des mesures temps réel de tous les circuits
- **Énergie cumulée** (MWh) : total de l'énergie consommée
- **Graphique 24h** : courbe de consommation horaire (données API ou mock)
- **Consommation par salle** : barres de progression avec puissance réelle par salle
- Sources d'énergie (réseau, solaire, batterie)

#### 3. Salles (`RoomsListScreen` → `RoomDetailScreen` → `CircuitDetailScreen`)

**Liste des salles** :
- Nom, étage, statut (alimentée/limitée/coupée), puissance, nombre de circuits
- Filtre par statut

**Détail salle** (modal) :
- Liste des circuits de la salle avec toggle on/off
- Actions : alimenter / limiter / couper la salle entière

**Détail circuit** (modal) :
- Canaux de mesure (tension, courant, puissance, énergie)
- Historique de mesures du circuit
- Toggle activation/désactivation

#### 4. Équipements (`EquipmentScreen`)
- Liste de tous les équipements par type : éclairage, climatisation, prises, critique
- Filtre par salle et par type
- Toggle on/off par équipement
- Affichage de la puissance consommée

#### 5. Actions & Règles (`ActionsReactionsScreen` → `RuleFormScreen`)

**Liste des règles** :
- Règles actives/inactives du moteur de règles
- Types : seuil, horaire, événement, combinée
- Toggle activation/désactivation

**Création de règle** (modal) :
- Nom, type de règle
- Configuration des conditions (seuil de puissance, plage horaire, événement)
- Actions déclenchées (coupure circuit, alerte)
- Assignation au bâtiment actif

#### 6. Alertes (`AlertsScreen`)
- Journal des événements : surcharge, coupure, limitation, action
- Filtrage par type et par origine (manuelle / règle automatique)
- Niveaux : INFO, WARNING, CRITICAL
- Réception en temps réel via WebSocket (`alert` event)

#### 7. Rapports (`ReportsScreen`)
- Graphiques de consommation (avant/après optimisation)
- Répartition par circuit
- Historique des actions exécutées
- Statistiques clés (économies estimées, alertes résolues)

### Paramètres (`SettingsScreen` → sous-écrans)

**Écran principal** :
- Profil utilisateur (nom, email, rôle)
- Sécurité : rôle et permissions
- Sélection du bâtiment actif
- Gestion des notifications
- Déconnexion

**Gestion des bâtiments** (`BuildingManagementScreen`) :
- Ajouter / modifier / supprimer un bâtiment
- Définir la puissance maximale

**Recommandations IA** (`RecommendationsListScreen` → `RecommendationDetailScreen`) :
- Liste des recommandations générées par le Smart Supervisor
- Détail : justification, impact estimé, économies projetées
- Actions : approuver, rejeter, appliquer la recommandation

## Résilience réseau

- Indicateur visuel "Hors ligne" quand la connexion WebSocket est perdue
- Désactivation des boutons de commande en mode déconnecté
- Fallback automatique vers les données de démonstration si l'API est injoignable
- Restauration automatique de la session JWT au redémarrage

## Rôles utilisateur

| Rôle | Permissions |
|------|-------------|
| `SUPER_ADMIN` | Accès total, gestion des bâtiments et utilisateurs |
| `ADMIN` | Gestion du bâtiment assigné, règles, circuits |
| `MANAGER` | Contrôle des circuits, consultation des rapports |
| `VIEWER` | Consultation seule (dashboard, alertes, rapports) |
