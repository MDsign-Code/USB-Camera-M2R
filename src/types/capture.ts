export type DeviceProfile = 'android10_micro_usb' | 'android11_usbc' | 'desktop_uvc';
export type VideoFormat = 'mp4' | 'webm';
export type CropAspect = 'free' | '9:16' | '16:9' | '4:5' | '1:1';
export type RotationAngle = 0 | 90 | 180 | 270;
export type TargetPlatform =
  | 'youtube'
  | 'youtube_shorts'
  | 'instagram_reels'
  | 'tiktok'
  | 'facebook'
  | 'archive';
export type PublishPlatform =
  | 'youtube'
  | 'youtube_shorts'
  | 'instagram_reels'
  | 'tiktok'
  | 'facebook';
export type RecordingStatus = 'recorded' | 'exported' | 'published' | 'archived';
export type ThemeMode = 'auto' | 'dark' | 'light';
export type DemoFeedId = 'studio_desk' | 'coffee_barista' | 'smpte_bars';

export interface CaptureSettings {
  deviceProfile: DeviceProfile;
  resolutionWidth: number;
  resolutionHeight: number;
  fps: number;
  format: VideoFormat;
  videoBitrateMbps: number;
  audioBitrateKbps: number;
  audioSyncMs: number;
  rotation: RotationAngle;
  flipH: boolean;
  flipV: boolean;
  cropAspect: CropAspect;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  sdStoragePath: string;
  sdSplitGb: 0 | 2 | 4;
  watermarkFree: boolean;
  targetPlatform: TargetPlatform;
}

export interface CaptureProject extends CaptureSettings {
  id: string;
  ownerId: string;
  name: string;
  notes: string;
  createdAtMs: number;
  updatedAtMs: number;
  syncedToCloud: boolean;
}

export interface CaptureRecording {
  id: string;
  ownerId: string;
  projectId: string;
  title: string;
  durationSec: number;
  resolution: string;
  fps: number;
  format: VideoFormat;
  videoBitrateMbps: number;
  fileSizeBytes: number;
  rotation: RotationAngle;
  audioSyncMs: number;
  watermarkFree: boolean;
  storageTarget: string;
  status: RecordingStatus;
  publishedPlatforms: PublishPlatform[];
  createdAtMs: number;
  updatedAtMs: number;
  syncedToCloud: boolean;
  localBlobUrl?: string;
  hasLocalBlob?: boolean;
  mimeType?: string;
}

export interface UserPreference {
  ownerId: string;
  themeMode: ThemeMode;
  defaultOtgProfile: DeviceProfile;
  activeProjectId: string;
}

export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]{1,128}$/,
  PROJECT_NAME_MAX: 80,
  PROJECT_NOTES_MAX: 400,
  SD_PATH_MAX: 180,
  RECORDING_TITLE_MAX: 120,
  RESOLUTION_MIN_W: 320,
  RESOLUTION_MAX_W: 3840,
  RESOLUTION_MIN_H: 240,
  RESOLUTION_MAX_H: 2160,
  FPS_MIN: 15,
  FPS_MAX: 60,
  BITRATE_MIN_MBPS: 1,
  BITRATE_MAX_MBPS: 80,
  AUDIO_MIN_KBPS: 64,
  AUDIO_MAX_KBPS: 320,
  AUDIO_SYNC_MIN_MS: -500,
  AUDIO_SYNC_MAX_MS: 500,
  MAX_PLATFORMS: 6,
} as const;

export const ALLOWED_PUBLISH_PLATFORMS: readonly PublishPlatform[] = [
  'youtube',
  'youtube_shorts',
  'instagram_reels',
  'tiktok',
  'facebook',
] as const;

export interface ResolutionPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  recommendedMbps: number;
  note: string;
}

export const RESOLUTION_PRESETS: ResolutionPreset[] = [
  {
    id: '720p',
    label: '720p HD',
    width: 1280,
    height: 720,
    recommendedMbps: 8,
    note: 'Ideal untuk Micro-USB 2.0 Android 10',
  },
  {
    id: '1080p',
    label: '1080p Full HD',
    width: 1920,
    height: 1080,
    recommendedMbps: 18,
    note: 'Standar produksi & YouTube',
  },
  {
    id: '1080p_vertical',
    label: '1080×1920 Vertikal',
    width: 1080,
    height: 1920,
    recommendedMbps: 16,
    note: 'Shorts, Reels & TikTok 9:16',
  },
  {
    id: '1440p',
    label: '1440p QHD',
    width: 2560,
    height: 1440,
    recommendedMbps: 32,
    note: 'Detail tajam untuk editing',
  },
  {
    id: '4k',
    label: '2160p 4K UHD',
    width: 3840,
    height: 2160,
    recommendedMbps: 55,
    note: 'Resolusi maksimum tanpa tanda air',
  },
];

export interface PlatformSpec {
  id: PublishPlatform;
  label: string;
  aspectHint: string;
  recommendedRotation: RotationAngle;
  recommendedAspect: CropAspect;
  maxDurationSec: number;
  recommendedMbps: number;
  uploadUrl: string;
}

