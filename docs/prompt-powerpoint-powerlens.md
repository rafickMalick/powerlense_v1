# PROMPT POUR GENERATION DE POWERPOINT — PRESENTATION GENERALE POWERLENS

> Ce document est un brief complet destiné à une IA générative pour créer un PowerPoint de présentation du projet PowerLens. Il couvre la solution complète (prototype matériel + application logicielle), l'apport technique, le niveau d'avancement, et la vision d'évolution.

---

## INSTRUCTIONS DE MISE EN FORME

- Style professionnel et technique, couleurs sombres (thème dark/bleu foncé et vert énergie, cohérent avec l'identité PowerLens).
- Utiliser des schémas, icônes et diagrammes quand c'est pertinent (architecture, flux de données, topologie).
- Environ 15-20 slides. Langue : français.
- Police lisible, pas trop de texte par slide — privilégier les bullet points, schémas et visuels.
- Public cible : jury technique / académique (projet d'ingénierie IoT).

---

## SLIDE 1 — PAGE DE TITRE

**Titre :** PowerLens — Supervision et Pilotage Énergétique Intelligent

**Sous-titre :** Solution IoT complète pour le monitoring et le contrôle énergétique des bâtiments

**Équipe (Groupe PowerLens) :**
AHANNINKPO Jannos, AKANDO Espéro, DOHA Cadnel, TOSSOU Mélaine, HOUNDENOU Josué, EGOUDJOBI Peace Fiacre, OKE Hervé, MALICK Rafick, FALOLA Grace, HOUGNI Othniel, MEDENOU Gilles, KOUGBADI Flavio, KOUASSI Maurel

---

## SLIDE 2 — SOMMAIRE

1. Le problème : le gaspillage énergétique dans les bâtiments
2. PowerLens : notre réponse
3. Architecture globale de la solution
4. Le prototype matériel (boîtier)
5. L'application logicielle (backend + mobile)
6. Niveau d'avancement
7. Perspectives et évolution
8. Conclusion

---

## SLIDE 3 — LE PROBLÈME

**Titre :** Le gaspillage énergétique dans les bâtiments publics et tertiaires

- Les bâtiments (campus, bureaux, ministères) consomment massivement de l'énergie sans visibilité sur la répartition par salle ou par équipement.
- Pas de suivi en temps réel : les factures arrivent en fin de mois, sans moyen d'identifier les postes de gaspillage.
- Des équipements restent allumés inutilement (climatiseurs la nuit, éclairage dans des salles vides).
- Aucun système d'alerte automatique en cas de surconsommation ou d'anomalie électrique.
- Les gestionnaires n'ont aucun outil de contrôle à distance ni de règles d'automatisation.

---

## SLIDE 4 — POWERLENS : NOTRE RÉPONSE

**Titre :** PowerLens — Une solution IoT bout en bout

PowerLens est une plateforme de supervision et de pilotage énergétique temps réel qui combine :

- **Un boîtier électronique (prototype)** embarqué dans le tableau électrique, qui mesure les grandeurs électriques et peut agir sur les circuits.
- **Un serveur central intelligent (API)** qui collecte, analyse, stocke et prend des décisions automatiques.
- **Une application mobile** qui donne au gestionnaire une vue en temps réel et un contrôle à distance depuis son téléphone.

**Fonctionnalités clés :**
- Suivi instantané de la consommation par équipement et par salle
- Allumage/extinction automatique et à distance des circuits (lampes, climatiseurs, prises)
- Alertes immédiates en cas de surconsommation ou d'anomalie
- Historique de consommation (jour, semaine, mois) pour comparaison et optimisation
- Moteur de règles personnalisables (ex : "Si heure < 06h alors lampes extérieures = ON")
- Module d'intelligence artificielle (V2) pour des recommandations d'optimisation

---

## SLIDE 5 — ARCHITECTURE GLOBALE

**Titre :** Architecture de la solution — Du capteur au smartphone

Représenter ce schéma sous forme de diagramme visuel avec des flèches :

```
[Station ESP32]  --MQTT (Wi-Fi)-->  [Raspberry Pi / Broker MQTT]  --MQTT-->  [API NestJS (Serveur Central)]  --WebSocket-->  [App Mobile React Native]
   (Capteurs +                         (Concentrateur local,                     (Cerveau du système :              (Interface utilisateur :
    Relais dans                          passerelle entre                          moteur de règles,                   affichage temps réel,
    le tableau                           le terrain et                             stockage PostgreSQL,                contrôle à distance,
    électrique)                          le cloud)                                 alertes, IA)                        historique)
```

**Principes architecturaux :**
- Communication temps réel : les mesures vont du capteur à l'écran du téléphone en quelques millisecondes, sans passer par la base de données pour l'affichage.
- Le serveur API est le "seul cerveau" : toute la logique (règles, alertes, décisions) est centralisée côté backend. L'app mobile est un client simple d'affichage et de commande.
- Communication bidirectionnelle : le mobile peut aussi envoyer des commandes (allumer/éteindre un circuit) qui remontent jusqu'à l'ESP32 via la même chaîne.

---

## SLIDE 6 — LE PROTOTYPE MATÉRIEL : VUE D'ENSEMBLE

**Titre :** Le boîtier PowerLens — Prototype matériel

**Description du prototype actuel :**
Le prototype est un boîtier électronique rudimentaire mais fonctionnel, construit autour d'un microcontrôleur ESP32, qui constitue la brique fondamentale de la station de mesure.

**Ce que fait le prototype aujourd'hui :**
- Mesure de la tension aux bornes d'une charge électrique simple (une lampe, un appareil)
- Régulation de cette tension (contrôle basique ON/OFF ou ajustement)
- Communication Wi-Fi intégrée (module ESP32)
- Capacité de publier des données via le protocole MQTT

**Composants principaux :**
- Microcontrôleur ESP32 (Wi-Fi + GPIO)
- Capteur de tension (mesure aux bornes de la charge)
- Relais de commande (pour agir sur le circuit)
- Alimentation intégrée

**Point important :** C'est un prototype de validation de concept (PoC). Il démontre que la chaîne de mesure et de communication fonctionne sur un cas simple.

---

## SLIDE 7 — LE PROTOTYPE : FONCTIONNEMENT ACTUEL

**Titre :** Ce que le prototype sait faire aujourd'hui

Illustrer avec un schéma simple :

```
[Charge électrique (lampe)] <---> [Capteur de tension] <---> [ESP32] --Wi-Fi/MQTT--> [Broker MQTT]
                                                                 |
                                                          [Relais ON/OFF]
                                                          (Régulation)
```

**Capacités actuelles :**
1. **Mesure** : lecture de la tension aux bornes de la charge connectée
2. **Régulation** : capacité d'agir sur le circuit (couper/rétablir l'alimentation)
3. **Communication** : envoi des données mesurées via Wi-Fi au broker MQTT

**Limites du prototype actuel :**
- Fonctionne sur une seule charge isolée (pas encore sur un circuit complet d'un tableau électrique)
- Mesure uniquement la tension (pas encore le courant, la puissance, l'énergie cumulée)
- Régulation simple (ON/OFF) sans remontée de mesures vers l'application
- Pas encore de boîtier finalisé ni d'intégration dans un tableau électrique réel

---

## SLIDE 8 — L'APPLICATION LOGICIELLE : STACK TECHNIQUE

**Titre :** L'application PowerLens — Architecture logicielle

**Backend (Serveur Central) :**
- **Framework :** NestJS (Node.js, TypeScript) — architecture modulaire, événementielle
- **Base de données :** PostgreSQL via Prisma ORM — stockage de l'historique, des règles, des alertes, du journal d'audit
- **Communication IoT :** Client MQTT (connexion au broker, réception des mesures, envoi des commandes)
- **Temps réel :** WebSocket via Socket.io (diffusion instantanée aux clients mobiles)
- **Sécurité :** Authentification JWT, système de rôles (Super Admin, Admin, Manager, Viewer)

**Application Mobile :**
- **Framework :** React Native / Expo — cross-platform (Android, iOS, Web)
- **Gestion d'état :** Zustand — mise à jour instantanée de l'UI à chaque mesure reçue
- **UI/UX :** NativeWind (Tailwind CSS), thème sombre, icônes Lucide, graphiques interactifs
- **Résilience :** Gestion de la perte de connexion (indicateur hors ligne, désactivation des commandes)

---

## SLIDE 9 — BACKEND : LES MODULES

**Titre :** Architecture modulaire du backend

Présenter sous forme de schéma modulaire :

| Module | Rôle |
|---|---|
| **AuthModule** | Authentification JWT, gestion des utilisateurs et des rôles |
| **MqttModule** | Connexion au broker MQTT, réception des mesures, envoi des commandes aux ESP32 |
| **RealtimeModule** | Passerelle WebSocket (Socket.io), diffusion temps réel vers les mobiles |
| **RulesModule** | CRUD des règles + Moteur de règles (évaluation automatique des conditions JSONB) |
| **BuildingsModule** | Gestion des bâtiments |
| **RoomsModule** | Gestion des salles (filtrage par bâtiment, étage) |
| **CircuitsModule** | Gestion des circuits électriques (activation, désactivation, historique) |
| **MeasurementsModule** | Lecture et agrégation des mesures (par heure, jour, semaine, mois) |
| **SimulatorModule** | Simulateur matériel — génère des mesures réalistes pour la démo sans ESP32 physique |
| **SupervisorModule (V2)** | Intelligence artificielle — analyse nocturne, détection d'anomalies, recommandations |

---

## SLIDE 10 — LE MOTEUR DE RÈGLES

**Titre :** Moteur de règles intelligent — Automatisation personnalisable

**Principe :** L'administrateur définit des règles en langage naturel structuré, stockées en JSONB dans la base de données. Le moteur les évalue automatiquement à chaque mesure reçue.

**Types de conditions supportés :**
- **THRESHOLD** (seuil) : "Si la puissance dépasse 2000W, alors éteindre le climatiseur"
- **SCHEDULE** (horaire) : "Entre 22h et 6h, éteindre l'éclairage extérieur"
- **AND / OR** (combinaisons logiques) : "Si puissance > 1500W ET heure > 20h, alors alerte"
- **EVENT** (événement) : "Si porte ouverte, alors allumer la lumière"

**Actions possibles :**
- `SWITCH_OFF` : coupure automatique d'un circuit (commande envoyée à l'ESP32 via MQTT)
- `ALERT` : génération d'une alerte (stockée en base + envoyée en temps réel au mobile)

**Sécurité :**
- Anti-répétition (front montant : ne déclenche qu'au passage du seuil, pas en continu)
- Cooldown de 30 secondes entre deux déclenchements d'une même règle
- Journal d'audit complet (qui a déclenché quoi, quand, pourquoi)

---

## SLIDE 11 — L'APPLICATION MOBILE : ÉCRANS

**Titre :** L'application mobile — 10 écrans fonctionnels

Présenter avec des captures d'écran ou des mockups :

1. **Login** — Authentification sécurisée (JWT)
2. **Dashboard** — Vue d'ensemble temps réel (consommation globale, alertes, statut des circuits)
3. **Salles** — Liste des salles du bâtiment, avec statut des circuits
4. **Détail salle** — Circuits de la salle, mesures en direct, graphiques
5. **Détail circuit** — Historique de consommation, courbes (tension, courant, puissance)
6. **Centre de contrôle** — Activation/désactivation des circuits à distance
7. **Équipements** — Liste des devices ESP32, statut (en ligne/hors ligne)
8. **Actions & Réactions** — Gestion des règles d'automatisation (créer, modifier, supprimer)
9. **Alertes** — Historique des alertes (info, warning, critique)
10. **Rapports** — Historique de consommation, comparaisons avant/après
11. **Paramètres** — Profil, rôles, gestion des bâtiments, déconnexion
12. **Recommandations IA (V2)** — Suggestions d'optimisation par le Smart Supervisor (réservé aux admins)

---

## SLIDE 12 — LE FLUX TEMPS RÉEL

**Titre :** Le flux de données en temps réel — Du capteur à l'écran en millisecondes

Illustrer ce flux pas à pas :

1. **ESP32** publie un JSON sur le topic MQTT `powerlens/{batiment}/{device}/measure` contenant : tension, courant, puissance, énergie cumulée, horodatage.
2. **Broker MQTT** relaie le message au serveur NestJS.
3. **MeasurementListener** (backend) reçoit le message et fait 3 choses en parallèle :
   - **Diffusion immédiate** via WebSocket → l'app mobile affiche la mesure instantanément
   - **Insertion asynchrone** dans PostgreSQL → l'historique est sauvegardé en arrière-plan
   - **Évaluation des règles** → le moteur vérifie si une règle doit se déclencher
4. Si une règle se déclenche :
   - Action SWITCH_OFF → commande MQTT renvoyée à l'ESP32 → le circuit est coupé physiquement
   - Action ALERT → alerte créée en base + envoyée en temps réel au mobile
5. L'ESP32 confirme la commande via un ACK → mise à jour du statut du circuit → notification mobile

**Point clé :** La mesure est affichée sur le téléphone AVANT d'être stockée en base de données. C'est la garantie du temps réel.

---

## SLIDE 13 — MODULE SMART SUPERVISOR (V2 - IA)

**Titre :** PowerLens Smart Supervisor — L'intelligence artificielle au service de l'énergie

**Principe :** Un module d'analyse périodique (exécution nocturne à 3h du matin) qui scrute l'historique des 30 à 90 derniers jours pour détecter des anomalies et proposer des optimisations.

**4 détecteurs intelligents :**
1. **Consommation excessive** : identifie les circuits qui consomment anormalement sur des plages horaires récurrentes → propose une règle d'extinction automatique
2. **Équipement sous-utilisé** : détecte les circuits actifs qui ne consomment quasiment rien depuis 90 jours → signalement pour vérification
3. **Règles inefficaces** : analyse les règles existantes qui se déclenchent trop souvent (seuil mal calibré) ou jamais → propose un ajustement ou une suppression
4. **Alertes répétitives** : identifie les alertes qui reviennent en boucle sans action corrective → propose une nouvelle règle

**Principe de sécurité fondamental :** Le Smart Supervisor ne modifie JAMAIS les règles automatiquement. Chaque recommandation reste en attente ("PENDING") jusqu'à validation humaine par un administrateur. Traçabilité complète : qui a approuvé, quand, pourquoi.

---

## SLIDE 14 — NIVEAU D'AVANCEMENT

**Titre :** État d'avancement du projet

**Prototype matériel :**
| Élément | Statut |
|---|---|
| Mesure de tension aux bornes d'une charge | ✅ Fonctionnel |
| Régulation de tension (ON/OFF) | ✅ Fonctionnel |
| Communication Wi-Fi / MQTT | ✅ Fonctionnel |
| Mesure courant + puissance | ❌ À intégrer |
| Intégration sur circuit complet (tableau électrique) | ❌ À développer |
| Envoi de mesures formatées vers l'API | ❌ À implémenter |
| Réception et exécution de commandes depuis l'API | ❌ À implémenter |
| Boîtier physique finalisé | ❌ En conception |

**Application logicielle :**
| Élément | Statut |
|---|---|
| Backend NestJS complet (tous les modules) | ✅ Fonctionnel |
| Base de données PostgreSQL (schéma + seed + migrations) | ✅ Fonctionnel |
| Communication MQTT bidirectionnelle | ✅ Fonctionnel |
| WebSocket temps réel | ✅ Fonctionnel |
| Moteur de règles (THRESHOLD, SCHEDULE, AND/OR, EVENT) | ✅ Fonctionnel |
| Simulateur matériel (démo sans ESP32) | ✅ Fonctionnel |
| Application mobile (12 écrans, thème sombre) | ✅ Fonctionnel |
| Authentification JWT + rôles | ✅ Fonctionnel |
| Smart Supervisor IA (V2) | ✅ Fonctionnel |
| Sécurisation WebSocket (auth + cloisonnement) | ⚠️ Identifié, à faire |
| RBAC complet sur tous les endpoints | ⚠️ Partiel (uniquement /supervisor) |
| Protection brute-force login | ❌ À ajouter |
| Déploiement en production | ❌ Prêt (documentation complète, à exécuter) |

---

## SLIDE 15 — L'APPORT TECHNIQUE DE L'APPLICATION

**Titre :** Apport technique — Ce que l'application apporte au projet

1. **Architecture temps réel de bout en bout** : une chaîne complète ESP32 → MQTT → NestJS → WebSocket → React Native, où chaque couche est découplée et remplaçable. Le temps réel est garanti par conception (diffusion WebSocket AVANT persistance en base).

2. **Moteur de règles générique en JSONB** : pas de logique "en dur" — les conditions et actions sont stockées dans un format JSON flexible, évaluées dynamiquement. Permet d'ajouter de nouveaux types de règles sans modifier le code.

3. **Simulateur matériel intégré** : permet de démontrer 100% des fonctionnalités de l'application sans aucun ESP32 physique. Génère des mesures réalistes (tension 215-225V, courant borné par la puissance max du circuit).

4. **Intelligence artificielle (V2)** : le Smart Supervisor analyse les données historiques pour proposer des optimisations, avec un workflow humain-dans-la-boucle (human-in-the-loop) pour la validation.

5. **Qualité logicielle** : TypeScript bout en bout (backend + mobile), validation stricte des données (class-validator), journal d'audit complet, gestion de la résilience (reconnexion MQTT automatique, indicateur hors ligne mobile).

6. **Prêt pour la production** : documentation complète (architecture, API, MQTT, WebSocket, déploiement), estimation de coût (~5€/mois VPS), plan de sécurisation documenté.

---

## SLIDE 16 — DU PROTOTYPE ACTUEL À LA VISION FINALE

**Titre :** Feuille de route — Du prototype rudimentaire à la solution complète

Présenter sous forme de timeline / roadmap visuelle avec 3 étapes :

### ÉTAPE 1 — Aujourd'hui : le prototype de validation (PoC)
- **Matériel** : ESP32 + capteur de tension sur UNE charge isolée
- **Capacité** : mesure de tension + régulation ON/OFF
- **Application** : complète côté logiciel, fonctionne avec un simulateur matériel
- **Statut** : Le prototype prouve que le concept fonctionne. L'application est quasi complète.

### ÉTAPE 2 — Prochaine étape : passage aux circuits complets
- **Matériel** : Ajout de capteurs de courant (ACS712 ou transformateur de courant), calcul de puissance (P = U × I) et d'énergie cumulée (kWh). Intégration dans un tableau électrique réel sur PLUSIEURS circuits.
- **Liaison prototype ↔ application** : L'ESP32 envoie les mesures formatées en JSON vers le broker MQTT au format attendu par l'API (`{circuitId, voltage, current, power, energyKwh, measuredAt}`). Il reçoit et exécute les commandes ON/OFF depuis l'API.
- **Boîtier** : conception d'un boîtier physique intégrable en armoire électrique.
- **Impact** : La boucle complète Capteur → API → Mobile → Commande → Capteur fonctionne de bout en bout sur un vrai bâtiment.

### ÉTAPE 3 — Vision long terme : solution déployable à grande échelle
- **Multi-bâtiments** : cloisonnement WebSocket par bâtiment, RBAC complet, déploiement cloud.
- **IA opérationnelle** : Smart Supervisor activé en production, recommandations d'optimisation basées sur des données réelles.
- **Produit finalisé** : boîtier industrialisé, application publiée sur les stores, documentation utilisateur.

---

## SLIDE 17 — EVOLUTION DU PROTOTYPE : CE QUI CHANGE CONCRÈTEMENT

**Titre :** Du prototype actuel à la station de mesure complète — Détail technique

**Aujourd'hui (prototype rudimentaire) :**
- 1 charge isolée
- Mesure tension uniquement
- Régulation simple (ON/OFF local)
- Pas de communication structurée vers l'API

**Demain (station de mesure PowerLens) :**
- Plusieurs circuits du tableau électrique
- Mesure tension + courant + puissance + énergie cumulée
- Envoi des mesures toutes les 2-5 secondes en JSON via MQTT vers l'API
- Réception des commandes ON/OFF depuis l'API (via topic MQTT dédié)
- Acquittement des commandes (confirmation d'exécution) renvoyé à l'API
- Format de message standardisé et documenté (contrat MQTT)

**Ce qui ne change PAS côté application :**
- Le backend est DÉJÀ prêt à recevoir ces mesures (le contrat MQTT est défini et testé avec le simulateur)
- L'app mobile est DÉJÀ prête à les afficher (les écrans, les graphiques, les alertes fonctionnent)
- Le moteur de règles est DÉJÀ prêt à les évaluer (les seuils, les horaires, les actions automatiques)
- Seul le firmware ESP32 doit être adapté pour parler le même langage que l'API

---

## SLIDE 18 — CONTRAT MQTT : LE LANGAGE COMMUN

**Titre :** Le contrat MQTT — Comment le prototype et l'application se parlent

**Topics MQTT (convention de nommage) :**

| Direction | Topic | Exemple |
|---|---|---|
| ESP32 → API (mesures) | `powerlens/{batiment}/{device}/measure` | `powerlens/b1/ESP32-PL-001/measure` |
| API → ESP32 (commandes) | `powerlens/{batiment}/{device}/command/{circuit}` | Commande ON/OFF |
| ESP32 → API (confirmation) | `powerlens/{batiment}/{device}/ack/{circuit}` | Confirmation d'exécution |

**Format du message de mesure (JSON) :**
```json
{
  "circuitId": "uuid-du-circuit",
  "voltage": 221.34,
  "current": 3.812,
  "power": 843.59,
  "energyKwh": 1.2456,
  "measuredAt": "2026-06-12T10:15:30.000Z"
}
```

**Point clé :** Ce contrat est déjà défini, documenté et testé avec le simulateur. Le prototype n'a qu'à implémenter ce format pour être immédiatement compatible avec l'ensemble de la plateforme.

---

## SLIDE 19 — COÛTS ET DÉPLOIEMENT

**Titre :** Mise en production — Simple et économique

**Infrastructure nécessaire :**
- 1 VPS (serveur privé virtuel) : ~5€/mois (Hetzner, OVH, DigitalOcean)
- 1 nom de domaine : ~10€/an
- Certificats SSL (Let's Encrypt) : gratuit
- **Total : moins de 10€/mois** pour un environnement de production complet

**Ce que le VPS héberge :**
- Mosquitto (broker MQTT) — passerelle de communication IoT
- PostgreSQL — base de données
- NestJS (API) — serveur applicatif
- Nginx — reverse proxy avec HTTPS

**Application mobile :**
- Build via Expo (EAS Build) pour générer l'APK (Android) ou l'IPA (iOS)
- Distribution : stores ou installation directe

---

## SLIDE 20 — CONCLUSION

**Titre :** PowerLens — Une solution complète, du capteur au smartphone

**Ce que nous avons réalisé :**
- Un prototype matériel fonctionnel qui prouve la faisabilité de la mesure et de la régulation
- Une application logicielle quasi complète (backend + mobile + IA) prête à être connectée au matériel réel
- Une architecture pensée pour le temps réel, la scalabilité et la sécurité
- Une documentation technique exhaustive

**Ce qui reste à faire :**
- Faire évoluer le prototype : passer d'une charge isolée à un tableau électrique complet, ajouter les capteurs de courant, implémenter le firmware MQTT
- Connecter le prototype à l'application : le contrat MQTT est prêt, il suffit que l'ESP32 parle le même langage
- Déployer en production : l'infrastructure est documentée, le coût est minimal

**Message clé :** Le logiciel est prêt. Le prototype a validé le concept. L'étape suivante est de les connecter pour obtenir une solution de supervision énergétique complète, opérationnelle et déployable dans n'importe quel bâtiment.

---

## SLIDE BONUS (OPTIONNELLE) — DÉMO EN DIRECT

**Titre :** Démonstration

- Le simulateur matériel intégré au backend génère des mesures réalistes toutes les 5 secondes
- Montrer l'app mobile recevant les mesures en temps réel (Dashboard, détail salle, graphiques)
- Montrer l'activation/désactivation d'un circuit depuis le téléphone
- Montrer le déclenchement d'une alerte quand un seuil est dépassé
- Montrer une recommandation IA du Smart Supervisor

---

## DONNÉES TECHNIQUES COMPLÉMENTAIRES (pour enrichir les slides si besoin)

**Modèle de données :**
- `User` (4 rôles : SUPER_ADMIN, ADMIN, MANAGER, VIEWER)
- `Building` → `Room[]` → `Circuit[]`
- `Device` (ESP32 physique, statut ONLINE/OFFLINE/MAINTENANCE)
- `EnergyMeasurement` (tension, courant, puissance, énergie, horodatage)
- `Rule` (conditions JSONB + actions JSONB)
- `Alert` (niveaux INFO, WARNING, CRITICAL)
- `AuditLog` (traçabilité complète)
- `RuleRecommendation` (V2 — suggestions IA)
- `SupervisorRun` (V2 — historique des analyses)

**Nombre d'écrans mobile :** 12 écrans fonctionnels
**Nombre de modules backend :** 10 modules
**Nombre de endpoints REST :** ~25 routes documentées
**Nombre d'événements WebSocket :** 3 (measurement, alert, circuit:status)

**Stack technique complète :**
- Backend : NestJS 11, Prisma 7, PostgreSQL, MQTT.js, Socket.io, Winston (logs), bcryptjs, Passport JWT, class-validator, @nestjs/schedule
- Mobile : Expo 56, React Native 0.85, Zustand, Socket.io-client, Axios, NativeWind, Lucide React Native, react-native-gifted-charts
- Prototype : ESP32, MQTT (PubSubClient/WiFiClientSecure)
