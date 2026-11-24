import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { Cloud, Film, FolderSync, LogOut, Smartphone, Video } from 'lucide-react';
import {
  createDefaultLocalProjects,
  generateSafeDocId,
  type CaptureProject,
  type CaptureRecording,
  type CaptureSettings,
  type DeviceProfile,
  type PublishPlatform,
  type ThemeMode,
  type VideoFormat,
} from './types/capture';
import {
  auth,
  createCloudRecording,
  deleteCloudProject,
  deleteCloudRecording,
  loadUserPreferences,
  saveCloudProject,
  saveUserPreferences,
  signInWithGoogle,
  signOutUser,
  subscribeProjectRecordings,
  subscribeUserProjects,
  updateCloudRecordingExport,
  updateCloudRecordingPublish,
} from './lib/firebase';
import { deleteClipBlobFromCache, type DirectoryHandleLike } from './lib/storage';
import { useThemeMode } from './hooks/useThemeMode';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CaptureStudio } from './components/CaptureStudio';
import { ExportPublishView } from './components/ExportPublishView';
import { ProjectsCloudView } from './components/ProjectsCloudView';
import { DeviceOtgView } from './components/DeviceOtgView';
import { OfflineIndicator } from './components/PWAInstallButton';

type AppTab = 'capture' | 'export' | 'projects' | 'device';

const LOCAL_PROJECTS_KEY = 'kapture_otg_local_projects_v1';
const LOCAL_RECORDINGS_KEY = 'kapture_otg_local_recordings_v1';

function loadLocalProjects(): CaptureProject[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CaptureProject[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // fallback to defaults
  }
  return createDefaultLocalProjects();
}

