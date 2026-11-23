#!/usr/bin/env bash
# Met en ligne Flâne sur GitHub Pages : tests, construction, puis dist/ envoyé sur la branche gh-pages.
# Usage : npm run deploy
set -euo pipefail
cd "$(dirname "$0")/.."

npm test
npm run build

ORIGIN=$(git remote get-url origin)
NAME=$(git config user.name)
EMAIL=$(git config user.email)
SHA=$(git rev-parse --short HEAD)

cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git config user.name "$NAME"
git config user.email "$EMAIL"
git add -A
git commit -q -m "Mise en ligne de $SHA"
git push -q -f "$ORIGIN" gh-pages
rm -rf .git
echo "Envoyé. En ligne d'ici une minute : https://neutreph.github.io/flane/"
