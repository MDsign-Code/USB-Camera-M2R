import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Film,
  Share2,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  formatDuration,
  formatFileSize,
  PLATFORM_SPECS,
  RESOLUTION_PRESETS,
  type CaptureRecording,
  type PublishPlatform,
  type VideoFormat,
} from '../types/capture';
import {
  downloadBlob,
  loadClipBlobFromCache,
  negotiateBestCodec,
  type DirectoryHandleLike,
} from '../lib/storage';

interface ExportPublishViewProps {
  recordings: CaptureRecording[];
  sdDirectory: DirectoryHandleLike | null;
  onExportComplete: (
    recording: CaptureRecording,
    meta: {
      title: string;
      resolution: string;
      format: VideoFormat;
      videoBitrateMbps: number;
      fileSizeBytes: number;
      storageTarget: string;
    }
  ) => Promise<void>;
  onMarkPublished: (recording: CaptureRecording, platform: PublishPlatform) => Promise<void>;
  onDeleteRecording: (recording: CaptureRecording) => Promise<void>;
  onBackToCapture: () => void;
}

export function ExportPublishView({
  recordings,
  sdDirectory,
  onExportComplete,
  onMarkPublished,
  onDeleteRecording,
  onBackToCapture,
}: ExportPublishViewProps) {
  const [selectedId, setSelectedId] = useState<string>(recordings[0]?.id ?? '');
  const [exportPresetId, setExportPresetId] = useState<string>('1080p');
  const [exportFormat, setExportFormat] = useState<VideoFormat>('mp4');
  const [exportBitrateMbps, setExportBitrateMbps] = useState<number>(24);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);

  // Instant Social Media & YouTube Upload state
  const [selectedPlatform, setSelectedPlatform] = useState<PublishPlatform>('youtube');
  const [publishTitle, setPublishTitle] = useState<string>('');
  const [publishDesc, setPublishDesc] = useState<string>(
    'Direkam tanpa tanda air menggunakan M2R Studio Android USB Video Capture.'
  );
  const [publishTags, setPublishTags] = useState<string>(
    '#M2RStudio #USBCapture #VideoProduction'
  );
  const [publishVisibility, setPublishVisibility] = useState<'public' | 'unlisted' | 'private'>(
    'public'
  );
  const [publishFeedback, setPublishFeedback] = useState<string | null>(null);
  const [copiedMeta, setCopiedMeta] = useState<boolean>(false);
  const [hydratedUrl, setHydratedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (recordings.length > 0 && !recordings.some((r) => r.id === selectedId)) {
      setSelectedId(recordings[0].id);
    }
  }, [recordings, selectedId]);

  const selectedClip = useMemo(
    () => recordings.find((r) => r.id === selectedId) ?? recordings[0] ?? null,
    [recordings, selectedId]
  );

  useEffect(() => {
    if (!selectedClip) {
      setHydratedUrl(null);
      return;
    }
    setPublishTitle(selectedClip.title);
    setExportBitrateMbps(selectedClip.videoBitrateMbps);
    setExportFormat(selectedClip.format);

    if (selectedClip.localBlobUrl) {
      setHydratedUrl(selectedClip.localBlobUrl);
      return;
    }

    let revoked = false;
    let objectUrl: string | null = null;
    void loadClipBlobFromCache(selectedClip.id).then((blob) => {
      if (blob && !revoked) {
        objectUrl = URL.createObjectURL(blob);
        setHydratedUrl(objectUrl);
      } else if (!revoked) {
        setHydratedUrl(null);
      }
    });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedClip]);

  const activePlatformSpec = useMemo(
    () => PLATFORM_SPECS.find((p) => p.id === selectedPlatform) ?? PLATFORM_SPECS[0],
    [selectedPlatform]
  );

  // Real High-Resolution Watermark-Free Export (re-encodes or streams clean pixel buffer)
  const handleHighResExport = async () => {
    if (!selectedClip) return;
    setExportStatusMsg(null);
    setIsExporting(true);
    setExportProgress(10);

    try {
      const sourceBlob = await loadClipBlobFromCache(selectedClip.id);
      if (!sourceBlob) {
        setExportStatusMsg(
          'File video fisik tersimpan di perangkat asal saat perekaman. Rekaman cloud menyimpan metadata & preset proyek untuk sinkronisasi lintas perangkat.'
        );
        setIsExporting(false);
        return;
      }

      const preset =
        RESOLUTION_PRESETS.find((p) => p.id === exportPresetId) ?? RESOLUTION_PRESETS[1];
      const codec = negotiateBestCodec(exportFormat);
      const safeFilename = `${selectedClip.title
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 48)}_${preset.width}x${preset.height}_NoWatermark.${codec.extension}`;

      // Fast direct stream copy if resolution and format match source (instant performance for large files!)
      const sourceRes = `${preset.width}x${preset.height}`;
      let outBlob: Blob = sourceBlob;

      if (selectedClip.resolution === sourceRes && selectedClip.format === codec.extension) {
        setExportProgress(65);
        await new Promise((r) => setTimeout(r, 180));
        setExportProgress(100);
      } else {
        // Real canvas re-encode to target high resolution without watermark
        outBlob = await transcodeClipWatermarkFree(
          sourceBlob,
          preset.width,
          preset.height,
          selectedClip.fps,
          exportBitrateMbps,
          codec.mimeType,
          (pct) => setExportProgress(pct)
        );
      }

      let finalTarget = `${selectedClip.storageTarget.split('/').slice(0, -1).join('/') || '/storage/sdcard1/DCIM/M2RStudio'}/${safeFilename}`;

      if (sdDirectory) {
        try {
          const fh = await sdDirectory.getFileHandle(safeFilename, { create: true });
          const writer = await fh.createWritable();
          await writer.write(outBlob);
          await writer.close();
          finalTarget = `${sdDirectory.name}/${safeFilename}`;
        } catch {
          downloadBlob(outBlob, safeFilename);
        }
      } else {
        downloadBlob(outBlob, safeFilename);
      }

      await onExportComplete(selectedClip, {
        title: selectedClip.title,
        resolution: sourceRes,
        format: codec.extension,
        videoBitrateMbps: exportBitrateMbps,
        fileSizeBytes: outBlob.size,
        storageTarget: finalTarget,
      });

      setExportStatusMsg(
        `Ekspor ${preset.label} (${formatFileSize(outBlob.size)}) bebas tanda air selesai disimpan.`
      );
    } catch {
      setExportStatusMsg('Terjadi kendala saat mengekspor video. Coba format atau bitrate lain.');
    } finally {
      setIsExporting(false);
    }
  };

  // Instant Upload to YouTube & Social Media (Native Android Web Share + Studio Handoff)
  const handleInstantPublish = async (mode: 'native_share' | 'studio_handoff') => {
    if (!selectedClip) return;
    setPublishFeedback(null);

    const metadataText = `${publishTitle}\n\n${publishDesc}\n\n${publishTags}\n[Visibilitas: ${publishVisibility}]`;

    if (mode === 'native_share') {
      const blob = await loadClipBlobFromCache(selectedClip.id);
      const navShare = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };

      if (blob && typeof navigator.share === 'function') {
        const file = new File(
          [blob],
          `${publishTitle.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40)}.${selectedClip.format}`,
          { type: selectedClip.mimeType || 'video/mp4' }
        );
        try {
          if (!navShare.canShare || navShare.canShare({ files: [file] })) {
            await navigator.share({
              title: publishTitle,
              text: metadataText,
              files: [file],
            });
            await onMarkPublished(selectedClip, selectedPlatform);
            setPublishFeedback(
              `Video berhasil dikirim ke aplikasi ${activePlatformSpec.label} melalui Android Share.`
            );
            return;
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        }
      }
      setPublishFeedback(
        'Native Android Share File aktif saat dibuka di Chrome Android. Gunakan "Salin Metadata & Siapkan Unggah" untuk unggah instan di browser desktop.'
      );
      return;
    }

    // Copy metadata to clipboard + trigger clean file download if local + record publish state
    try {
      await navigator.clipboard.writeText(metadataText);
      setCopiedMeta(true);
      setTimeout(() => setCopiedMeta(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }

    const blob = await loadClipBlobFromCache(selectedClip.id);
    if (blob) {
      downloadBlob(
        blob,
        `${publishTitle.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 44)}_${selectedPlatform}.${selectedClip.format}`
      );
    }

    await onMarkPublished(selectedClip, selectedPlatform);
    setPublishFeedback(
      `Judul, deskripsi, dan tag disalin ke clipboard untuk ${activePlatformSpec.label}. Klik tautan portal di bawah untuk menempel dan memublikasikan.`
    );
  };

  if (recordings.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center text-zinc-500">
          <Film className="w-5 h-5" />
        </div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Belum Ada Rekaman di Proyek Ini
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto">
          Rekam video dari studio USB Capture terlebih dahulu. Hasil rekaman siap diekspor ke
          resolusi tinggi hingga 4K tanpa tanda air dan diunggah instan ke YouTube maupun media
          sosial.
        </p>
        <button
          type="button"
          onClick={onBackToCapture}
          className="min-h-[44px] px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors"
        >
          Kembali ke Studio Rekam
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 4 Columns: Recordings Library */}
      <section className="lg:col-span-4 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="px-4 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Pustaka Rekaman ({recordings.length})
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Bebas Watermark</span>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800 max-h-[640px] overflow-y-auto">
          {recordings.map((clip) => {
            const active = selectedClip?.id === clip.id;
            return (
              <div
                key={clip.id}
                className={`p-4 transition-colors cursor-pointer ${
                  active
                    ? 'bg-zinc-100/80 dark:bg-zinc-800/60'
                    : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50'
                }`}
                onClick={() => setSelectedId(clip.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {clip.title}
                    </div>
                    <div className="mt-1 text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                      {clip.resolution} · {clip.fps}fps · {formatDuration(clip.durationSec)} ·{' '}
                      {formatFileSize(clip.fileSizeBytes)}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                      {clip.format.toUpperCase()} · {clip.videoBitrateMbps} Mbps ·{' '}
                      {clip.publishedPlatforms.length > 0
                        ? `Diunggah: ${clip.publishedPlatforms.join(', ')}`
                        : clip.status === 'exported'
                        ? 'Sudah Diekspor'
                        : 'Siap Ekspor'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onDeleteRecording(clip);
                    }}
                    title="Hapus rekaman"
                    className="p-2 text-zinc-400 hover:text-rose-600 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Right 8 Columns: Preview, High-Res Watermark-Free Export & Social Upload */}
      {selectedClip && (
        <section className="lg:col-span-8 space-y-6">
          {/* Preview Player */}
          <div className="rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="bg-zinc-950 flex items-center justify-center min-h-[260px] max-h-[420px]">
              {hydratedUrl ? (
                <video
                  key={hydratedUrl}
                  src={hydratedUrl}
                  controls
                  playsInline
                  className="max-h-[420px] w-auto max-w-full"
                />
              ) : (
                <div className="p-8 text-center space-y-2">
                  <p className="text-sm font-medium text-zinc-200">
                    Metadata Tersinkronisasi dari Cloud
                  </p>
                  <p className="text-xs text-zinc-400 max-w-md">
                    File video besar disimpan secara lokal di Kartu SD perangkat perekam (
                    <span className="font-mono">{selectedClip.storageTarget}</span>) agar sinkronisasi
                    cloud tetap instan dan bebas batas penyimpanan.
                  </p>
                </div>
              )}
            </div>
            <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                {selectedClip.resolution} · {selectedClip.fps} fps · {selectedClip.videoBitrateMbps}{' '}
                Mbps · Rotasi {selectedClip.rotation}° · Sync {selectedClip.audioSyncMs}ms
              </div>
              <div className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <ShieldCheck className="w-4 h-4" />
                100% Bebas Tanda Air
              </div>
            </div>
          </div>

          {/* High-Res Watermark-Free Export Panel */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Ekspor Resolusi Tinggi Tanpa Tanda Air
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Pilih resolusi output, kontainer MP4/WebM, dan bitrate. Pemrosesan chunked menjaga
                performa tetap cepat pada file besar.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {RESOLUTION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setExportPresetId(preset.id);
                    setExportBitrateMbps(preset.recommendedMbps);
                  }}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    exportPresetId === preset.id
                      ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {preset.label}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {preset.width}×{preset.height}
                  </div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Bitrate Ekspor</span>
                  <span className="font-mono tabular-nums font-semibold">
                    {exportBitrateMbps} Mbps
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={80}
                  value={exportBitrateMbps}
                  onChange={(e) => setExportBitrateMbps(Number(e.target.value))}
                  className="w-full studio-slider"
                />
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                  {(['mp4', 'webm'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setExportFormat(fmt)}
                      className={`px-3 py-1.5 text-xs font-mono uppercase rounded-md ${
                        exportFormat === fmt
                          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                          : 'text-zinc-500'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => void handleHighResExport()}
                  className="min-h-[42px] px-4 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  {isExporting ? `Merender ${exportProgress}%` : 'Ekspor Tanpa Watermark'}
                </button>
              </div>
            </div>

            {isExporting && (
              <div className="h-1.5 w-full rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-rose-600 transition-all duration-150"
                  style={{ width: `${exportProgress}%` }}
                />
              </div>
            )}

            {exportStatusMsg && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400">{exportStatusMsg}</p>
            )}
          </div>

          {/* Instant Upload to YouTube & Social Media */}
          <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Unggah Instan ke YouTube & Media Sosial
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Siapkan metadata video dan kirim langsung ke aplikasi YouTube, Instagram Reels,
                TikTok, atau Facebook setelah proses rendering selesai.
              </p>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {PLATFORM_SPECS.map((spec) => (
                <button
                  key={spec.id}
                  type="button"
                  onClick={() => setSelectedPlatform(spec.id)}
                  className={`min-h-[38px] px-3 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                    selectedPlatform === spec.id
                      ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                      : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  {spec.label}
                </button>
              ))}
            </div>

            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
              Rekomendasi {activePlatformSpec.label}: {activePlatformSpec.aspectHint} · Bitrate{' '}
              {activePlatformSpec.recommendedMbps} Mbps · Maks durasi{' '}
              {Math.round(activePlatformSpec.maxDurationSec / 60)} menit
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Judul Video
                </label>
                <input
                  type="text"
                  maxLength={100}
                  value={publishTitle}
                  onChange={(e) => setPublishTitle(e.target.value)}
                  className="w-full min-h-[40px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Visibilitas
                </label>
                <select
                  value={publishVisibility}
                  onChange={(e) =>
                    setPublishVisibility(e.target.value as 'public' | 'unlisted' | 'private')
                  }
                  className="w-full min-h-[40px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                >
                  <option value="public">Publik</option>
                  <option value="unlisted">Tidak Publik (Unlisted)</option>
                  <option value="private">Pribadi</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Deskripsi
                </label>
                <textarea
                  rows={2}
                  value={publishDesc}
                  onChange={(e) => setPublishDesc(e.target.value)}
                  className="w-full p-2.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Tag / Hashtag
                </label>
                <textarea
                  rows={2}
                  value={publishTags}
                  onChange={(e) => setPublishTags(e.target.value)}
                  className="w-full p-2.5 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 resize-none"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => void handleInstantPublish('native_share')}
                className="min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Share2 className="w-4 h-4" />
                Bagikan Instan (Android Share)
              </button>

              <button
                type="button"
                onClick={() => void handleInstantPublish('studio_handoff')}
                className="min-h-[44px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                {copiedMeta ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                {copiedMeta ? 'Metadata Disalin' : 'Siapkan File & Salin Metadata'}
              </button>

              <a
                href={activePlatformSpec.uploadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" />
                Buka Portal {activePlatformSpec.label}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {publishFeedback && (
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{publishFeedback}</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

// High-Resolution Watermark-Free Offscreen Re-Encoder
async function transcodeClipWatermarkFree(
  sourceBlob: Blob,
  targetW: number,
  targetH: number,
  fps: number,
  bitrateMbps: number,
  mimeType: string,
  onProgress: (pct: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const srcUrl = URL.createObjectURL(sourceBlob);
    video.src = srcUrl;

    video.onloadedmetadata = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Canvas context unavailable');

        const stream = canvas.captureStream(fps);
        const options: MediaRecorderOptions = {
          videoBitsPerSecond: bitrateMbps * 1_000_000,
        };
        if (mimeType) options.mimeType = mimeType;

        const recorder = new MediaRecorder(stream, options);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) chunks.push(ev.data);
        };
        recorder.onstop = () => {
          URL.revokeObjectURL(srcUrl);
          onProgress(100);
          resolve(new Blob(chunks, { type: mimeType || 'video/mp4' }));
        };

        recorder.start(500);
        await video.play();

        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 5;
        const renderStep = () => {
          if (video.ended || video.paused) {
            if (recorder.state !== 'inactive') recorder.stop();
            return;
          }
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, targetW, targetH);
          // Clean letterbox/cover without any watermark
          const srcRatio = video.videoWidth / Math.max(1, video.videoHeight);
          const dstRatio = targetW / targetH;
          let drawW = targetW;
          let drawH = targetH;
          let dx = 0;
          let dy = 0;
          if (srcRatio > dstRatio) {
            drawH = targetW / srcRatio;
            dy = (targetH - drawH) / 2;
          } else {
            drawW = targetH * srcRatio;
            dx = (targetW - drawW) / 2;
          }
          ctx.drawImage(video, dx, dy, drawW, drawH);
          const pct = Math.min(98, Math.round((video.currentTime / duration) * 100));
          onProgress(pct);
          requestAnimationFrame(renderStep);
        };
        requestAnimationFrame(renderStep);
      } catch (err) {
        URL.revokeObjectURL(srcUrl);
        reject(err);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(srcUrl);
      reject(new Error('Failed to load clip for high-res export'));
    };
  });
}