function loadLocalRecordings(): CaptureRecording[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_RECORDINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CaptureRecording[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function StudioWorkspace() {
  const [activeTab, setActiveTab] = useState<AppTab>('capture');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const [localProjects, setLocalProjects] = useState<CaptureProject[]>(loadLocalProjects);
  const [cloudProjects, setCloudProjects] = useState<CaptureProject[]>([]);
  const [localRecordings, setLocalRecordings] = useState<CaptureRecording[]>(loadLocalRecordings);
  const [cloudRecordings, setCloudRecordings] = useState<CaptureRecording[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>(() => loadLocalProjects()[0].id);
  const [sdDirectory, setSdDirectory] = useState<DirectoryHandleLike | null>(null);
  const [isSavingProject, setIsSavingProject] = useState<boolean>(false);

  const { themeMode, resolvedTheme, setThemeMode } = useThemeMode();
  const autoSaveTimerRef = useRef<number | null>(null);

  // Persist local guest projects/recordings cleanly
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCAL_PROJECTS_KEY, JSON.stringify(localProjects));
    } catch {
      // ignore quota
    }
  }, [localProjects]);

  useEffect(() => {
    try {
      const serializable = localRecordings.map(({ localBlobUrl: _ignored, ...rest }) => rest);
      window.localStorage.setItem(LOCAL_RECORDINGS_KEY, JSON.stringify(serializable));
    } catch {
      // ignore
    }
  }, [localRecordings]);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      setCloudError(null);
      if (!nextUser) {
        setCloudProjects([]);
        setCloudRecordings([]);
      }
    });
    return () => unsub();
  }, []);

  // Load cloud preferences once authenticated
  useEffect(() => {
    if (!authReady || !user) return;
    void loadUserPreferences(user.uid)
      .then((pref) => {
        if (!pref) return;
        setThemeMode(pref.themeMode);
        if (pref.activeProjectId) {
          setActiveProjectId(pref.activeProjectId);
        }
      })
      .catch(() => {
        // Non-blocking preference load
      });
  }, [authReady, setThemeMode, user]);

  // Subscribe to user's Cloud Projects in real time
  useEffect(() => {
    if (!authReady || !user) return;
    const unsub = subscribeUserProjects(
      user.uid,
      (items) => {
        setCloudProjects(items);
        if (items.length > 0) {
          setActiveProjectId((curr) =>
            items.some((p) => p.id === curr) || localProjects.some((p) => p.id === curr)
              ? curr
              : items[0].id
          );
        }
      },
      (err) => {
        setCloudError(err.message);
      }
    );
    return () => unsub();
  }, [authReady, localProjects, user]);

  // Combined project list (cloud projects take precedence over local duplicates)
  const allProjects = useMemo(() => {
    const map = new Map<string, CaptureProject>();
    for (const lp of localProjects) {
      map.set(lp.id, lp);
    }
    for (const cp of cloudProjects) {
      map.set(cp.id, cp);
    }
    return Array.from(map.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [cloudProjects, localProjects]);

  const activeProject = useMemo(
    () => allProjects.find((p) => p.id === activeProjectId) ?? allProjects[0],
    [activeProjectId, allProjects]
  );

  // Subscribe to active project's Cloud Recordings when activeProject is synced to cloud
  useEffect(() => {
    if (!authReady || !user || !activeProject?.syncedToCloud) {
      setCloudRecordings([]);
      return;
    }
    const unsub = subscribeProjectRecordings(
      activeProject.id,
      user.uid,
      (items) => setCloudRecordings(items),
      (err) => setCloudError(err.message)
    );
    return () => unsub();
  }, [activeProject?.id, activeProject?.syncedToCloud, authReady, user]);

  // Merge cloud recordings with local blobs for instant playback
  const activeRecordings = useMemo(() => {
    const map = new Map<string, CaptureRecording>();
    for (const lr of localRecordings) {
      if (lr.projectId === activeProject.id) {
        map.set(lr.id, lr);
      }
    }
    for (const cr of cloudRecordings) {
      const localMatch = map.get(cr.id);
      map.set(cr.id, {
        ...cr,
        localBlobUrl: localMatch?.localBlobUrl,
        hasLocalBlob: localMatch?.hasLocalBlob,
        mimeType: localMatch?.mimeType,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [activeProject.id, cloudRecordings, localRecordings]);

  const handleSignIn = useCallback(async () => {
    setAuthBusy(true);
    setCloudError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      if (err instanceof Error && !err.message.includes('popup-closed-by-user')) {
        setCloudError('Gagal masuk ke Google Cloud Sync. Pastikan popup diizinkan.');
      }
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    try {
      await signOutUser();
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const persistProject = useCallback(
    async (updated: CaptureProject) => {
      setLocalProjects((prev) => {
        const exists = prev.some((p) => p.id === updated.id);
        return exists ? prev.map((p) => (p.id === updated.id ? updated : p)) : [updated, ...prev];
      });

      if (user) {
        setIsSavingProject(true);
        try {
          const isCloudDoc = cloudProjects.some((p) => p.id === updated.id);
          await saveCloudProject(updated, user.uid, isCloudDoc);
          setLocalProjects((prev) =>
            prev.map((p) =>
              p.id === updated.id ? { ...p, ownerId: user.uid, syncedToCloud: true } : p
            )
          );
        } catch (err) {
          setCloudError(err instanceof Error ? err.message : 'Gagal menyimpan proyek ke cloud.');
        } finally {
          setIsSavingProject(false);
        }
      }
    },
    [cloudProjects, user]
  );

  // Debounced live capture settings update so sliders stay 60fps smooth
  const handleUpdateSettings = useCallback(
    (patch: Partial<CaptureSettings>) => {
      const nextProject: CaptureProject = {
        ...activeProject,
        ...patch,
        updatedAtMs: Date.now(),
      };

      setLocalProjects((prev) => {
        const exists = prev.some((p) => p.id === nextProject.id);
        return exists
          ? prev.map((p) => (p.id === nextProject.id ? nextProject : p))
          : [nextProject, ...prev];
      });

      if (user && activeProject.syncedToCloud) {
        if (autoSaveTimerRef.current) {
          window.clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = window.setTimeout(() => {
          void saveCloudProject(nextProject, user.uid, true).catch(() => {
            // Silent debounce retry on manual save
          });
        }, 900);
      }
    },
    [activeProject, user]
  );

  const handleSaveProjectNow = useCallback(() => {
    void persistProject({ ...activeProject, updatedAtMs: Date.now() });
  }, [activeProject, persistProject]);

  const handleCreateProject = useCallback(
    async (project: CaptureProject) => {
      const ready: CaptureProject = {
        ...project,
        ownerId: user?.uid ?? 'local_guest',
      };
      setActiveProjectId(ready.id);
      await persistProject(ready);
      setActiveTab('capture');
    },
    [persistProject, user]
  );

  const handleDuplicateProject = useCallback(
    async (project: CaptureProject) => {
      const now = Date.now();
      const copy: CaptureProject = {
        ...project,
        id: generateSafeDocId('proj'),
        ownerId: user?.uid ?? 'local_guest',
        name: `${project.name.slice(0, 68)} (Salinan)`,
        createdAtMs: now,
        updatedAtMs: now,
        syncedToCloud: false,
      };
      setActiveProjectId(copy.id);
      await persistProject(copy);
    },
    [persistProject, user]
  );

  const handleDeleteProject = useCallback(
    async (project: CaptureProject) => {
      setLocalProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (user && project.syncedToCloud) {
        await deleteCloudProject(project.id);
      }
      if (activeProjectId === project.id) {
        const remaining = allProjects.filter((p) => p.id !== project.id);
        if (remaining.length > 0) setActiveProjectId(remaining[0].id);
      }
    },
    [activeProjectId, allProjects, user]
  );

  const handleSyncLocalToCloud = useCallback(async () => {
    if (!user) return;
    setIsSavingProject(true);
    try {
      for (const proj of allProjects) {
        if (!proj.syncedToCloud) {
          await saveCloudProject(proj, user.uid, false);
        }
      }
      setLocalProjects((prev) =>
        prev.map((p) => ({ ...p, ownerId: user.uid, syncedToCloud: true }))
      );
    } finally {
      setIsSavingProject(false);
    }
  }, [allProjects, user]);

  const handleRecordingFinished = useCallback(
    async (recording: CaptureRecording) => {
      const prepared: CaptureRecording = {
        ...recording,
        ownerId: user?.uid ?? 'local_guest',
      };
      setLocalRecordings((prev) => [prepared, ...prev]);

      if (user) {
        try {
          // Ensure parent project exists in cloud before creating subcollection recording (Master Gate)
          if (!activeProject.syncedToCloud) {
            await saveCloudProject(activeProject, user.uid, false);
            setLocalProjects((prev) =>
              prev.map((p) =>
                p.id === activeProject.id ? { ...p, ownerId: user.uid, syncedToCloud: true } : p
              )
            );
          }
          await createCloudRecording(prepared, user.uid);
          setLocalRecordings((prev) =>
            prev.map((r) => (r.id === prepared.id ? { ...r, syncedToCloud: true } : r))
          );
        } catch (err) {
          setCloudError(err instanceof Error ? err.message : 'Gagal sinkronisasi riwayat rekaman.');
        }
      }
    },
    [activeProject, user]
  );

  const handleExportComplete = useCallback(
    async (
      recording: CaptureRecording,
      meta: {
        title: string;
        resolution: string;
        format: VideoFormat;
        videoBitrateMbps: number;
        fileSizeBytes: number;
        storageTarget: string;
      }
    ) => {
      setLocalRecordings((prev) =>
        prev.map((r) =>
          r.id === recording.id
            ? { ...r, ...meta, status: 'exported', updatedAtMs: Date.now() }
            : r
        )
      );
      if (user && recording.syncedToCloud) {
        await updateCloudRecordingExport(recording.projectId, recording.id, meta);
      }
    },
    [user]
  );

  const handleMarkPublished = useCallback(
    async (recording: CaptureRecording, platform: PublishPlatform) => {
      const nextPlatforms = Array.from(new Set([...recording.publishedPlatforms, platform]));
      setLocalRecordings((prev) =>
        prev.map((r) =>
          r.id === recording.id
            ? {
                ...r,
                status: 'published',
                publishedPlatforms: nextPlatforms,
                updatedAtMs: Date.now(),
              }
            : r
        )
      );
      if (user && recording.syncedToCloud) {
        await updateCloudRecordingPublish(recording.projectId, recording.id, nextPlatforms);
      }
    },
    [user]
  );

  const handleDeleteRecording = useCallback(
    async (recording: CaptureRecording) => {
      await deleteClipBlobFromCache(recording.id);
      setLocalRecordings((prev) => prev.filter((r) => r.id !== recording.id));
      if (user && recording.syncedToCloud) {
        await deleteCloudRecording(recording.projectId, recording.id);
      }
    },
    [user]
  );

  const handleChangeThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode);
      if (user) {
        void saveUserPreferences(user.uid, {
          themeMode: mode,
          defaultOtgProfile: activeProject.deviceProfile,
          activeProjectId: activeProject.id,
        }).catch(() => {
          // non-blocking
        });
      }
    },
    [activeProject.deviceProfile, activeProject.id, setThemeMode, user]
  );

  const handleChangeDeviceProfile = useCallback(
    (profile: DeviceProfile) => {
      handleUpdateSettings({ deviceProfile: profile });
      if (user) {
        void saveUserPreferences(user.uid, {
          themeMode,
          defaultOtgProfile: profile,
          activeProjectId: activeProject.id,
        }).catch(() => {
          // non-blocking
        });
      }
    },
    [activeProject.id, handleUpdateSettings, themeMode, user]
  );

  const navItems: { id: AppTab; label: string; icon: typeof Video }[] = [
    { id: 'capture', label: 'Rekam', icon: Video },
    { id: 'export', label: 'Ekspor', icon: Film },
    { id: 'projects', label: 'Proyek', icon: FolderSync },
    { id: 'device', label: 'Perangkat', icon: Smartphone },
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-zinc-50 dark:bg-[#090B0E] text-zinc-900 dark:text-zinc-100 transition-colors duration-200">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-14 px-4 sm:px-6 bg-white/90 dark:bg-[#090B0E]/90 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800/80 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('capture')}
          className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          KaptureOTG
        </button>

        {/* Zone 2: 4 single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
                  active
                    ? 'border-rose-600 text-zinc-900 dark:text-zinc-100 font-semibold'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action */}
        <div className="shrink-0">
          {user ? (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleSignOut()}
              title={`Masuk sebagai ${user.email || 'Pengguna'} — Klik untuk keluar`}
              className="min-h-[36px] px-3.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <Cloud className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="max-w-[120px] truncate">{user.displayName || user.email}</span>
              <LogOut className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          ) : (
            <button
              type="button"
              disabled={authBusy}
              onClick={() => void handleSignIn()}
              className="min-h-[36px] px-4 py-1.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90 text-xs font-semibold whitespace-nowrap shrink-0 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {authBusy ? 'Menghubungkan...' : 'Masuk Cloud'}
            </button>
          )}
        </div>
      </header>

      {/* Main Studio Viewport */}
      <main className="flex-1 w-full max-w-[1400px] mx-auto px-4 sm:px-6 py-5 pb-20 md:pb-8 space-y-4">
        {cloudError && (
          <div className="px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
            <span className="truncate">{cloudError}</span>
            <button
              type="button"
              onClick={() => setCloudError(null)}
              className="font-semibold underline whitespace-nowrap"
            >
              Tutup
            </button>
          </div>
        )}

        {activeTab === 'capture' && (
          <CaptureStudio
            activeProject={activeProject}
            isCloudSignedIn={Boolean(user)}
            isSavingProject={isSavingProject}
            sdDirectory={sdDirectory}
            onMountSdDirectory={setSdDirectory}
            onUpdateSettings={handleUpdateSettings}
            onSaveProjectNow={handleSaveProjectNow}
            onRecordingFinished={handleRecordingFinished}
            onNavigateExport={() => setActiveTab('export')}
            onNavigateApkExport={() => {
              setActiveTab('device');
              setTimeout(() => {
                document
                  .getElementById('ekspor-apk-android')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 80);
            }}
          />
        )}

        {activeTab === 'export' && (
          <ExportPublishView
            recordings={activeRecordings}
            sdDirectory={sdDirectory}
            onExportComplete={handleExportComplete}
            onMarkPublished={handleMarkPublished}
            onDeleteRecording={handleDeleteRecording}
            onBackToCapture={() => setActiveTab('capture')}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsCloudView
            projects={allProjects}
            activeProjectId={activeProject.id}
            userEmail={user?.email ?? null}
            isSyncing={isSavingProject}
            onSelectProject={(id) => {
              setActiveProjectId(id);
              setActiveTab('capture');
              if (user) {
                void saveUserPreferences(user.uid, {
                  themeMode,
                  defaultOtgProfile: activeProject.deviceProfile,
                  activeProjectId: id,
                }).catch(() => {});
              }
            }}
            onCreateProject={handleCreateProject}
            onDuplicateProject={handleDuplicateProject}
            onDeleteProject={handleDeleteProject}
            onSignIn={handleSignIn}
            onSyncLocalToCloud={handleSyncLocalToCloud}
          />
        )}

        {activeTab === 'device' && (
          <DeviceOtgView
            activeProject={activeProject}
            themeMode={themeMode}
            resolvedTheme={resolvedTheme}
            onChangeThemeMode={handleChangeThemeMode}
            onChangeProfile={handleChangeDeviceProfile}
          />
        )}
      </main>

      {/* Mobile Bottom Thumb Navigation (<= 56px, under 15% mobile sticky cap with 56px top bar) */}
      <OfflineIndicator />
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 h-14 pb-safe bg-white/95 dark:bg-[#090B0E]/95 backdrop-blur-md border-t border-zinc-200 dark:border-zinc-800 grid grid-cols-4 items-center">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StudioWorkspace />
    </ErrorBoundary>
  );
}
