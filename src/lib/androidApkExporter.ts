import type { CaptureProject } from '../types/capture';
import { downloadBlob } from './storage';

interface ZipEntry {
  path: string;
  content: string;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipBlob(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const dataBytes = encoder.encode(entry.content);
    const checksum = crc32(dataBytes);

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // Local header signature
    lv.setUint16(4, 20, true); // Version needed to extract
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method: 0 (store)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0x5821, true); // Mod date
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, dataBytes.length, true);
    lv.setUint32(22, dataBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // Central dir signature
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Store
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5821, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, dataBytes.length, true);
    cv.setUint32(24, dataBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);

  // End of Central Directory (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const blobParts: BlobPart[] = [
    ...localParts.map((u) => new Uint8Array(u)),
    ...centralParts.map((u) => new Uint8Array(u)),
    new Uint8Array(eocd),
  ];

  return new Blob(blobParts, { type: 'application/zip' });
}

export interface ApkExportOptions {
  appUrl: string;
  packageId: string;
  appName: string;
  versionName: string;
  versionCode: number;
  minSdk: number;
  project: CaptureProject;
}

export function buildAndDownloadAndroidApkProject(opts: ApkExportOptions): string {
  const safePkg = opts.packageId.replace(/[^a-zA-Z0-9.]/g, '').toLowerCase() || 'com.kaptureotg.studio';
  const pkgPath = safePkg.replace(/\./g, '/');
  const originHost = (() => {
    try {
      return new URL(opts.appUrl).host;
    } catch {
      return 'kaptureotg.app';
    }
  })();

  const entries: ZipEntry[] = [
    {
      path: 'README-BUILD-APK.md',
      content: `# ${opts.appName} — Paket Proyek APK Android (Android 7.0 – 14+)

Paket ini berisi proyek Android lengkap yang sudah dikonfigurasi khusus untuk:
- **Android 10 ke bawah (minSdk ${opts.minSdk} / Android 7.0 Nougat)** dengan kabel **Micro-USB OTG**
- **Deteksi otomatis USB Video Capture (UVC Class 14)** melalui \`device_filter.xml\`
- **Akses Kartu SD Eksternal** (\`requestLegacyExternalStorage="true"\` untuk Android 10 ke bawah + SAF untuk Android 11+)
- **Auto-izin Kamera & Mikrofon USB** pada WebView Android (\`MainActivity.java\`)
- **Mode Offline & Layar Penuh** terhubung ke aplikasi studio \`${opts.appUrl}\`

---

## Cara 1: Build APK Otomatis Tanpa Install Android Studio (GitHub Actions)
1. Ekstrak file ZIP ini dan unggah ke repositori GitHub baru.
2. Buka tab **Actions** di GitHub, lalu jalankan workflow **Build KaptureOTG Android APK**.
3. Setelah selesai (~2 menit), unduh file **KaptureOTG-debug.apk** dari bagian **Artifacts** dan pasang langsung ke HP Android Anda.

## Cara 2: Build APK Lokal dengan Android Studio / Gradle
1. Pastikan **JDK 17** dan **Android Studio (SDK 34)** sudah terpasang.
2. Buka folder ini di **Android Studio** (atau jalankan lewat terminal):
   \`\`\`bash
   cd android
   ./gradlew assembleDebug
   \`\`\`
3. File APK hasil build akan muncul di:
   \`android/app/build/outputs/apk/debug/app-debug.apk\`

## Cara 3: Build TWA APK via Bubblewrap CLI
\`\`\`bash
npx @bubblewrap/cli build
\`\`\`
`,
    },
    {
      path: 'capacitor.config.json',
      content: JSON.stringify(
        {
          appId: safePkg,
          appName: opts.appName,
          webDir: 'dist',
          server: {
            url: opts.appUrl,
            cleartext: false,
            androidScheme: 'https',
          },
          android: {
            allowMixedContent: false,
            captureInput: true,
            webContentsDebuggingEnabled: false,
          },
        },
        null,
        2
      ),
    },
    {
      path: 'twa-manifest.json',
      content: JSON.stringify(
        {
          packageId: safePkg,
          host: originHost,
          name: opts.appName,
          launcherName: 'KaptureOTG',
          display: 'standalone',
          themeColor: '#090B0E',
          navigationColor: '#090B0E',
          backgroundColor: '#090B0E',
          enableNotifications: false,
          startUrl: '/',
          iconUrl: `${opts.appUrl.replace(/\/$/, '')}/pwa-512x512.png`,
          maskableIconUrl: `${opts.appUrl.replace(/\/$/, '')}/pwa-maskable-512x512.png`,
          splashScreenFadeOutDuration: 250,
          appVersionName: opts.versionName,
          appVersionCode: opts.versionCode,
          minSdkVersion: opts.minSdk,
          fallbackType: 'customtabs',
          orientation: 'default',
        },
        null,
        2
      ),
    },
    {
      path: 'capture-preset.json',
      content: JSON.stringify(
        {
          projectName: opts.project.name,
          deviceProfile: opts.project.deviceProfile,
          resolution: `${opts.project.resolutionWidth}x${opts.project.resolutionHeight}`,
          fps: opts.project.fps,
          format: opts.project.format,
          videoBitrateMbps: opts.project.videoBitrateMbps,
          audioBitrateKbps: opts.project.audioBitrateKbps,
          audioSyncMs: opts.project.audioSyncMs,
          rotation: opts.project.rotation,
          cropAspect: opts.project.cropAspect,
          sdStoragePath: opts.project.sdStoragePath,
          sdSplitGb: opts.project.sdSplitGb,
          watermarkFree: true,
        },
        null,
        2
      ),
    },
    {
      path: 'android/settings.gradle',
      content: `pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "KaptureOTG"
include ':app'
`,
    },
    {
      path: 'android/build.gradle',
      content: `plugins {
    id 'com.android.application' version '8.5.2' apply false
}
`,
    },
    {
      path: 'android/gradle.properties',
      content: `org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.enableJetifier=true
`,
    },
    {
      path: 'android/app/build.gradle',
      content: `plugins {
    id 'com.android.application'
}

android {
    namespace '${safePkg}'
    compileSdk 34

    defaultConfig {
        applicationId '${safePkg}'
        minSdk ${opts.minSdk}
        targetSdk 34
        versionCode ${opts.versionCode}
        versionName '${opts.versionName}'
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }
}

dependencies {
    implementation 'androidx.appcompat:appcompat:1.7.0'
    implementation 'androidx.webkit:webkit:1.11.0'
}
`,
    },
    {
      path: 'android/app/src/main/AndroidManifest.xml',
      content: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />

    <!-- Android 10 & below external SD card direct storage permissions -->
    <uses-permission
        android:name="android.permission.READ_EXTERNAL_STORAGE"
        android:maxSdkVersion="32" />
    <uses-permission
        android:name="android.permission.WRITE_EXTERNAL_STORAGE"
        android:maxSdkVersion="29" />

    <!-- USB Host OTG (Micro-USB 2.0 & USB-C UVC Capture Cards) -->
    <uses-feature android:name="android.hardware.usb.host" android:required="false" />
    <uses-feature android:name="android.hardware.camera" android:required="false" />

    <application
        android:allowBackup="true"
        android:hardwareAccelerated="true"
        android:label="${opts.appName}"
        android:requestLegacyExternalStorage="true"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.DayNight.NoActionBar">

        <activity
            android:name=".MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|smallestScreenSize|locale|layoutDirection|fontScale|screenLayout|density|uiMode"
            android:exported="true"
            android:launchMode="singleTask">

            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

            <intent-filter>
                <action android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" />
            </intent-filter>

            <meta-data
                android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED"
                android:resource="@xml/device_filter" />
        </activity>
    </application>
</manifest>
`,
    },
    {
      path: 'android/app/src/main/res/xml/device_filter.xml',
      content: `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- USB Video Class (UVC) — Micro-USB & USB-C HDMI/AV Video Capture Devices -->
    <usb-device class="14" subclass="1" />
    <usb-device class="14" subclass="2" />
    <!-- MacroSilicon MS2109 / MS2130 HDMI-to-USB Capture Cards -->
    <usb-device vendor-id="21325" />
    <!-- Miscellaneous IAD Composite UVC + UAC Devices -->
    <usb-device class="239" subclass="2" protocol="1" />
</resources>
`,
    },
    {
      path: `android/app/src/main/java/${pkgPath}/MainActivity.java`,
      content: `package ${safePkg};

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final String APP_URL = "${opts.appUrl}";
    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#090B0E"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#090B0E"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        requestRuntimePermissions();
        webView.loadUrl(APP_URL);
    }

    private void requestRuntimePermissions() {
        List<String> needed = new ArrayList<>();
        String[] basePerms = new String[] {
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        };
        for (String perm : basePerms) {
            if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
                needed.add(perm);
            }
        }
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE)
                    != PackageManager.PERMISSION_GRANTED) {
                needed.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
            }
        }
        if (!needed.isEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                needed.toArray(new String[0]),
                PERMISSION_REQUEST_CODE
            );
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE && webView != null) {
            webView.reload();
        }
    }
}
`,
    },
    {
      path: '.github/workflows/build-apk.yml',
      content: `name: Build KaptureOTG Android APK

on:
  workflow_dispatch:
  push:
    branches: [ main, master ]

jobs:
  build-apk:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Build Debug APK
        working-directory: android
        run: gradle assembleDebug

      - name: Upload KaptureOTG APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: KaptureOTG-Android-APK
          path: android/app/build/outputs/apk/debug/app-debug.apk
`,
    },
  ];

  const filename = `KaptureOTG-Android-APK-Project-v${opts.versionName}.zip`;
  const zipBlob = createZipBlob(entries);
  downloadBlob(zipBlob, filename);
  return filename;
}
