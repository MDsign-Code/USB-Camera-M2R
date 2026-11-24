import React, { useState } from 'react';
import { Cloud, CloudOff, Copy, FolderPlus, Play, Trash2 } from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  DEFAULT_CAPTURE_SETTINGS,
  generateSafeDocId,
  type CaptureProject,
  type DeviceProfile,
  type TargetPlatform,
} from '../types/capture';

interface ProjectsCloudViewProps {
  projects: CaptureProject[];
  activeProjectId: string;
  userEmail: string | null;
  isSyncing: boolean;
  onSelectProject: (projectId: string) => void;
  onCreateProject: (project: CaptureProject) => Promise<void>;
  onDuplicateProject: (project: CaptureProject) => Promise<void>;
  onDeleteProject: (project: CaptureProject) => Promise<void>;
  onSignIn: () => Promise<void>;
  onSyncLocalToCloud: () => Promise<void>;
}

const PROFILE_LABELS: Record<DeviceProfile, string> = {
  android10_micro_usb: 'Android 10 & ke Bawah (Micro-USB)',
  android11_usbc: 'Android 11+ (USB-C)',
  desktop_uvc: 'Desktop USB UVC',
};

const PLATFORM_LABELS: Record<TargetPlatform, string> = {
  youtube: 'YouTube 16:9',
  youtube_shorts: 'YouTube Shorts 9:16',
  instagram_reels: 'Instagram Reels',
  tiktok: 'TikTok',
  facebook: 'Facebook Video',
  archive: 'Arsip Master',
};

