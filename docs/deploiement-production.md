# Passage en production — PowerLens

> Document de présentation / planification. **Aucune modification du code
> n'a été faite** : ce guide explique comment déployer ce qui existe déjà
> (backend NestJS, broker MQTT, ESP32, mobile) sans toucher à
> l'architecture actuelle. Les "actions futures" sont signalées comme
> telles.

## 1. Rappel de la topologie (inchangée)

```
ESP32 (capteurs) --MQTT--> Broker MQTT --MQTT--> NestJS API --WebSocket--> App mobile
                                                      |
                                                      v
                                                 PostgreSQL
```

En production, **seuls les emplacements physiques changent** (le broker,
l'API et la base ne sont plus sur `localhost`) : le code lit déjà ces
adresses via `.env` (`MQTT_BROKER_URL`, `DATABASE_URL`, `CORS_ORIGINS`,
`EXPO_PUBLIC_API_URL`). Donc passer en prod = **changer la configuration**,
pas réécrire le code.

---

## 2. Où héberger le backend NestJS ?

### Pourquoi pas une plateforme "serverless" classique
Le backend PowerLens maintient :
- une **connexion MQTT persistante** (`MqttService`, reconnexion en boucle),
- des **connexions WebSocket** (Socket.io) en temps réel.

Ces deux besoins exigent un **processus Node.js qui tourne en continu**.
Les plateformes "serverless" (fonctions à la demande, type Vercel
Functions) ne convainnent donc pas. Il faut un service "toujours actif".

### Options recommandées

| Option | Description | Quand l'utiliser |
|---|---|---|
| **VPS (serveur privé virtuel)** — OVH, Hetzner, Scaleway, DigitalOcean | Petit serveur Linux (2 Go RAM suffisent largement). On y installe Node, PostgreSQL et Mosquitto (broker MQTT). | **Recommandé** pour PowerLens : tout est centralisé, coût ~5€/mois, contrôle total, le broker MQTT et l'API sont sur la même machine donc latence quasi nulle. |
| **PaaS (Platform as a Service)** — Railway, Render, Fly.io | On déploie juste le repo NestJS, la plateforme gère le serveur. Plans "Web Service" (pas "serverless") pour garder le process actif. | Plus simple à mettre en place, mais le broker MQTT doit être hébergé **ailleurs** (cloud MQTT managé, voir §3). Bon pour une démo rapide en ligne. |
| **Raspberry Pi existant (on-premise)** | Le Raspberry Pi qui héberge déjà le broker MQTT local peut aussi héberger l'API NestJS et PostgreSQL. Exposé sur Internet via un tunnel (Cloudflare Tunnel, Tailscale) ou un port forwarding + nom de domaine dynamique (DuckDNS). | Si le bâtiment a une connexion Internet stable et qu'on veut éviter le cloud (données locales, coût nul). |

**Recommandation pour une démo "prod" crédible** : VPS Hetzner/OVH (~4-6
€/mois) avec Docker (ou installation directe Node + PM2), Mosquitto et
PostgreSQL sur la même machine. C'est l'option qui colle le mieux à
l'architecture "Raspberry Pi <-> NestJS" déjà conçue : le Raspberry Pi peut
même être remplacé tel quel par le VPS pour la démo, sans changer la
logique.

---

## 3. Le canal MQTT en ligne

Aujourd'hui (`MQTT_BROKER_URL=mqtt://localhost:1883`), le broker tourne en
local sans authentification ni chiffrement. En production, deux choix :

### Option A — Broker auto-hébergé (Mosquitto sur le VPS) — recommandé
- Installer Mosquitto sur le même VPS que l'API NestJS.
- Activer :
  - **TLS** (port `8883`) avec un certificat Let's Encrypt → URL
    `mqtts://votre-domaine.com:8883`.
  - **Authentification** par utilisateur/mot de passe (fichier
    `passwd` Mosquitto), un compte pour le backend et un compte (ou un par
    device) pour les ESP32.
- Le code actuel (`mqtt.connect(mqttConfig.brokerUrl, ...)` dans
  [mqtt.service.ts](../powerlens-backend/src/mqtt/mqtt.service.ts)) supporte
  déjà `mqtts://` (la lib `mqtt.js` détecte le protocole automatiquement).
  Pour l'auth, il faudra **ajouter** `username`/`password` dans
  `mqttConfig.options` (action future, hors scope "sans toucher au code"
  — mais c'est la seule modification minime nécessaire pour sécuriser le
  canal).
- Avantage : tout reste dans votre infra, pas de dépendance externe,
  latence minimale entre broker et API (les deux sur la même machine →
  on peut même garder `mqtt://localhost:1883` côté backend si le broker
  est local au VPS, et exposer le port 8883 en TLS uniquement pour les
  ESP32 distants).

### Option B — Broker MQTT managé (cloud)
- Services : **HiveMQ Cloud** (offre gratuite jusqu'à 100 connexions),
  **EMQX Cloud**, **CloudAMQP (MQTT)**.
- Avantages : zéro administration, TLS et auth fournis par défaut, URL du
  type `mqtts://xxxx.s1.eu.hivemq.cloud:8883`.
- Inconvénient : latence réseau supplémentaire (le backend ET les ESP32
  doivent atteindre le cloud), dépendance à un tiers, limites du plan
  gratuit.
- Utilisation : il suffit de changer `MQTT_BROKER_URL` dans `.env` du
  backend (et les identifiants WiFi/MQTT sur les ESP32). **Zéro
  changement de code** côté NestJS si le broker managé n'exige que
  `mqtts://` + user/password déjà géré par `mqtt.connect` (à condition
  d'ajouter `username`/`password`/`port` — même remarque que ci-dessus).

### Recommandation
Pour une présentation "prod", **Option A (Mosquitto sur le VPS avec
TLS + auth)** : c'est gratuit, cohérent avec l'architecture
"Raspberry Pi/serveur central" déjà documentée, et démontre une vraie
maîtrise infra plutôt qu'une dépendance à un service tiers.

---

## 4. Base de données PostgreSQL

- **Auto-hébergée** sur le même VPS (Docker `postgres:16` ou paquet
  natif) — cohérent avec le `DATABASE_URL` actuel, juste changer
  `localhost` par l'adresse du VPS (ou garder `localhost` si l'API tourne
  sur la même machine).
- **Managée** (Neon, Supabase, Railway Postgres, RDS) si vous préférez ne
  pas gérer les sauvegardes/mises à jour vous-même. Changer uniquement
  `DATABASE_URL`.

Dans les deux cas : exécuter `npm run prisma:migrate deploy` (ou
`prisma migrate deploy` en prod, pas `migrate dev`) et `npm run
prisma:seed` une seule fois pour initialiser les données.

---

## 5. Connecter un ESP32 au système en production

Le contrat MQTT (topics, payloads JSON) est **déjà défini et ne change
pas** — voir [mqtt.md](mqtt.md). Ce qui change en passant en prod, c'est
uniquement la **configuration réseau côté ESP32** :

1. **WiFi** : l'ESP32 doit avoir accès à Internet (ou au même réseau que
   le broker si on reste en local).
2. **Adresse du broker** : remplacer l'IP locale (`192.168.x.x:1883`) par
   :
   - le domaine du VPS + port `8883` en TLS (Option A), ou
   - l'URL du broker cloud managé (Option B).
3. **TLS sur ESP32** : la lib `PubSubClient`/`WiFiClientSecure` (Arduino)
   ou `esp-mqtt` (ESP-IDF) supporte MQTT over TLS. Il faut embarquer le
   certificat CA (Let's Encrypt root CA, ou certificat fourni par le
   broker cloud) dans le firmware.
4. **Authentification** : configurer `username`/`password` MQTT dans le
   firmware (correspondant au compte créé sur le broker, §3).
5. **Topics inchangés** : l'ESP32 publie toujours sur
   `powerlens/{buildingId}/{deviceId}/measure` et s'abonne à
   `powerlens/{buildingId}/{deviceId}/command/{circuitId}` —
   `buildingId`/`deviceId` doivent correspondre aux enregistrements
   `Building`/`Device` créés en base (via le seed ou l'API `/buildings`,
   `/devices`).

**Résumé** : pour brancher un ESP32 réel en prod, **aucun changement
backend** n'est nécessaire (le contrat MQTT est générique). Seul le
firmware ESP32 doit pointer vers la bonne adresse/port/credentials TLS, et
le device correspondant doit exister en base PostgreSQL.

---

## 6. Application mobile (rappel — déjà OK)

Comme indiqué, pas de souci côté frontend. Juste :
- `EXPO_PUBLIC_API_URL=https://votre-domaine.com` (ou `wss://` selon le
  client Socket.io — Socket.io négocie HTTP(S)/WS(S) sur la même URL).
- `EXPO_PUBLIC_USE_MOCKS=false`.
- Build EAS (Expo) pour générer l'APK/IPA de démo si besoin d'une
  installation sur téléphone.

---

## 7. Sécurisation avant mise en ligne — checklist

À faire (configuration uniquement, déjà prévu par le `.env` actuel) :

| Élément | Action |
|---|---|
| `JWT_SECRET` / `REFRESH_SECRET` | Générer des secrets aléatoires longs (ex. `openssl rand -hex 32`), différents de `gilles`/`000000`. |
| `SEED_ADMIN_PASSWORD` | Mot de passe fort, à changer après le premier login. |
| `DATABASE_URL` | Utilisateur PostgreSQL dédié, pas `postgres`/`1234`. |
| `CORS_ORIGINS` | Restreindre aux domaines réels de l'app mobile/web (déjà supporté dans [main.ts](../powerlens-backend/src/main.ts)). |
| HTTPS/WSS | Reverse proxy (Nginx/Caddy) devant NestJS avec certificat Let's Encrypt → `https://` et `wss://` automatiques. |
| `SIMULATOR_ENABLED` | Mettre à `false` une fois les vrais ESP32 connectés (sinon données fictives mélangées aux vraies). |

Action future (modification de code minime, à prévoir mais hors scope
actuel) :
- Ajouter `username`/`password`/TLS options dans `mqttConfig` pour
  sécuriser la connexion au broker (actuellement aucune auth MQTT).

---

## 8. Plan de présentation "prod" suggéré

1. **Schéma d'architecture** : reprendre le schéma §1 en remplaçant
   "Raspberry Pi" par "VPS (Hetzner/OVH)" et montrer Mosquitto + PostgreSQL
   + NestJS côte à côte sur la même machine.
2. **Démo en ligne** :
   - VPS avec Mosquitto (TLS), PostgreSQL, et `npm run start:prod`
     (NestJS) derrière Nginx + domaine HTTPS.
   - App mobile (Expo Go ou build EAS) pointant sur `https://domaine.com`.
   - Simulateur activé pour montrer le flux temps réel sans ESP32
     physique.
3. **Volet "branchement ESP32 réel"** : expliquer (slide) que le firmware
   ESP32 n'a besoin que de 4 paramètres pour passer du dev au prod :
   broker host, port TLS, credentials MQTT, et `buildingId`/`deviceId`
   existants en base — le reste du contrat (topics, JSON) ne change pas.
4. **Coût estimé** : VPS ~5€/mois, domaine ~10€/an, certificats Let's
   Encrypt gratuits → total < 10€/mois pour un environnement de prod
   complet.
5. **Roadmap post-démo** (mentionner sans implémenter) : auth MQTT/TLS,
   sauvegardes PostgreSQL automatiques, monitoring (logs Winston déjà en
   place → brancher sur un agrégateur type Grafana Loki).
