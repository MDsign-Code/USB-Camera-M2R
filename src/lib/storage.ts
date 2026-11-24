import type { VideoFormat } from '../types/capture';

export interface DirectoryHandleLike {
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

export interface StorageQuotaInfo {
  usageBytes: number;
  quotaBytes: number;
  supported: boolean;
}

export interface CodecSelection {
  mimeType: string;
  extension: 'mp4' | 'webm';
  isNativeMp4: boolean;
  label: string;
}

const DB_NAME = 'kapture_otg_clips_db';
const STORE_NAME = 'clips';

function openClipsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveClipBlobToCache(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openClipsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Graceful fallback if IndexedDB quota is tight
  }
}

export async function loadClipBlobFromCache(id: string): Promise<Blob | null> {
  try {
    const db = await openClipsDb();
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function deleteClipBlobFromCache(id: string): Promise<void> {
  try {
    const db = await openClipsDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore deletion error
  }
}

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickSdCardDirectory(): Promise<{
  handle: DirectoryHandleLike | null;
  error?: string;
}> {
  if (!supportsDirectoryPicker()) {
    return {
      handle: null,
      error:
        'Browser ini membatasi File System Access API. Rekaman tetap tersimpan langsung dengan streaming chunk berkecepatan tinggi ke folder unduhan / Kartu SD.',
    };
  }
  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (opts: { mode: string }) => Promise<DirectoryHandleLike>;
      }
    ).showDirectoryPicker;
    const handle = await picker({ mode: 'readwrite' });
    return { handle };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { handle: null };
    }
    return {
      handle: null,
      error:
        'Akses direktori langsung dibatasi di dalam preview iframe. Saat dijalankan langsung di Chrome Android / Desktop, folder Kartu SD dapat dipasang langsung.',
    };
  }
}

export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usageBytes: 0, quotaBytes: 0, supported: false };
  }
  try {
    const est = await navigator.storage.estimate();
    return {
      usageBytes: est.usage ?? 0,
      quotaBytes: est.quota ?? 0,
      supported: true,
    };
  } catch {
    return { usageBytes: 0, quotaBytes: 0, supported: false };
  }
}

export function negotiateBestCodec(preferredFormat: VideoFormat): CodecSelection {
  if (typeof MediaRecorder === 'undefined') {
    return {
      mimeType: 'video/mp4',
      extension: 'mp4',
      isNativeMp4: true,
      label: 'MP4 (H.264 / AAC)',
    };
  }

  const mp4Candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', label: 'MP4 Hardware (H.264 + AAC)' },
    { mime: 'video/mp4;codecs=avc1.4D4028,mp4a.40.2', label: 'MP4 High Profile (H.264 + AAC)' },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', label: 'MP4 (AVC1 + AAC)' },
    { mime: 'video/mp4', label: 'MP4 Native Container' },
  ];

  const webmCandidates = [
    { mime: 'video/webm;codecs=vp9,opus', label: 'WebM High-Res (VP9 + Opus)' },
    { mime: 'video/webm;codecs=h264,opus', label: 'WebM Low-Latency (H.264 + Opus)' },
    { mime: 'video/webm;codecs=vp8,opus', label: 'WebM Compatible (VP8 + Opus)' },
    { mime: 'video/webm', label: 'WebM Container' },
  ];

  const ordered =
    preferredFormat === 'mp4'
      ? [...mp4Candidates, ...webmCandidates]
      : [...webmCandidates, ...mp4Candidates];

  for (const candidate of ordered) {
    if (MediaRecorder.isTypeSupported(candidate.mime)) {
      const isMp4 = candidate.mime.startsWith('video/mp4');
      return {
        mimeType: candidate.mime,
        extension: isMp4 ? 'mp4' : 'webm',
        isNativeMp4: isMp4,
        label: candidate.label,
      };
    }
  }

  return {
    mimeType: '',
    extension: preferredFormat,
    isNativeMp4: preferredFormat === 'mp4',
    label: preferredFormat === 'mp4' ? 'MP4 Default' : 'WebM Default',
  };
}

export function estimateRecordingSize(videoMbps: number, audioKbps: number): {
  mbPerMinute: number;
  gbPerHour: number;
  minutesPer4Gb: number;
} {
  const totalBitsPerSec = videoMbps * 1_000_000 + audioKbps * 1_000;
  const bytesPerSec = totalBitsPerSec / 8;
  const mbPerMinute = (bytesPerSec * 60) / (1024 * 1024);
  const gbPerHour = (mbPerMinute * 60) / 1024;
  const minutesPer4Gb = mbPerMinute > 0 ? (4 * 1024) / mbPerMinute : 0;
  return { mbPerMinute, gbPerHour, minutesPer4Gb };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
