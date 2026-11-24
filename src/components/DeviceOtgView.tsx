import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  HardDrive,
  Monitor,
  Moon,
  Package,
  RefreshCw,
  Smartphone,
  Sun,
  Usb,
} from 'lucide-react';
import {
  formatFileSize,
  type CaptureProject,
  type DeviceProfile,
  type ThemeMode,
} from '../types/capture';
import { downloadBlob, getStorageQuota, type StorageQuotaInfo } from '../lib/storage';
import { buildAndDownloadAndroidApkProject } from '../lib/androidApkExporter';
import { PWAInstallButton } from './PWAInstallButton';
import { useUsbOtgDetector } from '../hooks/useUsbOtgDetector';

interface DeviceOtgViewProps {
  activeProject: CaptureProject;
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  onChangeThemeMode: (mode: ThemeMode) => void;
  onChangeProfile: (profile: DeviceProfile) => void;
}

interface DiagnosticItem {
  id: string;
  label: string;
  detail: string;
  checked: boolean;
}

export function DeviceOtgView({
  activeProject,
  themeMode,
  resolvedTheme,
  onChangeThemeMode,
  onChangeProfile,
}: DeviceOtgViewProps) {
  const {
    videoDevices,
    audioDevices,
    usbHardwareList,
    usbPermissionError,
    isScanning,
    scanDevices,
    requestWebUsbOtgDevice,
  } = useUsbOtgDetector();
  const [quota, setQuota] = useState<StorageQuotaInfo>({
    usageBytes: 0,
    quotaBytes: 0,
    supported: false,
  });
  const [apkPackageId, setApkPackageId] = useState<string>('com.m2rstudio.capture');
  const [apkAppName, setApkAppName] = useState<string>('M2R Studio');
  const [apkVersion, setApkVersion] = useState<string>('1.0.0');
  const [apkMinSdk, setApkMinSdk] = useState<number>(24);
  const [apkNotice, setApkNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([
    {
      id: 'otg_cable',
      label: 'Kabel Micro-USB OTG Data Aktif (Bukan Kabel Charging)',
      detail:
        'Pastikan adaptor Micro-USB ke USB-A mendukung pin ID OTG (Android 7.0 – 10.0) agar capture card UVC terdeteksi.',
      checked: true,
    },
    {
      id: 'usb2_bandwidth',
      label: 'Limit Bandwidth USB 2.0 (480 Mbps) — Mode MJPEG Latensi Rendah',
      detail:
        'Untuk chipset MacroSilicon MS2109 / USB 2.0, aktifkan profil Android 10 agar frame tetap stabil 60fps tanpa drop.',
      checked: true,
    },
    {
      id: 'sd_fat32',
      label: 'Kartu SD Eksternal FAT32 / exFAT dengan Auto-Split 4 GB',
      detail:
        'Perangkat Android 10 ke bawah umumnya memformat kartu SD sebagai FAT32 (batas 4 GB per file). Auto-split mencegah file korup.',
      checked: true,
    },
    {
      id: 'power_budget',
      label: 'Suplai Daya OTG Stabil (Disarankan OTG Y-Cable untuk Kamera 4K)',
      detail:
        'Capture card HDMI menarik 250–450 mA dari port Micro-USB. Gunakan OTG berdaya eksternal untuk sesi rekaman panjang.',
      checked: false,
    },
  ]);

  const refreshHardwareInfo = async () => {
    await scanDevices();
    const q = await getStorageQuota();
    setQuota(q);
  };

  useEffect(() => {
    void getStorageQuota().then(setQuota);
  }, []);

  const toggleDiagnostic = (id: string) => {
    setDiagnostics((prev) =>
      prev.map((item) => (item.id === id ? { ...item, checked: !item.checked } : item))
    );
  };

  const exportAndroidOtgProfileJson = () => {
    const configPayload = {
      app: 'M2R Studio',
      exportedAt: new Date().toISOString(),
      targetAndroidMinSdk: 24,
      targetAndroidLegacyCompat: activeProject.deviceProfile === 'android10_micro_usb',
      usbTransport:
        activeProject.deviceProfile === 'android10_micro_usb'
          ? {
              interface: 'Micro-USB 2.0 OTG',
              uvcPixelFormat: 'MJPEG',
              maxBandwidthMbps: 480,
              isochronousBufferPackets: 16,
              zeroCopySurfaceTexture: true,
            }
          : {
              interface: 'USB-C 3.0 UVC',
              uvcPixelFormat: 'NV12/YUY2',
              maxBandwidthMbps: 5000,
              isochronousBufferPackets: 32,
              zeroCopySurfaceTexture: true,
            },
      storage: {
        directSdCardPath: activeProject.sdStoragePath,
        androidSafDocumentTree: true,
        fat32AutoSplitGb: activeProject.sdSplitGb,
      },
      capturePipeline: {
        resolution: `${activeProject.resolutionWidth}x${activeProject.resolutionHeight}`,
        fps: activeProject.fps,
        container: activeProject.format,
        videoBitrateMbps: activeProject.videoBitrateMbps,
        audioBitrateKbps: activeProject.audioBitrateKbps,
        audioSyncOffsetMs: activeProject.audioSyncMs,
        realtimeRotationDeg: activeProject.rotation,
        crop: {
          aspect: activeProject.cropAspect,
          xPct: activeProject.cropX,
          yPct: activeProject.cropY,
          wPct: activeProject.cropW,
          hPct: activeProject.cropH,
        },
        watermarkFree: true,
      },
    };
    const blob = new Blob([JSON.stringify(configPayload, null, 2)], {
      type: 'application/json',
    });
    downloadBlob(blob, `m2rstudio-android-profile-${activeProject.deviceProfile}.json`);
  };

  const liveAppUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://m2rstudio.app';

  const handleExportApkPackage = () => {
    const file = buildAndDownloadAndroidApkProject({
      appUrl: liveAppUrl,
      packageId: apkPackageId,
      appName: apkAppName.trim() || 'M2R Studio',
      versionName: apkVersion.trim() || '1.0.0',
      versionCode: 1,
      minSdk: apkMinSdk,
      project: activeProject,
    });
    setApkNotice(
      `Paket proyek "${file}" berhasil diunduh. Ekstrak lalu jalankan "./gradlew assembleDebug" di Android Studio atau unggah ke GitHub untuk build APK otomatis via GitHub Actions.`
    );
  };

  const pwaBuilderUrl = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(liveAppUrl)}`;

  const usagePercent =
    quota.quotaBytes > 0 ? Math.min(100, Math.round((quota.usageBytes / quota.quotaBytes) * 100)) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 7 Columns: Android 10 Micro-USB OTG Compatibility & Hardware Scanner */}
      <section className="lg:col-span-7 space-y-6">
        {/* Hardware Profile Selection */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Profil Hardware Android & USB OTG
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Dukungan penuh Android 10 ke bawah dengan kabel Micro-USB 2.0 OTG hingga USB-C 3.0.
              </p>
            </div>
            <button
              type="button"
              onClick={exportAndroidOtgProfileJson}
              className="min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Unduh Profil OTG (.json)
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'android10_micro_usb' as const,
                icon: Smartphone,
                title: 'Android 10 & Bawah',
                subtitle: 'Micro-USB 2.0 OTG · MJPEG · FAT32 Split',
              },
              {
                id: 'android11_usbc' as const,
                icon: Usb,
                title: 'Android 11+ USB-C',
                subtitle: 'UVC 3.0 · 4K60 · Scoped Storage SD',
              },
              {
                id: 'desktop_uvc' as const,
                icon: Cpu,
                title: 'Desktop / Tablet',
                subtitle: 'HDMI Capture 80 Mbps · Multi-Track',
              },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeProject.deviceProfile === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeProfile(item.id)}
                  className={`p-3.5 rounded-xl border text-left transition-colors space-y-2 ${
                    active
                      ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 ${
                      active ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-500'
                    }`}
                  />
                  <div>
                    <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                      {item.subtitle}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Micro-USB OTG Diagnostic Checklist */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Checklist Latensi Rendah Micro-USB OTG (Android 7.0 – 10.0)
          </h3>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {diagnostics.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => toggleDiagnostic(item.id)}
                className="w-full py-3.5 flex items-start gap-3 text-left group"
              >
                <CheckCircle2
                  className={`w-4 h-4 mt-0.5 shrink-0 transition-colors ${
                    item.checked
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-zinc-300 dark:text-zinc-700 group-hover:text-zinc-400'
                  }`}
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.label}
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {item.detail}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
        {/* Export Android APK Project Package */}
        <div
          id="ekspor-apk-android"
          className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <Package className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              <span>Ekspor Paket APK Android (Android 7.0 – 14+)</span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Unduh proyek Android siap kompilasi (Android Studio / Gradle / GitHub Actions) lengkap
              dengan filter USB Host UVC Micro-USB, izin Kartu SD Android 10, dan manifest TWA —
              atau kemas langsung menjadi file .APK online melalui PWABuilder.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Application / Package ID
              </label>
              <input
                type="text"
                value={apkPackageId}
                onChange={(e) => setApkPackageId(e.target.value)}
                className="w-full min-h-[38px] px-3 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Nama Aplikasi Launcher
              </label>
              <input
                type="text"
                maxLength={24}
                value={apkAppName}
                onChange={(e) => setApkAppName(e.target.value)}
                className="w-full min-h-[38px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Versi APK
              </label>
              <input
                type="text"
                maxLength={16}
                value={apkVersion}
                onChange={(e) => setApkVersion(e.target.value)}
                className="w-full min-h-[38px] px-3 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Minimum Android SDK
              </label>
              <select
                value={apkMinSdk}
                onChange={(e) => setApkMinSdk(Number(e.target.value))}
                className="w-full min-h-[38px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
              >
                <option value={24}>API 24 — Android 7.0 Nougat (Micro-USB OTG)</option>
                <option value={26}>API 26 — Android 8.0 Oreo</option>
                <option value={29}>API 29 — Android 10 (Legacy SD Card)</option>
              </select>
            </div>
          </div>

          <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Isi paket ZIP: AndroidManifest.xml (USB Host + SD Card) · device_filter.xml (UVC Class
            14 / MS2109) · MainActivity.java · build.gradle · twa-manifest.json · GitHub Actions
            Auto-Build APK
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={handleExportApkPackage}
              className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-semibold inline-flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Unduh Proyek APK Android (.zip)
            </button>

            <a
              href={pwaBuilderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              <span>Kemas APK Online (PWABuilder)</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>

          {apkNotice && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
              {apkNotice}
            </p>
          )}
        </div>
      </section>

      {/* Right 5 Columns: Android PWA Install, Auto Dark Mode, Detected USB Devices & Storage Quota */}
      <aside className="lg:col-span-5 space-y-6">
        <PWAInstallButton variant="card" />

        {/* Automatic Dark Mode Control */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Tampilan & Mode Gelap Otomatis
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Saat ini aktif: {resolvedTheme === 'dark' ? 'Mode Gelap' : 'Mode Terang'}. Mode
              Otomatis mengikuti jadwal sistem Android / OS Anda.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'auto' as const, label: 'Otomatis', icon: Monitor },
              { id: 'dark' as const, label: 'Gelap', icon: Moon },
              { id: 'light' as const, label: 'Terang', icon: Sun },
            ].map((item) => {
              const Icon = item.icon;
              const active = themeMode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeThemeMode(item.id)}
                  className={`min-h-[44px] px-3 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-2 transition-colors ${
                    active
                      ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Detected USB UVC & Audio Hardware (Real-time Hot-Plug + WebUSB OTG) */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Perangkat USB OTG & Input Terdeteksi
            </h3>
            <button
              type="button"
              onClick={() => void refreshHardwareInfo()}
              className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              Segarkan
            </button>
          </div>

          <button
            type="button"
            onClick={() => void requestWebUsbOtgDevice()}
            className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
          >
            <Usb className="w-3.5 h-3.5" />
            Pindai & Beri Izin USB OTG (WebUSB)
          </button>

          {usbPermissionError && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
              {usbPermissionError}
            </p>
          )}

          {usbHardwareList.length > 0 && (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800 pt-1">
              {usbHardwareList.map((hw) => (
                <div key={hw.key} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {hw.name}
                    </div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {hw.manufacturer}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 shrink-0">
                    {hw.vendorHex}:{hw.productHex}
                  </span>
                </div>
              ))}
            </div>
          )}

          {videoDevices.length === 0 && audioDevices.length === 0 ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Pemantauan colok-otomatis aktif. Sambungkan kartu HDMI Capture USB OTG lalu izinkan
              akses kamera/USB pada Chrome Android.
            </p>
          ) : (
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {[...videoDevices, ...audioDevices].map((dev, i) => (
                <div
                  key={`${dev.deviceId}_${i}`}
                  className="py-2.5 flex items-center justify-between gap-2 text-xs"
                >
                  <span className="text-zinc-800 dark:text-zinc-200 truncate">
                    {dev.label ||
                      (dev.kind === 'videoinput'
                        ? `Kamera / USB UVC #${i + 1}`
                        : `Input Audio #${i + 1}`)}
                  </span>
                  <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400 shrink-0">
                    {dev.kind === 'videoinput' ? 'VIDEO' : 'AUDIO'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Local Buffer & SD Quota Overview */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              <HardDrive className="w-4 h-4 text-zinc-500" />
              <span>Kapasitas Buffer Lokal & SD</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
              {usagePercent}%
            </span>
          </div>

          <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all"
              style={{ width: `${Math.max(2, usagePercent)}%` }}
            />
          </div>

          <div className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            {quota.supported
              ? `Terpakai ${formatFileSize(quota.usageBytes)} dari ${formatFileSize(quota.quotaBytes)} ruang buffer tersedia`
              : 'Gunakan "Pilih Folder Kartu SD" di Studio untuk penulisan langsung ke penyimpanan eksternal.'}
          </div>
        </div>
      </aside>
    </div>
  );
}
