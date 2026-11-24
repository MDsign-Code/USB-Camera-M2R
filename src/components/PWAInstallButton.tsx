import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'card';
  onExportApk?: () => void;
}

export function PWAInstallButton({ variant = 'compact', onExportApk }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, isInIframe, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [installNote, setInstallNote] = useState<string | null>(null);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Aplikasi Android Terpasang
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              KaptureOTG berjalan dalam mode layar penuh standalone tanpa bilah browser.
            </p>
          </div>
          <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
            Aktif
          </span>
        </div>
      );
    }
    return null;
  }

  const handleInstallClick = async () => {
    setInstallNote(null);
    if (isInstallable) {
      const outcome = await install();
      if (outcome === 'accepted') {
        setInstallNote('KaptureOTG sedang dipasang ke layar utama Android Anda.');
      }
      return;
    }
    setShowGuide(true);
  };

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2400);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <>
      {variant === 'card' ? (
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                <Smartphone className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Instal Aplikasi di Android</span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                Pasang KaptureOTG langsung ke layar utama Android (mendukung Android 7.0 – 10.0
                Micro-USB & Android 11+) agar berjalan layar penuh seperti aplikasi native dan tetap
                bisa merekam saat offline.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void handleInstallClick()}
              className="min-h-[44px] px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-semibold inline-flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer"
            >
              <Download className="w-4 h-4" />
              {isInstallable ? 'Instal ke Android Sekarang' : 'Instal Aplikasi Android'}
            </button>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
              {isInstallable
                ? 'Siap dipasang langsung via Chrome Android'
                : 'Tanpa Play Store · Ukuran ringan · Mode Offline'}
            </span>
          </div>

          {installNote && (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{installNote}</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void handleInstallClick()}
          className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Instal Android
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {isIOS ? 'Instal KaptureOTG di iPhone / iPad' : 'Instal KaptureOTG di Android'}
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  {isIOS
                    ? 'Tambahkan aplikasi ke Layar Utama Safari untuk mode layar penuh.'
                    : 'Jalankan KaptureOTG sebagai aplikasi Android mandiri (PWA) dengan dukungan Micro-USB OTG & offline.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Tutup panduan instal"
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs text-zinc-700 dark:text-zinc-300 list-decimal list-inside">
                <li>
                  Ketuk tombol <strong>Bagikan (Share)</strong> pada bilah bawah Safari.
                </li>
                <li>
                  Gulir ke bawah lalu pilih <strong>Tambahkan ke Layar Utama</strong>.
                </li>
                <li>
                  Ketuk <strong>Tambah</strong> untuk memasang ikon KaptureOTG.
                </li>
              </ol>
            ) : (
              <div className="space-y-3">
                {isInIframe && (
                  <div className="p-3 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    Saat ini aplikasi sedang dibuka di dalam jendela pratinjau. Buka tautan di tab
                    Chrome Android langsung agar tombol instalasi native Android muncul otomatis.
                  </div>
                )}

                <ol className="space-y-2 text-xs text-zinc-700 dark:text-zinc-300 list-decimal list-inside leading-relaxed">
                  <li>
                    Buka aplikasi ini langsung di browser <strong>Google Chrome Android</strong>.
                  </li>
                  <li>
                    Ketuk tombol <strong>Instal Android</strong> lagi, atau ketuk ikon menu titik
                    tiga (<strong>⋮</strong>) di pojok kanan atas Chrome.
                  </li>
                  <li>
                    Pilih <strong>Instal aplikasi</strong> atau{' '}
                    <strong>Tambahkan ke Layar utama</strong>, lalu konfirmasi{' '}
                    <strong>Instal</strong>.
                  </li>
                </ol>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={currentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 min-h-[42px] px-3.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Buka Tab Penuh
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl()}
                    className="min-h-[42px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    {copiedUrl ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    {copiedUrl ? 'Tautan Disalin' : 'Salin Tautan'}
                  </button>
                </div>

                {onExportApk && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowGuide(false);
                      onExportApk();
                    }}
                    className="w-full min-h-[40px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-xs font-semibold text-zinc-800 dark:text-zinc-200 transition-colors"
                  >
                    Atau Ekspor Proyek APK Android (.zip / PWABuilder)
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[40px] rounded-lg bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200 transition-colors"
            >
              Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-16 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Mode Offline — Perekaman lokal & Kartu SD tetap berjalan</span>
    </div>
  );
}
