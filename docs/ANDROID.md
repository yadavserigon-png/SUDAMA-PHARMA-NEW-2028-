# Android app (Capacitor) and Play Store

The Android app is the same React website packaged with Capacitor, so web and app always share the **same backend and database**.

## Two options

1. **PWA (no Play Store needed)** – already built in. On Android Chrome, open the website → menu → *Install app*. Works offline for the app shell; requires HTTPS.
2. **Play Store app (Capacitor)** – steps below.

## Prerequisites (Windows)

- Android Studio (latest) with Android SDK and an emulator or a phone with USB debugging
- JDK 17 (bundled with Android Studio)
- The website deployed with HTTPS and `frontend/.env` containing `VITE_API_URL=https://<your-api-domain>`
- On the API, add the app origins to `CORS_ORIGIN`: `https://localhost,capacitor://localhost` in addition to your website domain

## Build

```powershell
Set-Location C:\Projects\sudama-pharma-platform\frontend
npm install
npm run build
npx cap add android          # first time only - creates frontend\android
npx cap sync android         # after every web change: npm run android:sync
npx cap open android         # opens Android Studio
```

In Android Studio: wait for Gradle sync → **Run** on a device to test.

## Permissions (android/app/src/main/AndroidManifest.xml)

Add only what the app uses:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />                 <!-- barcode + prescription photos -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />  <!-- delivery partners, store finder -->
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Location is requested only in the delivery app and is sent only while a delivery is picked up / out for delivery. Do **not** add background-location permission unless you build and justify a background tracking feature (Play policy requires a separate declaration).

## App icon and name

- App id `in.sudamapharma.app`, name "Sudama Pharma" (`frontend/capacitor.config.json`). Change the id before the first upload if you prefer another – it cannot change later.
- Generate launcher icons in Android Studio: right-click `res` → New → Image Asset → use `frontend/public/icons/icon-512.png`.

## Signing

```powershell
keytool -genkey -v -keystore sudama-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sudama
```

Keep `sudama-release.jks` and its passwords private and backed up (outside the Git repository). In Android Studio: **Build → Generate Signed App Bundle → Android App Bundle (.aab)** → choose the keystore → release. Enrol in **Play App Signing** when uploading.

## Play Store submission checklist

- [ ] Google Play Console developer account (one-time fee) in the name of Sudama Private Limited (organisation account needs D-U-N-S number)
- [ ] App category: Medical / Health & Fitness; content rating questionnaire
- [ ] **Privacy policy URL** (publish the policy from Admin → Settings → Policies at `/policies`)
- [ ] **Data safety form**: name, phone, email, address, precise location (delivery partners), photos (prescriptions), purchase history, payment info handled by PhonePe; data encrypted in transit; account deletion process (provide a support route)
- [ ] Health apps declaration and, for online pharmacy, Google Play's requirements for prescription-drug apps in India (licence documents may be requested)
- [ ] Screenshots (phone + 7"/10" tablet), feature graphic 1024×500, short and full description in English (and Hindi if you add it)
- [ ] Internal testing track → closed testing (new personal accounts must run a closed test with testers for a minimum period before production) → production
- [ ] Target the API level Google currently requires (Android Studio warns you)

The app is **not published** until Google approves it in the Play Console. Do not announce it as available on the Play Store before that.
