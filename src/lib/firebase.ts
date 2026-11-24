import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  ALLOWED_PUBLISH_PLATFORMS,
  BLUEPRINT_LIMITS,
  clampNumber,
  sanitizeId,
  type CaptureProject,
  type CaptureRecording,
  type PublishPlatform,
  type UserPreference,
} from '../types/capture';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

function toMillis(ts: unknown): number {
  if (ts instanceof Timestamp) {
    return ts.toMillis();
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts;
  }
  return Date.now();
}

function sanitizeProjectPayload(project: CaptureProject, ownerId: string) {
  const cropX = clampNumber(Number(project.cropX), 0, 95);
  const cropY = clampNumber(Number(project.cropY), 0, 95);
  const cropW = clampNumber(Number(project.cropW), 5, Math.max(5, 100 - cropX));
  const cropH = clampNumber(Number(project.cropH), 5, Math.max(5, 100 - cropY));

  return {
    ownerId: sanitizeId(ownerId),
    name: (project.name.trim() || 'Proyek Tanpa Nama').slice(0, BLUEPRINT_LIMITS.PROJECT_NAME_MAX),
    deviceProfile: project.deviceProfile,
    resolutionWidth: clampNumber(
      Math.round(project.resolutionWidth),
      BLUEPRINT_LIMITS.RESOLUTION_MIN_W,
      BLUEPRINT_LIMITS.RESOLUTION_MAX_W
    ),
    resolutionHeight: clampNumber(
      Math.round(project.resolutionHeight),
      BLUEPRINT_LIMITS.RESOLUTION_MIN_H,
      BLUEPRINT_LIMITS.RESOLUTION_MAX_H
    ),
    fps: clampNumber(Math.round(project.fps), BLUEPRINT_LIMITS.FPS_MIN, BLUEPRINT_LIMITS.FPS_MAX),
    format: project.format,
    videoBitrateMbps: clampNumber(
      Number(project.videoBitrateMbps),
      BLUEPRINT_LIMITS.BITRATE_MIN_MBPS,
      BLUEPRINT_LIMITS.BITRATE_MAX_MBPS
    ),
    audioBitrateKbps: clampNumber(
      Math.round(project.audioBitrateKbps),
      BLUEPRINT_LIMITS.AUDIO_MIN_KBPS,
      BLUEPRINT_LIMITS.AUDIO_MAX_KBPS
    ),
    audioSyncMs: clampNumber(
      Math.round(project.audioSyncMs),
      BLUEPRINT_LIMITS.AUDIO_SYNC_MIN_MS,
      BLUEPRINT_LIMITS.AUDIO_SYNC_MAX_MS
    ),
    rotation: project.rotation,
    flipH: Boolean(project.flipH),
    flipV: Boolean(project.flipV),
    cropAspect: project.cropAspect,
    cropX,
    cropY,
    cropW,
    cropH,
    sdStoragePath: (project.sdStoragePath.trim() || '/storage/sdcard1/DCIM/KaptureOTG').slice(
      0,
      BLUEPRINT_LIMITS.SD_PATH_MAX
    ),
    sdSplitGb: project.sdSplitGb,
    watermarkFree: Boolean(project.watermarkFree),
    targetPlatform: project.targetPlatform,
    notes: project.notes.slice(0, BLUEPRINT_LIMITS.PROJECT_NOTES_MAX),
  };
}

