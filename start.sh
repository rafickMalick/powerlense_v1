#!/usr/bin/env bash
# =============================================================================
# PowerLens — script de lancement local
# Démarre : PostgreSQL (Docker, port 5434) + Mosquitto (Docker, 1883)
#           + backend NestJS (:3000) + front Expo web (:8081)
#
# Usage :
#   ./start.sh            # lance tout (n'écrase pas les données existantes)
#   ./start.sh --seed     # force le (re)seed de la base  ⚠️ régénère les UUID
#   ./start.sh --no-front # infra + backend seulement
#
# ⚠️ Par défaut, le seed n'est exécuté QUE si la base est vide, pour ne pas
#    casser l'alignement des IDs codés en dur dans le firmware ESP32.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND="$ROOT/powerlens-backend"
MOBILE="$ROOT/powerlens-mobile"

PG_CONTAINER="powerlens-postgres"
MQTT_CONTAINER="powerlens-mqtt"
PG_PORT=5434
MQTT_PORT=1883
PG_USER="powerlens"; PG_PASS="powerlens"; PG_DB="powerlens"
MOSQ_CONF="$ROOT/mosquitto.conf"

FORCE_SEED=0; RUN_FRONT=1
for arg in "$@"; do
  case "$arg" in
    --seed)     FORCE_SEED=1 ;;
    --no-front) RUN_FRONT=0 ;;
    *) echo "Option inconnue : $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "Docker est requis mais introuvable."

# ─── Nettoyage à la sortie (Ctrl+C) : arrête le backend lancé en arrière-plan ──
BACKEND_PID=""
cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    log "Arrêt du backend (PID $BACKEND_PID)…"
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ─── 1. Conteneurs Docker (Postgres + Mosquitto) ─────────────────────────────
ensure_postgres() {
  if docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    ok "PostgreSQL déjà démarré ($PG_CONTAINER)"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    docker start "$PG_CONTAINER" >/dev/null && ok "PostgreSQL redémarré"
  else
    log "Création du conteneur PostgreSQL (port $PG_PORT)…"
    docker run -d --name "$PG_CONTAINER" -p "$PG_PORT:5432" \
      -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB="$PG_DB" \
      postgres:16 >/dev/null && ok "PostgreSQL créé"
  fi
}

ensure_mqtt() {
  if [[ ! -f "$MOSQ_CONF" ]]; then
    printf 'listener %s 0.0.0.0\nallow_anonymous true\n' "$MQTT_PORT" > "$MOSQ_CONF"
  fi
  if docker ps --format '{{.Names}}' | grep -qx "$MQTT_CONTAINER"; then
    ok "Mosquitto déjà démarré ($MQTT_CONTAINER)"
  elif docker ps -a --format '{{.Names}}' | grep -qx "$MQTT_CONTAINER"; then
    docker start "$MQTT_CONTAINER" >/dev/null && ok "Mosquitto redémarré"
  else
    log "Création du conteneur Mosquitto (port $MQTT_PORT)…"
    docker run -d --name "$MQTT_CONTAINER" -p "$MQTT_PORT:1883" \
      -v "$MOSQ_CONF:/mosquitto/config/mosquitto.conf" \
      eclipse-mosquitto >/dev/null && ok "Mosquitto créé"
  fi
}

log "1/4 — Infrastructure Docker"
ensure_postgres
ensure_mqtt

log "Attente que PostgreSQL soit prêt…"
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U "$PG_USER" >/dev/null 2>&1; then
    ok "PostgreSQL prêt"; break
  fi
  [[ $i -eq 30 ]] && die "PostgreSQL n'a pas démarré à temps."
  sleep 1
done

# ─── 2. Backend : dépendances, Prisma, seed conditionnel ─────────────────────
log "2/4 — Backend NestJS"
cd "$BACKEND"
[[ -d node_modules ]] || { log "npm install (backend)…"; npm install; }

# JWT_SECRET requis au bootstrap — on l'ajoute s'il manque
if ! grep -q '^JWT_SECRET=' .env 2>/dev/null; then
  warn "JWT_SECRET absent du .env — ajout d'une valeur de dev."
  printf '\nJWT_SECRET=powerlens-dev-secret-change-me\n' >> .env
fi

npx prisma generate >/dev/null && ok "Client Prisma généré"
npx prisma migrate deploy >/dev/null && ok "Migrations appliquées"

# Seed : uniquement si base vide, sauf --seed explicite
DEVICE_COUNT="$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  'SELECT count(*) FROM "Device";' 2>/dev/null | tr -d '[:space:]' || echo 0)"
if [[ "$FORCE_SEED" -eq 1 ]]; then
  warn "Re-seed forcé (--seed) : les UUID vont changer → réaligner le firmware ESP !"
  npm run prisma:seed
elif [[ "${DEVICE_COUNT:-0}" == "0" ]]; then
  log "Base vide → seed initial…"
  npm run prisma:seed
else
  ok "Base déjà peuplée ($DEVICE_COUNT device[s]) → seed ignoré (préserve l'alignement ESP)"
fi

log "Démarrage du backend (logs → backend.log)…"
npm run start:dev > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!

# Attente du démarrage effectif
for i in $(seq 1 45); do
  if grep -qE "Application is running|Nest application successfully started" "$ROOT/backend.log" 2>/dev/null; then
    ok "Backend démarré sur http://localhost:3000"; break
  fi
  if grep -qE "JWT_SECRET is not defined|EADDRINUSE|ExceptionHandler" "$ROOT/backend.log" 2>/dev/null; then
    die "Le backend a échoué au démarrage — voir backend.log"
  fi
  [[ $i -eq 45 ]] && die "Backend trop long à démarrer — voir backend.log"
  sleep 2
done

# ─── 3. Infos réseau (accès depuis un autre appareil / ESP32) ────────────────
LAN_IP="$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}' || true)"
log "3/4 — Récapitulatif"
echo "   • API           : http://localhost:3000"
echo "   • Front (web)    : http://localhost:8081"
[[ -n "$LAN_IP" ]] && echo "   • IP LAN du PC   : $LAN_IP  (→ MQTT_HOST de l'ESP + accès depuis le téléphone)"
echo "   • Login démo     : admin@powerlens.local / admin123"
echo "   • MQTT broker    : localhost:$MQTT_PORT (anonyme)"

# ─── 4. Frontend (au premier plan ; Ctrl+C arrête backend + front) ───────────
if [[ "$RUN_FRONT" -eq 1 ]]; then
  log "4/4 — Frontend Expo web (Ctrl+C pour tout arrêter)"
  cd "$MOBILE"
  [[ -d node_modules ]] || { log "npm install (mobile)…"; npm install; }
  npm run web
else
  ok "Backend en cours (PID $BACKEND_PID). Ctrl+C pour l'arrêter."
  wait "$BACKEND_PID"
fi