export function ProjectsCloudView({
  projects,
  activeProjectId,
  userEmail,
  isSyncing,
  onSelectProject,
  onCreateProject,
  onDuplicateProject,
  onDeleteProject,
  onSignIn,
  onSyncLocalToCloud,
}: ProjectsCloudViewProps) {
  const [name, setName] = useState<string>('');
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile>('android10_micro_usb');
  const [targetPlatform, setTargetPlatform] = useState<TargetPlatform>('youtube');
  const [notes, setNotes] = useState<string>('');
  const [creating, setCreating] = useState<boolean>(false);

  const hasUnsyncedProjects = projects.some((p) => !p.syncedToCloud);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const isVertical =
        targetPlatform === 'youtube_shorts' ||
        targetPlatform === 'instagram_reels' ||
        targetPlatform === 'tiktok';
      const now = Date.now();
      const newProject: CaptureProject = {
        ...DEFAULT_CAPTURE_SETTINGS,
        id: generateSafeDocId('proj'),
        ownerId: 'local_guest',
        name: trimmed.slice(0, BLUEPRINT_LIMITS.PROJECT_NAME_MAX),
        deviceProfile,
        targetPlatform,
        resolutionWidth: isVertical ? 1080 : 1920,
        resolutionHeight: isVertical ? 1920 : 1080,
        rotation: isVertical ? 90 : 0,
        cropAspect: isVertical ? '9:16' : '16:9',
        cropX: isVertical ? 34 : 0,
        cropW: isVertical ? 32 : 100,
        notes: notes.trim().slice(0, BLUEPRINT_LIMITS.PROJECT_NOTES_MAX),
        createdAtMs: now,
        updatedAtMs: now,
        syncedToCloud: false,
      };
      await onCreateProject(newProject);
      setName('');
      setNotes('');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left 8 Columns: Cloud Sync Status & Project List */}
      <section className="lg:col-span-8 space-y-5">
        {/* Cloud Synchronization Overview Bar */}
        <div className="p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {userEmail ? (
                <Cloud className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CloudOff className="w-4 h-4 text-zinc-400" />
              )}
              <span>
                {userEmail
                  ? 'Sinkronisasi Cloud Aktif Lintas Perangkat'
                  : 'Mode Penyimpanan Lokal (Belum Masuk Cloud)'}
              </span>
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {userEmail
                ? `Terhubung ke akun ${userEmail}. Semua preset resolusi, crop, rotasi 90°, sinkronisasi audio, dan riwayat rekaman disinkronkan secara real-time.`
                : 'Masuk dengan akun Google untuk menyinkronkan semua proyek capture Anda antara ponsel Android Micro-USB dan komputer secara otomatis.'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!userEmail ? (
              <button
                type="button"
                onClick={() => void onSignIn()}
                className="min-h-[42px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap transition-colors"
              >
                Aktifkan Cloud Sync
              </button>
            ) : hasUnsyncedProjects ? (
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void onSyncLocalToCloud()}
                className="min-h-[42px] px-4 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold whitespace-nowrap disabled:opacity-50"
              >
                {isSyncing ? 'Menyinkronkan...' : 'Unggah Proyek Lokal ke Cloud'}
              </button>
            ) : null}
          </div>
        </div>

        {/* Projects List */}
        <div className="rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Daftar Proyek Capture ({projects.length})
            </h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Klik proyek untuk memuat ke studio
            </span>
          </div>

          <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {projects.map((proj) => {
              const isActive = proj.id === activeProjectId;
              return (
                <div
                  key={proj.id}
                  className={`p-5 transition-colors ${
                    isActive ? 'bg-zinc-50 dark:bg-zinc-900/50' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
                          {proj.name}
                        </h3>
                        {isActive && (
                          <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                            Aktif di Studio
                          </span>
                        )}
                      </div>

                      <div className="text-xs font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                        {proj.resolutionWidth}×{proj.resolutionHeight} · {proj.fps} fps ·{' '}
                        {proj.videoBitrateMbps} Mbps {proj.format.toUpperCase()} · Rotasi{' '}
                        {proj.rotation}° · Crop {proj.cropAspect} · Sync{' '}
                        {proj.audioSyncMs >= 0 ? `+${proj.audioSyncMs}ms` : `${proj.audioSyncMs}ms`}
                      </div>

                      <div className="text-xs text-zinc-500 dark:text-zinc-400">
                        {PROFILE_LABELS[proj.deviceProfile]} · {PLATFORM_LABELS[proj.targetPlatform]}{' '}
                        · {proj.syncedToCloud ? 'Tersinkronisasi Cloud' : 'Lokal'}
                      </div>

                      {proj.notes && (
                        <p className="text-xs text-zinc-500 dark:text-zinc-400 pt-0.5 max-w-2xl">
                          {proj.notes}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onSelectProject(proj.id)}
                        className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                          isActive
                            ? 'bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                            : 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5" />
                        {isActive ? 'Buka Studio' : 'Muat'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void onDuplicateProject(proj)}
                        title="Duplikasi proyek"
                        className="min-h-[38px] min-w-[38px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center text-zinc-600 dark:text-zinc-400"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      {projects.length > 1 && (
                        <button
                          type="button"
                          onClick={() => void onDeleteProject(proj)}
                          title="Hapus proyek"
                          className="min-h-[38px] min-w-[38px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 flex items-center justify-center text-zinc-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Right 4 Columns: Create New Cloud Project Preset */}
      <aside className="lg:col-span-4 p-5 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
          Buat Proyek Capture Baru
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
          Simpan preset kamera USB, rotasi 90° vertikal, dan jalur Kartu SD untuk disinkronkan ke
          semua perangkat Anda.
        </p>

        <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Nama Proyek
            </label>
            <input
              type="text"
              required
              maxLength={BLUEPRINT_LIMITS.PROJECT_NAME_MAX}
              placeholder="Contoh: Podcast Sony A6400 Micro-USB"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[42px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Profil Perangkat USB OTG
            </label>
            <select
              value={deviceProfile}
              onChange={(e) => setDeviceProfile(e.target.value as DeviceProfile)}
              className="w-full min-h-[42px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            >
              <option value="android10_micro_usb">Android 10 & ke Bawah (Micro-USB 2.0)</option>
              <option value="android11_usbc">Android 11+ (USB-C UVC 3.0)</option>
              <option value="desktop_uvc">Desktop / Tablet Workstation</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Target Platform Utama
            </label>
            <select
              value={targetPlatform}
              onChange={(e) => setTargetPlatform(e.target.value as TargetPlatform)}
              className="w-full min-h-[42px] px-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
            >
              <option value="youtube">YouTube (16:9 Lanskap)</option>
              <option value="youtube_shorts">YouTube Shorts (9:16 Vertikal + Rotasi 90°)</option>
              <option value="instagram_reels">Instagram Reels (9:16 Vertikal)</option>
              <option value="tiktok">TikTok (9:16 Vertikal)</option>
              <option value="facebook">Facebook Video</option>
              <option value="archive">Arsip Master Tanpa Kompresi Berlebih</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Catatan Setup (Opsional)
            </label>
            <textarea
              rows={3}
              maxLength={BLUEPRINT_LIMITS.PROJECT_NOTES_MAX}
              placeholder="Contoh: Kartu capture MS2109 HDMI, mic eksternal +24ms sync, simpan ke SD Card SanDisk 128GB."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full p-3 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="w-full min-h-[44px] px-4 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            {creating ? 'Membuat Proyek...' : 'Simpan & Buka Proyek Baru'}
          </button>
        </form>
      </aside>
    </div>
  );
}
