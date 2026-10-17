# Midify (Android)

Spotify-style MIDI/RMI player. Capacitor + SpessaSynth.

## Get the APK (no Android Studio needed)
1. Create a GitHub repo and push this folder to it.
2. Open the Actions tab, run "Build APK" (it also runs on every push).
3. Download the `Midify-debug-apk` artifact, unzip, install `app-debug.apk`.

## Local build
npm install && npm run build && npx cap add android && npx cap sync android
Then add the permissions from .github/workflows/build.yml to AndroidManifest.xml and build in Android Studio.

## First run
- Settings > Choose soundfont (needed for plain MIDI; RMI files carry their own).
- Settings > Override RMI soundfont forces your soundfont over the embedded one.
- Open folder: browse storage. Android requires "All files access" for Midify (App info > Permissions). Otherwise use "Pick files".