export const PLATFORM_SPECS: PlatformSpec[] = [
  {
    id: 'youtube',
    label: 'YouTube',
    aspectHint: '16:9 Lanskap',
    recommendedRotation: 0,
    recommendedAspect: '16:9',
    maxDurationSec: 43200,
    recommendedMbps: 24,
    uploadUrl: 'https://studio.youtube.com/channel/UC/videos/upload?d=ud',
  },
  {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    aspectHint: '9:16 Vertikal',
    recommendedRotation: 90,
    recommendedAspect: '9:16',
    maxDurationSec: 180,
    recommendedMbps: 16,
    uploadUrl: 'https://studio.youtube.com/channel/UC/videos/upload?d=ud',
  },
  {
    id: 'instagram_reels',
    label: 'Instagram Reels',
    aspectHint: '9:16 Vertikal',
    recommendedRotation: 90,
    recommendedAspect: '9:16',
    maxDurationSec: 90,
    recommendedMbps: 14,
    uploadUrl: 'https://www.instagram.com/',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    aspectHint: '9:16 Vertikal',
    recommendedRotation: 90,
    recommendedAspect: '9:16',
    maxDurationSec: 600,
    recommendedMbps: 14,
    uploadUrl: 'https://www.tiktok.com/creator-center/upload',
  },
  {
    id: 'facebook',
    label: 'Facebook Video',
    aspectHint: '16:9 / 4:5',
    recommendedRotation: 0,
    recommendedAspect: '16:9',
    maxDurationSec: 14400,
    recommendedMbps: 16,
    uploadUrl: 'https://business.facebook.com/latest/composer',
  },
];

export type MultiCamLayout = 'single' | 'split_2' | 'pip' | 'quad_4';
export type PipCorner = 'br' | 'bl' | 'tr' | 'tl';

export interface CameraSlotConfig {
  id: number;
  label: string;
  sourceType: 'demo' | 'usb' | 'yealink_vc800';
  demoFeed: DemoFeedId;
  deviceId: string;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  deviceProfile: 'android10_micro_usb',
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  fps: 60,
  format: 'mp4',
  videoBitrateMbps: 18,
  audioBitrateKbps: 192,
  audioSyncMs: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
  cropAspect: '16:9',
  cropX: 0,
  cropY: 0,
  cropW: 100,
  cropH: 100,
  sdStoragePath: '/storage/sdcard1/DCIM/M2RStudio',
  sdSplitGb: 4,
  watermarkFree: true,
  targetPlatform: 'youtube',
};

export function createDefaultLocalProjects(): CaptureProject[] {
  const now = Date.now();
  return [
    {
      ...DEFAULT_CAPTURE_SETTINGS,
      id: 'proj_android10_default',
      ownerId: 'local_guest',
      name: 'Micro-USB HDMI Studio (Android 10)',
      notes: 'Profil latensi rendah USB 2.0 OTG dengan penyimpanan langsung ke Kartu SD eksternal dan auto-split 4GB FAT32.',
      createdAtMs: now - 3600_000,
      updatedAtMs: now - 600_000,
      syncedToCloud: false,
    },
    {
      ...DEFAULT_CAPTURE_SETTINGS,
      id: 'proj_vertical_reels',
      ownerId: 'local_guest',
      name: 'Konten Vertikal 9:16 (Reels & Shorts)',
      deviceProfile: 'android10_micro_usb',
      resolutionWidth: 1080,
      resolutionHeight: 1920,
      fps: 60,
      videoBitrateMbps: 16,
      rotation: 90,
      cropAspect: '9:16',
      cropX: 28,
      cropY: 0,
      cropW: 44,
      cropH: 100,
      targetPlatform: 'youtube_shorts',
      notes: 'Rotasi 90 derajat real-time + crop 9:16 untuk kamera DSLR yang dipasang vertikal atau crop tengah langsung.',
      createdAtMs: now - 7200_000,
      updatedAtMs: now - 1800_000,
      syncedToCloud: false,
    },
  ];
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned.length > 0 ? cleaned : `id_${Date.now()}`;
}

export function generateSafeDocId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return sanitizeId(`${prefix}_${Date.now()}_${rand}`);
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[idx]}`;
}

export function computeEffectiveOutputDimensions(settings: CaptureSettings): {
  width: number;
  height: number;
} {
  const baseW = clampNumber(Math.round(settings.resolutionWidth), 320, 3840);
  const baseH = clampNumber(Math.round(settings.resolutionHeight), 240, 2160);
  const rotated = settings.rotation === 90 || settings.rotation === 270;

  if (settings.cropAspect === '9:16') {
    return { width: Math.min(baseW, baseH, 1080), height: Math.max(baseW, baseH, 1920) > 2160 ? 1920 : Math.max(baseW, baseH, 1920) };
  }
  if (settings.cropAspect === '1:1') {
    const side = Math.min(baseW, baseH, 1440);
    return { width: side, height: side };
  }
  if (settings.cropAspect === '4:5') {
    const h = Math.min(baseH, 1350);
    const w = Math.round((h * 4) / 5);
    return { width: w, height: h };
  }
  return rotated ? { width: baseH, height: baseW } : { width: baseW, height: baseH };
}
