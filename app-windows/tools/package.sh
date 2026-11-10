#!/bin/bash
# Builds rJuke for Windows (x64) and creates the zip. Usage: tools/package.sh  (from the app-windows folder)
set -euo pipefail
V=$(node -p "require('./package.json').version")
rm -rf dist && mkdir -p dist
npx electron-packager . rJuke --platform=win32 --arch=x64 --out=dist --asar --overwrite \
  --icon=assets/icon.ico --app-version="$V" --app-copyright="© 2026 ruoccoS" \
  --win32metadata.CompanyName="ruoccoS" --win32metadata.FileDescription="rJuke" \
  --win32metadata.ProductName="rJuke" --win32metadata.OriginalFilename="rJuke.exe" \
  --ignore='^/tools' --ignore='^/dist' --ignore='^/\.' --ignore='^/LEGGIMI' --ignore='^/README'
cd dist
mv rJuke-win32-x64 rJuke
find rJuke/locales -name "*.pak" ! -name "it.pak" ! -name "en-US.pak" ! -name "en-GB.pak" -delete
for f in README LEGGIMI; do sed "s/{{VERSION}}/$V/" ../$f.txt | sed 's/$/\r/' > rJuke/$f.txt; done
zip -qr -9 "rJuke-$V-Windows.zip" rJuke
echo "dist/rJuke-$V-Windows.zip"
