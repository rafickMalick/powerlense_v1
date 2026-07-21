# Déploiement PowerLens — Vercel + Render (Phase 1)

> **Phase 1** = mettre l'application en ligne (front + backend + base).
> L'ESP32 continue pendant ce temps de parler à ton **broker local** via le
> tunnel (`ssh -p 443 -R0:localhost:1883 tcp@a.pinggy.io`).
> La **Phase 2** (broker MQTT cloud + TLS sur le firmware) est décrite en fin de
> document — elle n'est **pas** couverte ici.

## Architecture cible

| Composant | Hébergeur | Pourquoi |
|---|---|---|
| App web (Expo) | **Vercel** | Export statique — idéal pour Vercel |
| Backend NestJS | **Render** (Web Service) | Process **toujours actif** requis (MQTT persistant + WebSocket) |
| PostgreSQL | **Render** (managed, plan gratuit) | Au plus près du backend |
| Broker MQTT | ❌ **ni Vercel ni Render** | Render n'expose que du HTTP → voir Phase 2 |

> ⚠️ **Vercel ne peut pas héberger le backend** : il est *serverless* (fonctions
> à la demande), alors que PowerLens maintient une connexion MQTT permanente et
> des WebSockets. Il faut un service qui tourne en continu → Render.

---

## 1. Base de données (Render PostgreSQL)

1. Render → **New +** → **PostgreSQL**.
2. Name : `powerlens-db` · Plan : **Free** · Region : la plus proche (ex. Frankfurt).
3. Une fois créée, copie l'**Internal Database URL** (commence par `postgresql://`).

> ⚠️ Plan gratuit : la base **expire au bout de ~90 jours** et le service se met
> en veille après inactivité (première requête lente). Suffisant pour une démo,
> pas pour du permanent.

## 2. Backend (Render Web Service)

1. Render → **New +** → **Web Service** → connecte le dépôt GitHub `powerlense_v1`.
2. **Root Directory** : `powerlens-backend`
3. **Runtime** : Node
4. **Build Command** :
   ```
   npm install && npx prisma generate && npm run build && npx prisma migrate deploy && npx prisma db seed
   ```
   > Les migrations **et** le seed tournent à l'étape *build* : c'est le seul
   > moment où les `devDependencies` (dont `ts-node`, requis par le seed) sont
   > disponibles. Les deux sont **idempotents** — relançables sans risque.
5. **Start Command** :
   ```
   npm run start:prod
   ```
6. **Environment Variables** :

| Variable | Valeur | Note |
|---|---|---|
| `DATABASE_URL` | *Internal Database URL* de l'étape 1 | |
| `JWT_SECRET` | une longue chaîne aléatoire | **ne pas réutiliser celle de dev** |
| `CORS_ORIGINS` | `https://<ton-app>.vercel.app` | à compléter après l'étape 3 |
| `SEED_ADMIN_PASSWORD` | mot de passe admin | sinon `admin123` par défaut |
| `MQTT_BROKER_URL` | *(voir note)* | Phase 1 : laisser vide ou pointer un broker joignable |
| `PORT` | *(automatique)* | Render l'injecte, le code le lit déjà |

> **MQTT en Phase 1** : sans broker joignable, le backend démarre quand même
> (il retente la connexion en boucle sans planter) — l'app fonctionne, seules
> les données temps réel des boîtiers manquent. C'est attendu.

## 3. Frontend (Vercel)

1. Vercel → **Add New** → **Project** → importe `powerlense_v1`.
2. **Root Directory** : `powerlens-mobile`
3. Le fichier [`vercel.json`](../powerlens-mobile/vercel.json) fournit déjà
   *build command*, *output directory* et la réécriture SPA — rien à saisir.
4. **Environment Variables** :

| Variable | Valeur |
|---|---|
| `EXPO_PUBLIC_API_URL` | `https://<ton-backend>.onrender.com` |
| `EXPO_PUBLIC_USE_MOCKS` | `false` |

> ⚠️ `EXPO_PUBLIC_*` est **figé au moment du build**. Si tu changes l'URL du
> backend, il faut **redéployer** le front (un simple redémarrage ne suffit pas).

## 4. Boucler la configuration

Une fois l'URL Vercel connue, **reviens sur Render** et mets `CORS_ORIGINS` à
`https://<ton-app>.vercel.app`, puis redéploie le backend. Sans ça le navigateur
bloquera les appels API (erreur CORS).

## 5. Vérifications après déploiement

```bash
# 1. Le backend répond et l'admin existe
curl -X POST https://<backend>.onrender.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@powerlens.local","password":"<SEED_ADMIN_PASSWORD>"}'
# → doit renvoyer un access_token

# 2. Le front charge
curl -I https://<ton-app>.vercel.app     # → 200
```

Puis connecte-toi sur l'URL Vercel : tu dois arriver sur le tableau de bord avec
le **« Bâtiment par défaut »** sélectionné automatiquement.

---

## Phase 2 (non couverte ici) — brancher l'ESP en production

Pour que les boîtiers atteignent le backend en ligne, il faut un **broker MQTT
cloud** (HiveMQ Cloud gratuit, EMQX…), car Render n'expose pas de port TCP.
Travail restant :

| Élément | État |
|---|---|
| Backend : identifiants MQTT | ✅ **déjà prêt** (`MQTT_USERNAME` / `MQTT_PASSWORD`) |
| Backend : URL `mqtts://…:8883` | ✅ déjà supporté (`MQTT_BROKER_URL`) |
| **Firmware : TLS + authentification** | ❌ **à faire** — aujourd'hui `mqtt://` en clair, sans auth |
| Firmware : champs user/password dans le portail | ❌ à faire |

C'est le seul vrai développement restant ; la migration vers `esp-mqtt` (client
natif ESP-IDF) a justement été faite pour rendre ce TLS possible.
