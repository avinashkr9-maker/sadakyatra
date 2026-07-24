#!/usr/bin/env bash
# SadakYatra Android app — Expo SDK 54 alignment fix
# Run this from inside the `app/` folder:  bash fix-app.sh
set -e

echo "==> 0. Sanity check"
if [ ! -f "App.js" ] || [ ! -f "app.json" ]; then
  echo "ERROR: yeh script app/ folder ke andar se chalao (App.js yahin hona chahiye)."
  exit 1
fi

echo "==> 1. Junk files hatao"
rm -f "expo" "sadakyatra-android-app@0.1.0"

echo "==> 2. Purana install saaf karo"
rm -rf node_modules package-lock.json .expo

echo "==> 3. NOTE: naya package.json pehle se replace kar chuke ho na? (expo ~54 / react 19.1.0 / react-native 0.81.4)"
grep -q '"react-native": "0.81' package.json || {
  echo "ERROR: package.json abhi purana hai. Pehle diya hua package.json copy karo, phir dubara chalao."
  exit 1
}

echo "==> 4. Core install"
npm install

echo "==> 5. SDK 54 ke correct versions ke saath baaki packages"
npx expo install \
  expo-constants \
  expo-linear-gradient \
  expo-location \
  expo-status-bar \
  react-native-maps \
  react-native-svg \
  lucide-react-native

echo "==> 6. Doctor check"
npx expo-doctor || echo "(doctor ne kuch flag kiya — upar padho, par aage badh sakte ho)"

echo "==> 7. Native android folder dobara generate karo"
rm -rf android
npx expo prebuild --clean -p android

echo "==> 8. Dev build banao aur device/emulator pe install karo"
npx expo run:android

echo ""
echo "DONE. Ab se roz ke development ke liye sirf: npx expo start --dev-client"
