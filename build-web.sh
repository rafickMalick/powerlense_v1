#!/usr/bin/env bash
# =============================================================================
# Build web unifié pour Vercel — un seul domaine, deux applications :
#
#   /        → landing page marketing (statique, landing/)
#   /app     → application PowerLens (Expo export, powerlens-mobile/)
#
# Astuce clé : l'export Expo référence ses ressources en chemins ABSOLUS
# (/_expo/static/...). On peut donc déplacer son index.html sous /app/ tout en
# laissant _expo/ à la racine : les chemins continuent de résoudre, aucune
# reconfiguration de "base path" n'est nécessaire.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/dist"

echo "▶ Nettoyage"
rm -rf "$OUT" "$ROOT/powerlens-mobile/dist"

echo "▶ Build de l'application (Expo web)"
cd "$ROOT/powerlens-mobile"
npm run build:web

echo "▶ Assemblage de la sortie"
mkdir -p "$OUT"
cp -r "$ROOT/powerlens-mobile/dist/." "$OUT/"

# L'app passe sous /app ; ses ressources (_expo, assets) restent à la racine.
mkdir -p "$OUT/app"
mv "$OUT/index.html" "$OUT/app/index.html"

# La landing prend la racine (son index.html + ses images).
cp -r "$ROOT/landing/." "$OUT/"

echo "▶ Vérification"
test -f "$OUT/index.html"      || { echo "✗ landing/index.html manquant"; exit 1; }
test -f "$OUT/app/index.html"  || { echo "✗ app/index.html manquant"; exit 1; }
test -d "$OUT/_expo"           || { echo "✗ ressources _expo manquantes"; exit 1; }
test -f "$OUT/assets/powerlens-mark.png" || { echo "✗ images de la landing manquantes"; exit 1; }

echo "✔ Build terminé :"
echo "   /      → landing ($(du -h "$OUT/index.html" | cut -f1))"
echo "   /app   → application"