export function subscribeUserProjects(
  userId: string,
  onData: (projects: CaptureProject[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = 'projects';
  const q = query(collection(db, path), where('ownerId', '==', userId));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: CaptureProject[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? userId),
          name: String(data.name ?? 'Proyek'),
          deviceProfile: data.deviceProfile ?? 'android10_micro_usb',
          resolutionWidth: Number(data.resolutionWidth ?? 1920),
          resolutionHeight: Number(data.resolutionHeight ?? 1080),
          fps: Number(data.fps ?? 60),
          format: data.format ?? 'mp4',
          videoBitrateMbps: Number(data.videoBitrateMbps ?? 18),
          audioBitrateKbps: Number(data.audioBitrateKbps ?? 192),
          audioSyncMs: Number(data.audioSyncMs ?? 0),
          rotation: data.rotation ?? 0,
          flipH: Boolean(data.flipH),
          flipV: Boolean(data.flipV),
          cropAspect: data.cropAspect ?? '16:9',
          cropX: Number(data.cropX ?? 0),
          cropY: Number(data.cropY ?? 0),
          cropW: Number(data.cropW ?? 100),
          cropH: Number(data.cropH ?? 100),
          sdStoragePath: String(data.sdStoragePath ?? '/storage/sdcard1/DCIM/KaptureOTG'),
          sdSplitGb: data.sdSplitGb ?? 4,
          watermarkFree: Boolean(data.watermarkFree ?? true),
          targetPlatform: data.targetPlatform ?? 'youtube',
          notes: String(data.notes ?? ''),
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
          syncedToCloud: true,
        };
      });
      items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function saveCloudProject(
  project: CaptureProject,
  userId: string,
  isExistingCloudDoc: boolean
): Promise<void> {
  const safeProjectId = sanitizeId(project.id);
  const docPath = `projects/${safeProjectId}`;
  const docRef = doc(db, 'projects', safeProjectId);
  const payload = sanitizeProjectPayload(project, userId);

  try {
    if (isExistingCloudDoc) {
      const { ownerId: _ignored, ...updatableFields } = payload;
      await updateDoc(docRef, {
        ...updatableFields,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(
      error,
      isExistingCloudDoc ? OperationType.UPDATE : OperationType.CREATE,
      docPath
    );
  }
}

export async function deleteCloudProject(projectId: string): Promise<void> {
  const safeId = sanitizeId(projectId);
  const docPath = `projects/${safeId}`;
  try {
    await deleteDoc(doc(db, 'projects', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export function subscribeProjectRecordings(
  projectId: string,
  userId: string,
  onData: (recordings: CaptureRecording[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const safeProjectId = sanitizeId(projectId);
  const path = `projects/${safeProjectId}/recordings`;
  const q = query(
    collection(db, 'projects', safeProjectId, 'recordings'),
    where('ownerId', '==', userId),
    where('projectId', '==', safeProjectId)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const items: CaptureRecording[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: String(data.ownerId ?? userId),
          projectId: String(data.projectId ?? safeProjectId),
          title: String(data.title ?? 'Rekaman'),
          durationSec: Number(data.durationSec ?? 0),
          resolution: String(data.resolution ?? '1920x1080'),
          fps: Number(data.fps ?? 60),
          format: data.format ?? 'mp4',
          videoBitrateMbps: Number(data.videoBitrateMbps ?? 18),
          fileSizeBytes: Number(data.fileSizeBytes ?? 0),
          rotation: data.rotation ?? 0,
          audioSyncMs: Number(data.audioSyncMs ?? 0),
          watermarkFree: Boolean(data.watermarkFree ?? true),
          storageTarget: String(data.storageTarget ?? '/storage/sdcard1/DCIM/KaptureOTG'),
          status: data.status ?? 'recorded',
          publishedPlatforms: Array.isArray(data.publishedPlatforms)
            ? data.publishedPlatforms.filter((p: unknown): p is PublishPlatform =>
                ALLOWED_PUBLISH_PLATFORMS.includes(p as PublishPlatform)
              )
            : [],
          createdAtMs: toMillis(data.createdAt),
          updatedAtMs: toMillis(data.updatedAt),
          syncedToCloud: true,
        };
      });
      items.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}

export async function createCloudRecording(
  recording: CaptureRecording,
  userId: string
): Promise<void> {
  const safeProjectId = sanitizeId(recording.projectId);
  const safeRecordingId = sanitizeId(recording.id);
  const docPath = `projects/${safeProjectId}/recordings/${safeRecordingId}`;
  const docRef = doc(db, 'projects', safeProjectId, 'recordings', safeRecordingId);

  const safePlatforms = recording.publishedPlatforms
    .filter((p) => ALLOWED_PUBLISH_PLATFORMS.includes(p))
    .slice(0, BLUEPRINT_LIMITS.MAX_PLATFORMS);

  try {
    await setDoc(docRef, {
      ownerId: sanitizeId(userId),
      projectId: safeProjectId,
      title: (recording.title.trim() || 'Rekaman Baru').slice(
        0,
        BLUEPRINT_LIMITS.RECORDING_TITLE_MAX
      ),
      durationSec: clampNumber(Number(recording.durationSec), 0, 86400),
      resolution: (recording.resolution.trim() || '1920x1080').slice(0, 32),
      fps: clampNumber(Math.round(recording.fps), BLUEPRINT_LIMITS.FPS_MIN, BLUEPRINT_LIMITS.FPS_MAX),
      format: recording.format,
      videoBitrateMbps: clampNumber(
        Number(recording.videoBitrateMbps),
        BLUEPRINT_LIMITS.BITRATE_MIN_MBPS,
        BLUEPRINT_LIMITS.BITRATE_MAX_MBPS
      ),
      fileSizeBytes: clampNumber(Math.round(recording.fileSizeBytes), 0, 107374182400),
      rotation: recording.rotation,
      audioSyncMs: clampNumber(
        Math.round(recording.audioSyncMs),
        BLUEPRINT_LIMITS.AUDIO_SYNC_MIN_MS,
        BLUEPRINT_LIMITS.AUDIO_SYNC_MAX_MS
      ),
      watermarkFree: Boolean(recording.watermarkFree),
      storageTarget: (recording.storageTarget.trim() || '/storage/sdcard1/DCIM/KaptureOTG').slice(
        0,
        BLUEPRINT_LIMITS.SD_PATH_MAX
      ),
      status: recording.status,
      publishedPlatforms: safePlatforms,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function updateCloudRecordingPublish(
  projectId: string,
  recordingId: string,
  platforms: PublishPlatform[]
): Promise<void> {
  const safeProjectId = sanitizeId(projectId);
  const safeRecordingId = sanitizeId(recordingId);
  const docPath = `projects/${safeProjectId}/recordings/${safeRecordingId}`;
  const docRef = doc(db, 'projects', safeProjectId, 'recordings', safeRecordingId);

  const uniquePlatforms = Array.from(
    new Set(platforms.filter((p) => ALLOWED_PUBLISH_PLATFORMS.includes(p)))
  ).slice(0, BLUEPRINT_LIMITS.MAX_PLATFORMS);

  try {
    await updateDoc(docRef, {
      status: 'published',
      publishedPlatforms: uniquePlatforms,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function updateCloudRecordingExport(
  projectId: string,
  recordingId: string,
  meta: {
    title: string;
    resolution: string;
    format: 'mp4' | 'webm';
    videoBitrateMbps: number;
    fileSizeBytes: number;
    storageTarget: string;
  }
): Promise<void> {
  const safeProjectId = sanitizeId(projectId);
  const safeRecordingId = sanitizeId(recordingId);
  const docPath = `projects/${safeProjectId}/recordings/${safeRecordingId}`;
  const docRef = doc(db, 'projects', safeProjectId, 'recordings', safeRecordingId);

  try {
    await updateDoc(docRef, {
      title: meta.title.slice(0, BLUEPRINT_LIMITS.RECORDING_TITLE_MAX),
      resolution: meta.resolution.slice(0, 32),
      format: meta.format,
      videoBitrateMbps: clampNumber(
        meta.videoBitrateMbps,
        BLUEPRINT_LIMITS.BITRATE_MIN_MBPS,
        BLUEPRINT_LIMITS.BITRATE_MAX_MBPS
      ),
      fileSizeBytes: clampNumber(Math.round(meta.fileSizeBytes), 0, 107374182400),
      storageTarget: meta.storageTarget.slice(0, BLUEPRINT_LIMITS.SD_PATH_MAX),
      status: 'exported',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteCloudRecording(
  projectId: string,
  recordingId: string
): Promise<void> {
  const safeProjectId = sanitizeId(projectId);
  const safeRecordingId = sanitizeId(recordingId);
  const docPath = `projects/${safeProjectId}/recordings/${safeRecordingId}`;
  try {
    await deleteDoc(doc(db, 'projects', safeProjectId, 'recordings', safeRecordingId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function loadUserPreferences(userId: string): Promise<UserPreference | null> {
  const safeUid = sanitizeId(userId);
  const docPath = `userPreferences/${safeUid}`;
  try {
    const snap = await getDoc(doc(db, 'userPreferences', safeUid));
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      ownerId: safeUid,
      themeMode: data.themeMode ?? 'auto',
      defaultOtgProfile: data.defaultOtgProfile ?? 'android10_micro_usb',
      activeProjectId: String(data.activeProjectId ?? ''),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
  }
}

export async function saveUserPreferences(
  userId: string,
  pref: Omit<UserPreference, 'ownerId'>
): Promise<void> {
  const safeUid = sanitizeId(userId);
  const docPath = `userPreferences/${safeUid}`;
  const docRef = doc(db, 'userPreferences', safeUid);
  try {
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      await updateDoc(docRef, {
        themeMode: pref.themeMode,
        defaultOtgProfile: pref.defaultOtgProfile,
        activeProjectId: pref.activeProjectId.slice(0, 128),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        ownerId: safeUid,
        themeMode: pref.themeMode,
        defaultOtgProfile: pref.defaultOtgProfile,
        activeProjectId: pref.activeProjectId.slice(0, 128),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
  }
}
