import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Cloud,
  Crop,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Gamepad2,
  Grid3X3,
  HardDrive,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Radio,
  RefreshCw,
  RotateCw,
  Save,
  Sliders,
  Square,
  Usb,
  Volume2,
} from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  computeEffectiveOutputDimensions,
  formatDuration,
  formatFileSize,
  generateSafeDocId,
  RESOLUTION_PRESETS,
  type CameraSlotConfig,
  type CaptureProject,
  type CaptureRecording,
  type CaptureSettings,
  type CropAspect,
  type DemoFeedId,
  type MultiCamLayout,
  type PipCorner,
  type RotationAngle,
} from '../types/capture';
import {
  estimateRecordingSize,
  negotiateBestCodec,
  pickSdCardDirectory,
  saveClipBlobToCache,
  type DirectoryHandleLike,
} from '../lib/storage';
import { PWAInstallButton } from './PWAInstallButton';
import {
  YealinkRemotePanel,
  type YealinkPreset,
  type YealinkPtzState,
} from './YealinkRemotePanel';
import {
  isLikelyExternalUsbCamera,
  useUsbOtgDetector,
} from '../hooks/useUsbOtgDetector';

const DEMO_FEEDS: { id: DemoFeedId; label: string; src?: string }[] = [
  {
    id: 'studio_desk',
    label: 'HDMI 1: Meja Studio',
    src: '/src/assets/images/hdmi_feed_studio_desk_1795502804107.jpg',
  },
  {
    id: 'coffee_barista',
    label: 'HDMI 2: Barista (9:16)',
    src: '/src/assets/images/hdmi_feed_street_cinematic_1795502803364.jpg',
  },
  {
    id: 'smpte_bars',
    label: 'Sinyal Kalibrasi SMPTE',
  },
];

const INITIAL_CAMERA_SLOTS: CameraSlotConfig[] = [
  {
    id: 1,
    label: 'Kamera 1 (Utama)',
    sourceType: 'demo',
    demoFeed: 'studio_desk',
    deviceId: '',
  },
  {
    id: 2,
    label: 'Kamera 2 (Yealink VC800)',
    sourceType: 'yealink_vc800',
    demoFeed: 'coffee_barista',
    deviceId: '',
  },
  {
    id: 3,
    label: 'Kamera 3 (HDMI B)',
    sourceType: 'demo',
    demoFeed: 'coffee_barista',
    deviceId: '',
  },
  {
    id: 4,
    label: 'Kamera 4 (SMPTE / Aux)',
    sourceType: 'demo',
    demoFeed: 'smpte_bars',
    deviceId: '',
  },
];

const INITIAL_YEALINK_PRESETS: YealinkPreset[] = [
  { slot: 1, label: 'Wide', pan: 0, tilt: 0, zoom: 1.0 },
  { slot: 2, label: 'Host', pan: -20, tilt: -8, zoom: 2.8 },
  { slot: 3, label: 'Tamu', pan: 24, tilt: -6, zoom: 2.6 },
  { slot: 4, label: 'Meja', pan: 0, tilt: 22, zoom: 3.5 },
  { slot: 5, label: 'Close', pan: 0, tilt: -12, zoom: 5.5 },
  { slot: 6, label: 'Detail', pan: 12, tilt: 8, zoom: 8.0 },
];

type InspectorTab = 'video' | 'multicam' | 'vc800' | 'transform' | 'audio' | 'storage';

interface CaptureStudioProps {
  activeProject: CaptureProject;
  isCloudSignedIn: boolean;
  isSavingProject: boolean;
  sdDirectory: DirectoryHandleLike | null;
  onMountSdDirectory: (handle: DirectoryHandleLike | null) => void;
  onUpdateSettings: (patch: Partial<CaptureSettings>) => void;
  onSaveProjectNow: () => void;
  onRecordingFinished: (recording: CaptureRecording, blob: Blob) => Promise<void>;
  onNavigateExport: () => void;
  onNavigateApkExport: () => void;
}

export function CaptureStudio({
  activeProject,
  isCloudSignedIn,
  isSavingProject,
  sdDirectory,
  onMountSdDirectory,
  onUpdateSettings,
  onSaveProjectNow,
  onRecordingFinished,
  onNavigateExport,
  onNavigateApkExport,
}: CaptureStudioProps) {
  const [sourceMode, setSourceMode] = useState<'demo' | 'usb'>('demo');
  const {
    videoDevices,
    audioDevices,
    usbHardwareList,
    hotPlugNotice,
    usbPermissionError,
    scanDevices: scanUsbDevices,
    requestWebUsbOtgDevice,
    dismissHotPlugNotice,
  } = useUsbOtgDetector();
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [usbStatus, setUsbStatus] = useState<string>('Pemantauan otomatis USB OTG aktif');
  const [usbError, setUsbError] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [audioGain, setAudioGain] = useState<number>(1.0);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('video');
  const [showSafeZones, setShowSafeZones] = useState<boolean>(false);
  const [syncFlashActive, setSyncFlashActive] = useState<boolean>(false);
  const [sdFeedback, setSdFeedback] = useState<string | null>(null);
  const [customWidthInput, setCustomWidthInput] = useState<string>(
    String(activeProject.resolutionWidth)
  );
  const [customHeightInput, setCustomHeightInput] = useState<string>(
    String(activeProject.resolutionHeight)
  );

  // Fullscreen monitor state (supports native Fullscreen API + seamless viewport fallback)
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState<boolean>(false);

  // Multi-camera screen layout state
  const [multiLayout, setMultiLayout] = useState<MultiCamLayout>('single');
  const [pipCorner, setPipCorner] = useState<PipCorner>('br');
  const [primarySlotId, setPrimarySlotId] = useState<number>(1);
  const [cameraSlots, setCameraSlots] = useState<CameraSlotConfig[]>(INITIAL_CAMERA_SLOTS);
  const [showCamLabelsOnPreview, setShowCamLabelsOnPreview] = useState<boolean>(true);

  // Yealink VC800 PTZ Remote state
  const [yealinkPtz, setYealinkPtz] = useState<YealinkPtzState>({
    pan: 0,
    tilt: 0,
    zoom: 1.0,
    speed: 5,
    autoFocus: true,
    focusPosition: 50,
    autoFraming: false,
    backlightComp: false,
    videoInput: 'camera_ptz',
  });
  const [yealinkPresets, setYealinkPresets] = useState<YealinkPreset[]>(INITIAL_YEALINK_PRESETS);

  // Recording state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recSeconds, setRecSeconds] = useState<number>(0);
  const [recBytes, setRecBytes] = useState<number>(0);
  const [recSegmentIndex, setRecSegmentIndex] = useState<number>(1);
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);

  // Real measured pipeline performance metrics
  const [measuredFps, setMeasuredFps] = useState<number>(activeProject.fps);
  const [measuredLatencyMs, setMeasuredLatencyMs] = useState<number>(4.2);
  const [vuLevelL, setVuLevelL] = useState<number>(0);
  const [vuLevelR, setVuLevelR] = useState<number>(0);

  // Refs for zero-allocation 60fps canvas & Web Audio pipeline
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const slotVideoRefs = useRef<Record<number, HTMLVideoElement | null>>({});
  const slotStreamsRef = useRef<Record<number, MediaStream | null>>({});
  const demoImagesRef = useRef<Record<string, HTMLImageElement>>({});
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const writableStreamRef = useRef<{
    write: (data: Blob) => Promise<void>;
    close: () => Promise<void>;
  } | null>(null);
  const recStartTimeRef = useRef<number>(0);
  const recBytesRef = useRef<number>(0);

  // Live render refs
  const settingsRef = useRef<CaptureProject>(activeProject);
  const syncFlashRef = useRef<boolean>(false);
  const multiLayoutRef = useRef<MultiCamLayout>(multiLayout);
  const pipCornerRef = useRef<PipCorner>(pipCorner);
  const primarySlotIdRef = useRef<number>(primarySlotId);
  const cameraSlotsRef = useRef<CameraSlotConfig[]>(cameraSlots);
  const targetPtzRef = useRef<YealinkPtzState>(yealinkPtz);
  const smoothPtzRef = useRef<{ pan: number; tilt: number; zoom: number }>({
    pan: 0,
    tilt: 0,
    zoom: 1,
  });

  settingsRef.current = activeProject;
  multiLayoutRef.current = multiLayout;
  pipCornerRef.current = pipCorner;
  primarySlotIdRef.current = primarySlotId;
  cameraSlotsRef.current = cameraSlots;
  targetPtzRef.current = yealinkPtz;

  useEffect(() => {
    setCustomWidthInput(String(activeProject.resolutionWidth));
    setCustomHeightInput(String(activeProject.resolutionHeight));
  }, [activeProject.resolutionWidth, activeProject.resolutionHeight]);

  // Listen for browser native fullscreen changes & ESC key for fallback fullscreen
  useEffect(() => {
    const onFullscreenChange = () => {
      const nativeActive = Boolean(document.fullscreenElement);
      setIsNativeFullscreen(nativeActive);
      if (!nativeActive) {
        setIsFullscreen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen && !document.fullscreenElement) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

  const toggleFullscreen = async () => {
    const el = viewfinderRef.current;
    if (!el) return;

    if (isFullscreen) {
      if (document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // ignore
        }
      }
      setIsFullscreen(false);
      return;
    }

    setIsFullscreen(true);
    try {
      const req =
        el.requestFullscreen ||
        (el as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;
      if (req) {
        await req.call(el);
        setIsNativeFullscreen(true);
      }
    } catch {
      // Seamless CSS fixed fullscreen fallback remains active in iframe preview
      setIsNativeFullscreen(false);
    }
  };

  // Preload demo HDMI feed images
  useEffect(() => {
    for (const feed of DEMO_FEEDS) {
      if (!feed.src) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = feed.src;
      demoImagesRef.current[feed.id] = img;
    }
  }, []);

  const effectiveOutput = useMemo(
    () => computeEffectiveOutputDimensions(activeProject),
    [activeProject]
  );

  const codecInfo = useMemo(
    () => negotiateBestCodec(activeProject.format),
    [activeProject.format]
  );

  const storageEstimate = useMemo(
    () => estimateRecordingSize(activeProject.videoBitrateMbps, activeProject.audioBitrateKbps),
    [activeProject.videoBitrateMbps, activeProject.audioBitrateKbps]
  );

  useEffect(() => {
    if (videoDevices.length > 0) {
      const externalIdx = videoDevices.findIndex((d, idx) =>
        isLikelyExternalUsbCamera(d.label || '', idx, videoDevices.length)
      );
      const preferredId =
        externalIdx >= 0 ? videoDevices[externalIdx].deviceId : videoDevices[0].deviceId;
      if (!selectedVideoId || !videoDevices.some((d) => d.deviceId === selectedVideoId)) {
        setSelectedVideoId(preferredId);
      }
    }
    if (!selectedAudioId && audioDevices.length > 0) {
      setSelectedAudioId(audioDevices[0].deviceId);
    }
    const extCount = videoDevices.filter((d, idx) =>
      isLikelyExternalUsbCamera(d.label || '', idx, videoDevices.length)
    ).length;
    setUsbStatus(
      videoDevices.length > 0 || usbHardwareList.length > 0
        ? `${videoDevices.length} kamera browser (${extCount} eksternal USB) · ${audioDevices.length} audio${
            usbHardwareList.length > 0 ? ` · ${usbHardwareList.length} WebUSB OTG` : ''
          }`
        : 'Auto-deteksi aktif — colokkan HDMI Capture / Yealink VC800 via OTG lalu tekan Hubungkan USB'
    );
  }, [audioDevices, selectedAudioId, selectedVideoId, usbHardwareList.length, videoDevices]);

  // Initialize or update Web Audio API Precision Sync Graph
  const ensureAudioPipeline = useCallback(
    (incomingAudioStream?: MediaStream | null) => {
      try {
        if (!audioCtxRef.current) {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtx({ latencyHint: 'interactive', sampleRate: 48000 });
          const gain = ctx.createGain();
          const delay = ctx.createDelay(1.0);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          const dest = ctx.createMediaStreamDestination();

          gain.connect(delay);
          delay.connect(analyser);
          analyser.connect(dest);

          audioCtxRef.current = ctx;
          gainNodeRef.current = gain;
          delayNodeRef.current = delay;
          analyserRef.current = analyser;
          audioDestRef.current = dest;
        }

        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          void ctx.resume();
        }
        if (delayNodeRef.current) {
          const delaySec = Math.max(0, settingsRef.current.audioSyncMs / 1000);
          delayNodeRef.current.delayTime.setValueAtTime(delaySec, ctx.currentTime);
        }
        if (gainNodeRef.current) {
          gainNodeRef.current.gain.setValueAtTime(audioEnabled ? audioGain : 0, ctx.currentTime);
        }

        if (incomingAudioStream && gainNodeRef.current) {
          const srcNode = ctx.createMediaStreamSource(incomingAudioStream);
          srcNode.connect(gainNodeRef.current);
        }
      } catch {
        // AudioContext might wait for user gesture
      }
    },
    [audioEnabled, audioGain]
  );

  useEffect(() => {
    if (delayNodeRef.current && audioCtxRef.current) {
      const delaySec = Math.max(0, activeProject.audioSyncMs / 1000);
      delayNodeRef.current.delayTime.setValueAtTime(delaySec, audioCtxRef.current.currentTime);
    }
  }, [activeProject.audioSyncMs]);

  useEffect(() => {
    if (gainNodeRef.current && audioCtxRef.current) {
      gainNodeRef.current.gain.setValueAtTime(
        audioEnabled ? audioGain : 0,
        audioCtxRef.current.currentTime
      );
    }
  }, [audioEnabled, audioGain]);

  // Connect real USB UVC stream to any camera slot (1..4) with progressive safe fallbacks for Yealink/Android OTG
  const connectUsbToSlot = useCallback(
    async (slotId: number, vidId?: string, audId?: string) => {
      setUsbError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setUsbError('getUserMedia tidak tersedia di lingkungan browser ini.');
        return;
      }

      const prevStream = slotStreamsRef.current[slotId];
      if (prevStream) {
        prevStream.getTracks().forEach((t) => t.stop());
        slotStreamsRef.current[slotId] = null;
      }

      const isAndroid10 = settingsRef.current.deviceProfile === 'android10_micro_usb';
      const reqWidth = isAndroid10
        ? Math.min(settingsRef.current.resolutionWidth, 1280)
        : Math.min(settingsRef.current.resolutionWidth, 1920);
      const reqHeight = isAndroid10
        ? Math.min(settingsRef.current.resolutionHeight, 720)
        : Math.min(settingsRef.current.resolutionHeight, 1080);

      // Step 1: If no deviceId chosen or labels hidden before permission, unlock permission & auto-find external USB camera
      let targetDeviceId = vidId;
      if (!targetDeviceId) {
        try {
          const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          probe.getTracks().forEach((t) => t.stop());
          const allDevs = await navigator.mediaDevices.enumerateDevices();
          const vids = allDevs.filter((d) => d.kind === 'videoinput');
          const extCam = vids.find((d, idx) =>
            isLikelyExternalUsbCamera(d.label || '', idx, vids.length)
          );
          targetDeviceId = extCam?.deviceId || vids[vids.length - 1]?.deviceId || '';
          if (targetDeviceId) setSelectedVideoId(targetDeviceId);
        } catch {
          // Proceed to primary attempt to surface exact error
        }
      }

      // Step 2: Progressive constraint attempts (prevents black screen / OverconstrainedError on 30fps Yealink & MS2109 cards)
      const attempts: MediaStreamConstraints[] = [
        {
          video: {
            deviceId: targetDeviceId ? { exact: targetDeviceId } : undefined,
            width: { ideal: reqWidth },
            height: { ideal: reqHeight },
            frameRate: { ideal: 30, max: 60 },
          },
          audio: false,
        },
        {
          video: targetDeviceId ? { deviceId: { exact: targetDeviceId } } : true,
          audio: false,
        },
        { video: true, audio: false },
      ];

      let videoStream: MediaStream | null = null;
      let lastErr: unknown = null;
      for (const constraints of attempts) {
        try {
          videoStream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastErr = err;
        }
      }

      if (!videoStream) {
        const errName = lastErr instanceof DOMException ? lastErr.name : '';
        if (errName === 'NotAllowedError') {
          setUsbError(
            'Izin kamera ditolak oleh Android/Chrome. Buka Pengaturan Situs Chrome → Izin Kamera → Izinkan, lalu coba lagi.'
          );
        } else if (errName === 'NotReadableError') {
          setUsbError(
            'Kamera USB sedang dipakai aplikasi lain atau daya OTG kurang stabil. Tutup aplikasi kamera lain dan coba cabut-colok OTG.'
          );
        } else {
          setUsbError(
            'Chrome Android tidak menerima stream video dari kamera USB OTG ini. Pastikan output Yealink VC800 masuk melalui HDMI-to-USB Capture Card (UVC) atau cek panduan Android 10 OTG di panel kanan.'
          );
        }
        setSourceMode('demo');
        return;
      }

      try {
        slotStreamsRef.current[slotId] = videoStream;
        const vidEl = slotVideoRefs.current[slotId];
        if (vidEl) {
          vidEl.srcObject = videoStream;
          await new Promise<void>((resolve) => {
            if (vidEl.readyState >= 2) {
              resolve();
              return;
            }
            const onReady = () => {
              vidEl.removeEventListener('loadedmetadata', onReady);
              resolve();
            };
            vidEl.addEventListener('loadedmetadata', onReady);
            window.setTimeout(resolve, 1200);
          });
          await vidEl.play();
        }

        if (audioEnabled && !audioStreamRef.current) {
          try {
            const audStream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: audId ? { exact: audId } : undefined,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000,
              },
              video: false,
            });
            audioStreamRef.current = audStream;
            ensureAudioPipeline(audStream);
          } catch {
            // Continue video-only if mic denied
          }
        }

        const track = videoStream.getVideoTracks()[0];
        const trackSettings = track?.getSettings();
        const labelLower = (track?.label || '').toLowerCase();
        const looksInternalOnly =
          (labelLower.includes('front') || labelLower.includes('back') || labelLower.includes('camera2')) &&
          !labelLower.includes('usb') &&
          !labelLower.includes('external');

        setCameraSlots((prev) =>
          prev.map((slot) =>
            slot.id === slotId
              ? {
                  ...slot,
                  sourceType: 'usb',
                  deviceId: targetDeviceId || trackSettings?.deviceId || '',
                  label: track?.label || `Kamera USB ${slotId}`,
                }
              : slot
          )
        );
        if (slotId === primarySlotIdRef.current) {
          setSourceMode('usb');
        }
        setUsbStatus(
          `Kamera ${slotId} Aktif: ${track?.label || 'Perangkat USB UVC'} (${trackSettings?.width ?? reqWidth}×${trackSettings?.height ?? reqHeight})`
        );
        if (looksInternalOnly) {
          setUsbError(
            `Saat ini Chrome membuka kamera internal HP ("${track?.label}"). Jika kamera USB Yealink VC800 tidak muncul di daftar dropdown, sistem Android Anda tidak mengekspos USB UVC ke browser Chrome — lihat solusi Yealink VC800 di tab Video.`
          );
        }
        await scanUsbDevices();
      } catch {
        setUsbError(
          'Stream video terbuka namun gagal diputar di viewfinder Android. Coba turunkan resolusi ke 720p (30 fps) untuk Micro-USB 2.0 OTG.'
        );
      }
    },
    [audioEnabled, ensureAudioPipeline, scanUsbDevices]
  );

  // Stop all streams on unmount
  useEffect(() => {
    const streamsMap = slotStreamsRef.current;
    return () => {
      Object.values(streamsMap).forEach((st) => {
        st?.getTracks().forEach((t) => t.stop());
      });
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close();
      }
    };
  }, []);

  const triggerSyncCalibrationTest = () => {
    ensureAudioPipeline();
    const ctx = audioCtxRef.current;
    setSyncFlashActive(true);
    syncFlashRef.current = true;
    setTimeout(() => {
      setSyncFlashActive(false);
      syncFlashRef.current = false;
    }, 110);

    if (ctx && delayNodeRef.current) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, ctx.currentTime);
      env.gain.setValueAtTime(0.001, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + 0.005);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(env);
      env.connect(delayNodeRef.current);
      const monDelay = ctx.createDelay(1.0);
      monDelay.delayTime.setValueAtTime(
        Math.max(0, activeProject.audioSyncMs / 1000),
        ctx.currentTime
      );
      env.connect(monDelay);
      monDelay.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    }
  };

  // Real-time 60fps Multi-Camera + Yealink VC800 PTZ Canvas Compositor (ZERO watermark)
  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;
    let lastFpsSample = performance.now();
    const freqData = new Uint8Array(128);

    const drawCameraIntoRect = (
      ctx: CanvasRenderingContext2D,
      slot: CameraSlotConfig,
      rx: number,
      ry: number,
      rw: number,
      rh: number,
      now: number,
      applyGlobalCrop: boolean
    ) => {
      const s = settingsRef.current;
      const vidEl = slotVideoRefs.current[slot.id];
      const useUsb =
        slot.sourceType === 'usb' && vidEl && vidEl.readyState >= 2 && vidEl.videoWidth > 0;

      const isYealink = slot.sourceType === 'yealink_vc800';
      const ptz = smoothPtzRef.current;
      const vcInput = targetPtzRef.current.videoInput;

      let srcW = 1920;
      let srcH = 1080;
      let sourceDrawable: CanvasImageSource | null = null;

      if (useUsb && vidEl) {
        srcW = vidEl.videoWidth;
        srcH = vidEl.videoHeight;
        sourceDrawable = vidEl;
      } else {
        const feedKey: DemoFeedId = isYealink
          ? vcInput === 'hdmi_1'
            ? 'studio_desk'
            : vcInput === 'hdmi_2'
            ? 'smpte_bars'
            : 'coffee_barista'
          : slot.demoFeed;

        if (feedKey !== 'smpte_bars') {
          const img = demoImagesRef.current[feedKey];
          if (img && img.complete && img.naturalWidth > 0) {
            srcW = img.naturalWidth;
            srcH = img.naturalHeight;
            sourceDrawable = img;
          }
        }
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();

      ctx.fillStyle = '#090B0E';
      ctx.fillRect(rx, ry, rw, rh);

      if (sourceDrawable) {
        const baseCropX = applyGlobalCrop ? (s.cropX / 100) * srcW : 0;
        const baseCropY = applyGlobalCrop ? (s.cropY / 100) * srcH : 0;
        const baseCropW = applyGlobalCrop ? (s.cropW / 100) * srcW : srcW;
        const baseCropH = applyGlobalCrop ? (s.cropH / 100) * srcH : srcH;

        let sx = baseCropX;
        let sy = baseCropY;
        let sw = baseCropW;
        let sh = baseCropH;

        if (isYealink) {
          // Real optical zoom & pan/tilt viewport framing for Yealink VC800
          const effectiveZoom = Math.max(1, Math.min(12, ptz.zoom));
          // Visual cap at 4.5x for crisp raster sampling while maintaining full 12x telemetry
          const visualZoom = 1 + (effectiveZoom - 1) * 0.32;
          sw = baseCropW / visualZoom;
          sh = baseCropH / visualZoom;
          const maxPanPx = Math.max(0, (baseCropW - sw) / 2);
          const maxTiltPx = Math.max(0, (baseCropH - sh) / 2);
          const autoDrift = targetPtzRef.current.autoFraming
            ? Math.sin(now * 0.0012) * Math.min(18, maxPanPx * 0.35)
            : 0;
          sx = baseCropX + (baseCropW - sw) / 2 + (ptz.pan / 100) * maxPanPx + autoDrift;
          sy = baseCropY + (baseCropH - sh) / 2 + (ptz.tilt / 100) * maxTiltPx;
        } else if (!useUsb) {
          const driftX = Math.sin(now * 0.00055 + slot.id) * (srcW * 0.008);
          const driftY = Math.cos(now * 0.00042 + slot.id) * (srcH * 0.006);
          sx = Math.max(0, Math.min(srcW - sw, sx + driftX));
          sy = Math.max(0, Math.min(srcH - sh, sy + driftY));
        }

        // Preserve aspect cover inside (rw, rh)
        const srcRatio = sw / Math.max(1, sh);
        const dstRatio = rw / Math.max(1, rh);
        let finalSx = sx;
        let finalSy = sy;
        let finalSw = sw;
        let finalSh = sh;
        if (srcRatio > dstRatio) {
          finalSw = sh * dstRatio;
          finalSx = sx + (sw - finalSw) / 2;
        } else {
          finalSh = sw / dstRatio;
          finalSy = sy + (sh - finalSh) / 2;
        }

        finalSx = Math.max(0, Math.min(srcW - finalSw, finalSx));
        finalSy = Math.max(0, Math.min(srcH - finalSh, finalSy));

        ctx.drawImage(sourceDrawable, finalSx, finalSy, finalSw, finalSh, rx, ry, rw, rh);
      } else {
        // Broadcast SMPTE HD Color Bars generator
        const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
        const barW = rw / bars.length;
        bars.forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.fillRect(rx + i * barW, ry, barW + 1, rh * 0.72);
        });
        const lower = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
        lower.forEach((col, i) => {
          ctx.fillStyle = col;
          ctx.fillRect(rx + i * barW, ry + rh * 0.72, barW + 1, rh * 0.1);
        });
        ctx.fillStyle = '#0c0d10';
        ctx.fillRect(rx, ry + rh * 0.82, rw, rh * 0.18);
        const sweepX = rx + ((now * 0.32) % rw);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(sweepX, ry + rh * 0.84, Math.max(6, rw * 0.012), rh * 0.14);
      }

      ctx.restore();
    };

    const drawFrame = (now: number) => {
      const t0 = performance.now();

      // Smooth PTZ motor interpolation for Yealink VC800 presets & D-pad
      const targetPtz = targetPtzRef.current;
      const lerpFactor = Math.min(0.28, 0.05 + targetPtz.speed * 0.018);
      smoothPtzRef.current.pan += (targetPtz.pan - smoothPtzRef.current.pan) * lerpFactor;
      smoothPtzRef.current.tilt += (targetPtz.tilt - smoothPtzRef.current.tilt) * lerpFactor;
      smoothPtzRef.current.zoom += (targetPtz.zoom - smoothPtzRef.current.zoom) * lerpFactor;

      const canvas = canvasRef.current;
      if (canvas) {
        const s = settingsRef.current;
        const outDims = computeEffectiveOutputDimensions(s);
        const targetW = outDims.width;
        const targetH = outDims.height;
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (ctx) {
          ctx.fillStyle = '#090B0E';
          ctx.fillRect(0, 0, targetW, targetH);

          ctx.save();
          ctx.translate(targetW / 2, targetH / 2);
          ctx.rotate((s.rotation * Math.PI) / 180);
          ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);

          const isQuarterTurn = s.rotation === 90 || s.rotation === 270;
          const drawW = isQuarterTurn ? targetH : targetW;
          const drawH = isQuarterTurn ? targetW : targetH;
          const ox = -drawW / 2;
          const oy = -drawH / 2;

          const slots = cameraSlotsRef.current;
          const primarySlot =
            slots.find((c) => c.id === primarySlotIdRef.current) ?? slots[0];
          const secondarySlot =
            slots.find((c) => c.id !== primarySlot.id) ?? slots[1] ?? slots[0];
          const layout = multiLayoutRef.current;

          if (layout === 'single') {
            drawCameraIntoRect(ctx, primarySlot, ox, oy, drawW, drawH, now, true);
          } else if (layout === 'split_2') {
            const gap = 4;
            const halfW = (drawW - gap) / 2;
            drawCameraIntoRect(ctx, primarySlot, ox, oy, halfW, drawH, now, false);
            drawCameraIntoRect(ctx, secondarySlot, ox + halfW + gap, oy, halfW, drawH, now, false);
          } else if (layout === 'pip') {
            drawCameraIntoRect(ctx, primarySlot, ox, oy, drawW, drawH, now, true);
            const pipW = Math.round(drawW * 0.31);
            const pipH = Math.round(drawH * 0.31);
            const margin = Math.round(Math.min(drawW, drawH) * 0.035);
            const corner = pipCornerRef.current;
            const px = corner === 'br' || corner === 'tr' ? ox + drawW - pipW - margin : ox + margin;
            const py = corner === 'br' || corner === 'bl' ? oy + drawH - pipH - margin : oy + margin;
            drawCameraIntoRect(ctx, secondarySlot, px, py, pipW, pipH, now, false);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
            ctx.lineWidth = Math.max(2, Math.round(drawW * 0.002));
            ctx.strokeRect(px, py, pipW, pipH);
          } else if (layout === 'quad_4') {
            const gap = 4;
            const halfW = (drawW - gap) / 2;
            const halfH = (drawH - gap) / 2;
            const s1 = slots[0];
            const s2 = slots[1] ?? slots[0];
            const s3 = slots[2] ?? slots[0];
            const s4 = slots[3] ?? slots[0];
            drawCameraIntoRect(ctx, s1, ox, oy, halfW, halfH, now, false);
            drawCameraIntoRect(ctx, s2, ox + halfW + gap, oy, halfW, halfH, now, false);
            drawCameraIntoRect(ctx, s3, ox, oy + halfH + gap, halfW, halfH, now, false);
            drawCameraIntoRect(ctx, s4, ox + halfW + gap, oy + halfH + gap, halfW, halfH, now, false);
          }

          ctx.restore();

          // A/V Sync Flash Marker (only when user clicks Calibration Test)
          if (syncFlashRef.current) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
            ctx.fillRect(targetW / 2 - 90, targetH / 2 - 90, 180, 180);
            ctx.fillStyle = '#090B0E';
            ctx.font = '600 22px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('SYNC 1kHz', targetW / 2, targetH / 2 + 8);
          }
        }
      }

      frameCount += 1;
      const elapsed = now - lastFpsSample;
      if (elapsed >= 400) {
        const currentFps = Math.round((frameCount * 1000) / elapsed);
        const renderMs = Number((performance.now() - t0).toFixed(1));
        setMeasuredFps(Math.min(60, Math.max(1, currentFps)));
        setMeasuredLatencyMs(Math.max(0.8, renderMs));
        frameCount = 0;
        lastFpsSample = now;

        if (analyserRef.current && audioEnabled) {
          analyserRef.current.getByteTimeDomainData(freqData);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) {
            const v = (freqData[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / freqData.length);
          const norm = Math.min(100, Math.round(rms * 380));
          setVuLevelL(norm);
          setVuLevelR(Math.min(100, Math.round(norm * 0.94)));
        } else if (audioEnabled) {
          const base = 18 + Math.round(Math.abs(Math.sin(now * 0.004)) * 22);
          setVuLevelL(base);
          setVuLevelR(Math.max(10, base - 3));
        } else {
          setVuLevelL(0);
          setVuLevelR(0);
        }
      }

      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [audioEnabled]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecSeconds((Date.now() - recStartTimeRef.current) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  const startRecording = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setLastSavedNotice(null);
    ensureAudioPipeline();

    const canvasStream = canvas.captureStream(activeProject.fps);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    if (audioEnabled && audioDestRef.current) {
      const audioTracks = audioDestRef.current.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        tracks.push(audioTracks[0]);
      }
    }

    const combinedStream = new MediaStream(tracks);
    const selectedCodec = negotiateBestCodec(activeProject.format);
    const options: MediaRecorderOptions = {
      videoBitsPerSecond: activeProject.videoBitrateMbps * 1_000_000,
      audioBitsPerSecond: activeProject.audioBitrateKbps * 1_000,
    };
    if (selectedCodec.mimeType) {
      options.mimeType = selectedCodec.mimeType;
    }

    const clipFilename = `M2RStudio_${new Date().toISOString().replace(/[:.]/g, '-')}.${selectedCodec.extension}`;

    writableStreamRef.current = null;
    if (sdDirectory) {
      try {
        const fileHandle = await sdDirectory.getFileHandle(clipFilename, { create: true });
        writableStreamRef.current = await fileHandle.createWritable();
      } catch {
        writableStreamRef.current = null;
      }
    }

    recordedChunksRef.current = [];
    recBytesRef.current = 0;
    setRecBytes(0);
    setRecSeconds(0);
    setRecSegmentIndex(1);

    try {
      const recorder = new MediaRecorder(combinedStream, options);
      mediaRecorderRef.current = recorder;
      recStartTimeRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          recBytesRef.current += event.data.size;
          setRecBytes(recBytesRef.current);

          if (activeProject.sdSplitGb > 0) {
            const splitThresholdBytes = activeProject.sdSplitGb * 1024 * 1024 * 1024;
            const seg = Math.floor(recBytesRef.current / splitThresholdBytes) + 1;
            setRecSegmentIndex(seg);
          }

          if (writableStreamRef.current) {
            void writableStreamRef.current.write(event.data);
          }
        }
      };

      recorder.onstop = async () => {
        const durationSec = Math.max(1, (Date.now() - recStartTimeRef.current) / 1000);
        if (writableStreamRef.current) {
          try {
            await writableStreamRef.current.close();
          } catch {
            // ignore
          }
          writableStreamRef.current = null;
        }

        const finalMime = selectedCodec.mimeType || 'video/mp4';
        const finalBlob = new Blob(recordedChunksRef.current, { type: finalMime });
        recordedChunksRef.current = [];

        const recId = generateSafeDocId('rec');
        await saveClipBlobToCache(recId, finalBlob);
        const blobUrl = URL.createObjectURL(finalBlob);

        const nowMs = Date.now();
        const newRecording: CaptureRecording = {
          id: recId,
          ownerId: activeProject.ownerId,
          projectId: activeProject.id,
          title: `${activeProject.name.slice(0, 48)} — ${new Date(nowMs).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
          })}`,
          durationSec: Number(durationSec.toFixed(1)),
          resolution: `${effectiveOutput.width}x${effectiveOutput.height}`,
          fps: activeProject.fps,
          format: selectedCodec.extension,
          videoBitrateMbps: activeProject.videoBitrateMbps,
          fileSizeBytes: finalBlob.size,
          rotation: activeProject.rotation,
          audioSyncMs: activeProject.audioSyncMs,
          watermarkFree: true,
          storageTarget: sdDirectory
            ? `${sdDirectory.name}/${clipFilename}`
            : `${activeProject.sdStoragePath}/${clipFilename}`,
          status: 'recorded',
          publishedPlatforms: [],
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          syncedToCloud: false,
          localBlobUrl: blobUrl,
          hasLocalBlob: true,
          mimeType: finalMime,
        };

        await onRecordingFinished(newRecording, finalBlob);
        setLastSavedNotice(
          sdDirectory
            ? `Tersimpan langsung ke folder "${sdDirectory.name}" (${formatFileSize(finalBlob.size)}, bebas watermark).`
            : `Rekaman selesai (${formatFileSize(finalBlob.size)}, bebas watermark). Siap diekspor atau diunggah instan.`
        );
      };

      recorder.start(1000);
      setIsRecording(true);
    } catch {
      setUsbError('Gagal memulai perekaman MediaRecorder pada codec ini.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const applyAspectCrop = (aspect: CropAspect) => {
    if (aspect === '16:9' || aspect === 'free') {
      onUpdateSettings({ cropAspect: aspect, cropX: 0, cropY: 0, cropW: 100, cropH: 100 });
      return;
    }
    if (aspect === '9:16') {
      onUpdateSettings({ cropAspect: '9:16', cropX: 34, cropY: 0, cropW: 32, cropH: 100 });
      return;
    }
    if (aspect === '4:5') {
      onUpdateSettings({ cropAspect: '4:5', cropX: 27, cropY: 0, cropW: 46, cropH: 100 });
      return;
    }
    if (aspect === '1:1') {
      onUpdateSettings({ cropAspect: '1:1', cropX: 22, cropY: 0, cropW: 56, cropH: 100 });
    }
  };

  const rotateBy90 = () => {
    const next = ((activeProject.rotation + 90) % 360) as RotationAngle;
    onUpdateSettings({ rotation: next });
  };

  const applyCustomResolution = () => {
    const w = Math.min(
      BLUEPRINT_LIMITS.RESOLUTION_MAX_W,
      Math.max(BLUEPRINT_LIMITS.RESOLUTION_MIN_W, parseInt(customWidthInput, 10) || 1920)
    );
    const h = Math.min(
      BLUEPRINT_LIMITS.RESOLUTION_MAX_H,
      Math.max(BLUEPRINT_LIMITS.RESOLUTION_MIN_H, parseInt(customHeightInput, 10) || 1080)
    );
    setCustomWidthInput(String(w));
    setCustomHeightInput(String(h));
    onUpdateSettings({ resolutionWidth: w, resolutionHeight: h });
  };

  const handleMountSd = async () => {
    setSdFeedback(null);
    const res = await pickSdCardDirectory();
    if (res.handle) {
      onMountSdDirectory(res.handle);
      setSdFeedback(`Direktori Kartu SD "${res.handle.name}" terpasang untuk penulisan langsung.`);
    } else if (res.error) {
      setSdFeedback(res.error);
    }
  };

  const updateCameraSlot = (slotId: number, patch: Partial<CameraSlotConfig>) => {
    setCameraSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, ...patch } : s)));
  };

  const isVerticalOutput = effectiveOutput.height > effectiveOutput.width;

  const layoutLabelMap: Record<MultiCamLayout, string> = {
    single: '1 Layar',
    split_2: '2 Layar',
    pip: 'PiP',
    quad_4: '4 Layar',
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Offscreen 1px compositor-active video elements (CRITICAL: display:none blocks frame decoding on Chrome Android!) */}
      {[1, 2, 3, 4].map((slotId) => (
        <video
          key={slotId}
          ref={(el) => {
            slotVideoRefs.current[slotId] = el;
          }}
          autoPlay
          muted
          playsInline
          className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none"
        />
      ))}

      {/* Left 8 Columns: Dominant Live Viewfinder & Transport Controls */}
      <section className="lg:col-span-8 space-y-4">
        {/* Clean Contextual Project Header + Quick Source & Install */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
              {activeProject.name}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
              {effectiveOutput.width}×{effectiveOutput.height} · {activeProject.fps} fps ·{' '}
              {activeProject.videoBitrateMbps} Mbps · {layoutLabelMap[multiLayout]} · Sync{' '}
              {activeProject.audioSyncMs >= 0
                ? `+${activeProject.audioSyncMs}ms`
                : `${activeProject.audioSyncMs}ms`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallButton variant="compact" onExportApk={onNavigateApkExport} />
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  setSourceMode('demo');
                  updateCameraSlot(primarySlotId, { sourceType: 'demo' });
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sourceMode === 'demo'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                Simulasi HDMI
              </button>
              <button
                type="button"
                onClick={() => void connectUsbToSlot(primarySlotId, selectedVideoId, selectedAudioId)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sourceMode === 'usb'
                    ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                USB UVC Langsung
              </button>
            </div>
          </div>
        </div>

        {/* Live Viewfinder Frame (supports Fullscreen API + seamless fixed fullscreen) */}
        <div
          ref={viewfinderRef}
          className={`bg-zinc-950 flex items-center justify-center overflow-hidden ${
            isFullscreen && !isNativeFullscreen
              ? 'fixed inset-0 z-50 rounded-none border-0'
              : isFullscreen
              ? 'w-screen h-screen rounded-none border-0'
              : 'relative rounded-xl border border-zinc-200 dark:border-zinc-800 min-h-[300px] sm:min-h-[430px] max-h-[600px]'
          }`}
        >
          <canvas
            ref={canvasRef}
            className={`block transition-transform duration-150 object-contain ${
              isFullscreen
                ? 'w-full h-full max-w-full max-h-full'
                : isVerticalOutput
                ? 'h-[430px] sm:h-[520px] w-auto max-w-full'
                : 'w-full h-auto max-h-[540px]'
            }`}
          />

          {/* Preview-only Multi-Camera Tile Labels (NEVER baked into recorded video) */}
          {showCamLabelsOnPreview && multiLayout !== 'single' && (
            <div className="pointer-events-none absolute inset-0">
              {multiLayout === 'split_2' && (
                <div className="w-full h-full grid grid-cols-2">
                  <div className="p-3 pt-12 text-[11px] font-mono text-white/90 drop-shadow">
                    CAM 1 · {cameraSlots.find((c) => c.id === primarySlotId)?.label}
                  </div>
                  <div className="p-3 pt-12 text-[11px] font-mono text-white/90 drop-shadow">
                    CAM 2 · {cameraSlots.find((c) => c.id !== primarySlotId)?.label}
                  </div>
                </div>
              )}
              {multiLayout === 'quad_4' && (
                <div className="w-full h-full grid grid-cols-2 grid-rows-2">
                  {cameraSlots.map((slot) => (
                    <div
                      key={slot.id}
                      className="p-3 pt-11 text-[11px] font-mono text-white/90 drop-shadow"
                    >
                      CAM {slot.id} ·{' '}
                      {slot.sourceType === 'yealink_vc800'
                        ? `Yealink VC800 (${yealinkPtz.zoom.toFixed(1)}×)`
                        : slot.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Optional Vertical Reels / Shorts Safe Zone Overlay (Preview Only — Never Recorded) */}
          {showSafeZones && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative border border-white/40 ${
                  isVerticalOutput && !isFullscreen
                    ? 'h-[430px] sm:h-[520px] aspect-[9/16]'
                    : 'w-full h-full'
                }`}
              >
                <div className="absolute inset-x-0 top-1/3 border-t border-white/25" />
                <div className="absolute inset-x-0 top-2/3 border-t border-white/25" />
                <div className="absolute inset-y-0 left-1/3 border-l border-white/25" />
                <div className="absolute inset-y-0 left-2/3 border-l border-white/25" />
                {isVerticalOutput && (
                  <div className="absolute inset-x-3 bottom-16 top-14 border border-dashed border-amber-400/70 rounded" />
                )}
              </div>
            </div>
          )}

          {/* Top Scrim Telemetry Bar */}
          <div className="absolute top-0 inset-x-0 px-4 py-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between gap-4 text-xs text-white">
            <div className="flex items-center gap-3 font-mono tabular-nums">
              {isRecording ? (
                <span className="inline-flex items-center gap-2 font-semibold text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  REC {formatDuration(recSeconds)}
                </span>
              ) : (
                <span className="text-zinc-200">
                  {multiLayout === 'single' ? 'M2R STUDIO' : `MULTI ${layoutLabelMap[multiLayout].toUpperCase()}`}
                </span>
              )}
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <span>{measuredFps} fps</span>
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <span>{measuredLatencyMs.toFixed(1)} ms</span>
            </div>

            <div className="flex items-center gap-2 font-mono tabular-nums text-zinc-200">
              <span>{activeProject.rotation}°</span>
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <span>{activeProject.cropAspect}</span>
              {isRecording && (
                <>
                  <span aria-hidden="true" className="text-zinc-500">
                    ·
                  </span>
                  <span>{formatFileSize(recBytes)}</span>
                </>
              )}
            </div>
          </div>

          {/* Bottom Scrim Stereo Audio Level Meter + Quick Viewfinder Actions (including FULL SCREEN) */}
          <div className="absolute bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-wrap items-center justify-between gap-3">
            {/* Real Stereo VU Meter */}
            <div className="flex items-center gap-2.5 min-w-[120px] max-w-[200px] flex-1">
              <Volume2 className="w-4 h-4 text-zinc-300 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      vuLevelL > 85 ? 'bg-rose-500' : vuLevelL > 65 ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${vuLevelL}%` }}
                  />
                </div>
                <div className="h-1.5 rounded-full bg-white/15 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 ${
                      vuLevelR > 85 ? 'bg-rose-500' : vuLevelR > 65 ? 'bg-amber-400' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${vuLevelR}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] font-mono tabular-nums text-zinc-300">
                {audioEnabled ? '48kHz' : 'BISU'}
              </span>
            </div>

            {/* Quick Viewfinder Controls: Rec in Fullscreen, Multi-Screen Cycle, Rotate, Grid, FULL SCREEN */}
            <div className="flex items-center gap-1.5">
              {isFullscreen && (
                <button
                  type="button"
                  onClick={() => (isRecording ? stopRecording() : void startRecording())}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    isRecording
                      ? 'bg-white text-zinc-950'
                      : 'bg-rose-600 hover:bg-rose-700 text-white'
                  }`}
                >
                  {isRecording ? (
                    <>
                      <Square className="w-3 h-3 fill-current" />
                      Stop
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-white" />
                      Rekam
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const order: MultiCamLayout[] = ['single', 'split_2', 'pip', 'quad_4'];
                  const next = order[(order.indexOf(multiLayout) + 1) % order.length];
                  setMultiLayout(next);
                }}
                title="Ganti mode multi layar kamera"
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  multiLayout !== 'single'
                    ? 'bg-white text-zinc-950'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                {layoutLabelMap[multiLayout]}
              </button>

              <button
                type="button"
                onClick={rotateBy90}
                title="Putar 90° real-time"
                className="min-h-[36px] px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <RotateCw className="w-3.5 h-3.5" />
                +90°
              </button>

              <button
                type="button"
                onClick={() => setShowSafeZones((v) => !v)}
                title="Tampilkan garis bantu aman"
                className={`min-h-[36px] px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  showSafeZones
                    ? 'bg-white text-zinc-950'
                    : 'bg-white/10 hover:bg-white/20 text-white'
                }`}
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                Grid
              </button>

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                title={isFullscreen ? 'Keluar layar penuh' : 'Tampilan video layar penuh'}
                className="min-h-[36px] px-2.5 rounded-lg bg-white/15 hover:bg-white/25 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    Keluar
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    Full Screen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Primary Recording Transport Strip */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {!isRecording ? (
              <button
                type="button"
                onClick={() => void startRecording()}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-sm font-semibold inline-flex items-center gap-2.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span className="w-2.5 h-2.5 rounded-full bg-white" />
                Mulai Rekam
              </button>
            ) : (
              <button
                type="button"
                onClick={stopRecording}
                className="min-h-[44px] px-5 py-2.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-950 hover:opacity-90 active:scale-[0.98] text-sm font-semibold inline-flex items-center gap-2.5 transition-all whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Hentikan ({formatDuration(recSeconds)})
              </button>
            )}

            <button
              type="button"
              onClick={() => setAudioEnabled((v) => !v)}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300 text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {audioEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-rose-500" />}
              {audioEnabled ? 'Audio Aktif' : 'Audio Bisu'}
            </button>

            <button
              type="button"
              onClick={onSaveProjectNow}
              disabled={isSavingProject}
              className="min-h-[44px] px-3.5 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800/70 text-zinc-700 dark:text-zinc-300 text-xs font-medium inline-flex items-center gap-2 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              {isCloudSignedIn ? <Cloud className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {isSavingProject ? 'Menyimpan...' : isCloudSignedIn ? 'Simpan Cloud' : 'Simpan Proyek'}
            </button>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{codecInfo.label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {sdDirectory ? `SD: ${sdDirectory.name}` : `Target: ${activeProject.sdStoragePath}`}
            </span>
            {isRecording && activeProject.sdSplitGb > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Segmen #{recSegmentIndex} ({activeProject.sdSplitGb}GB FAT32)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Quick Multi-Screen & Active Camera Switcher Bar */}
        <div className="px-4 py-3 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mr-1">
              Multi Layar
            </span>
            {(
              [
                { id: 'single', label: '1 Layar' },
                { id: 'split_2', label: '2 Layar' },
                { id: 'pip', label: 'PiP' },
                { id: 'quad_4', label: '4 Layar' },
              ] as { id: MultiCamLayout; label: string }[]
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setMultiLayout(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  multiLayout === item.id
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mr-1">
              Kamera Aktif
            </span>
            {cameraSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setPrimarySlotId(slot.id)}
                className={`px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-md transition-colors whitespace-nowrap ${
                  primarySlotId === slot.id
                    ? 'bg-rose-600 text-white font-semibold'
                    : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                CAM {slot.id}
              </button>
            ))}
          </div>
        </div>

        {/* Automatic Real-Time USB OTG Hot-Plug Notification Banner */}
        {hotPlugNotice && (
          <div
            className={`px-4 py-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
              hotPlugNotice.type === 'connected'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60'
                : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/60'
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <Usb className="w-4 h-4 shrink-0" />
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {hotPlugNotice.label}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {hotPlugNotice.type === 'connected' && (
                <button
                  type="button"
                  onClick={() => {
                    void connectUsbToSlot(
                      primarySlotId,
                      hotPlugNotice.deviceId || selectedVideoId,
                      selectedAudioId
                    );
                    dismissHotPlugNotice();
                  }}
                  className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
                >
                  Aktifkan di Kamera {primarySlotId}
                </button>
              )}
              <button
                type="button"
                onClick={dismissHotPlugNotice}
                className="text-xs text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Tutup
              </button>
            </div>
          </div>
        )}

        {/* Contextual Feedback Banners */}
        {(usbError || usbPermissionError) && (
          <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300">
            {usbError || usbPermissionError}
          </div>
        )}

        {lastSavedNotice && (
          <div className="px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-emerald-800 dark:text-emerald-300">{lastSavedNotice}</span>
            <button
              type="button"
              onClick={onNavigateExport}
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium whitespace-nowrap transition-colors"
            >
              Ekspor & Unggah Instan
            </button>
          </div>
        )}
      </section>

      {/* Right 4 Columns: Minimalist Precision Control Inspector (6 Tabs including Multi & Yealink VC800) */}
      <aside className="lg:col-span-4 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-6 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          {[
            { id: 'video' as const, label: 'Video', icon: Sliders },
            { id: 'multicam' as const, label: 'Multi', icon: LayoutGrid },
            { id: 'vc800' as const, label: 'VC800', icon: Gamepad2 },
            { id: 'transform' as const, label: 'Crop', icon: Crop },
            { id: 'audio' as const, label: 'Audio', icon: Radio },
            { id: 'storage' as const, label: 'SD', icon: HardDrive },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = inspectorTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInspectorTab(tab.id)}
                className={`min-h-[46px] py-2 px-1 text-[11px] font-medium flex flex-col items-center justify-center gap-1 transition-colors border-b-2 cursor-pointer ${
                  active
                    ? 'border-rose-600 text-zinc-900 dark:text-zinc-100 bg-white dark:bg-[#111419]'
                    : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="p-5 space-y-5">
          {/* TAB 1: Video, Custom Resolution, Format MP4 & Bitrate */}
          {inspectorTab === 'video' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Perangkat USB Capture / Kamera Utama
                  </label>
                  <button
                    type="button"
                    onClick={() => void scanUsbDevices()}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Pindai
                  </button>
                </div>
                <select
                  value={selectedVideoId}
                  onChange={(e) => {
                    setSelectedVideoId(e.target.value);
                    if (sourceMode === 'usb') {
                      void connectUsbToSlot(primarySlotId, e.target.value, selectedAudioId);
                    }
                  }}
                  className="w-full min-h-[40px] px-3 py-2 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                >
                  {videoDevices.length === 0 ? (
                    <option value="">Belum ada kartu USB UVC terdeteksi</option>
                  ) : (
                    videoDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Perangkat USB Video #${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{usbStatus}</p>

                <button
                  type="button"
                  onClick={() => void requestWebUsbOtgDevice()}
                  className="w-full min-h-[38px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-xs font-medium text-zinc-800 dark:text-zinc-200 inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <Usb className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  Deteksi Perangkat USB OTG (WebUSB)
                </button>

                {usbHardwareList.length > 0 && (
                  <div className="pt-1 space-y-1 text-[11px] font-mono text-zinc-600 dark:text-zinc-400">
                    {usbHardwareList.map((hw) => (
                      <div key={hw.key} className="truncate">
                        OTG: {hw.name} ({hw.vendorHex}:{hw.productHex})
                      </div>
                    ))}
                  </div>
                )}

                <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/70 border border-zinc-200 dark:border-zinc-800 space-y-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                    Video Yealink VC800 / OTG tidak tampil?
                  </div>
                  <p>
                    1. Pastikan koneksi memakai <strong>HDMI Out VC800 → USB HDMI Capture Card (UVC) → Micro-USB OTG</strong> (port USB di bodi VC800 adalah host, bukan webcam output).
                  </p>
                  <p>
                    2. Di HP Android 10 ke bawah, jika Chrome hanya menampilkan kamera depan/belakang HP, browser belum mendukung UVC eksternal — gunakan jalur APK Native + driver <span className="font-mono">libuvc</span>.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Preset & Resolusi Kustom
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {RESOLUTION_PRESETS.map((preset) => {
                    const isCurrent =
                      activeProject.resolutionWidth === preset.width &&
                      activeProject.resolutionHeight === preset.height;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({
                            resolutionWidth: preset.width,
                            resolutionHeight: preset.height,
                            videoBitrateMbps: preset.recommendedMbps,
                          })
                        }
                        className={`px-2.5 py-2 rounded-lg text-left border transition-colors ${
                          isCurrent
                            ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                            : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        <div className="text-xs font-semibold">{preset.label}</div>
                        <div className="text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                          {preset.width}×{preset.height}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-5 gap-2 items-end">
                  <div className="col-span-2">
                    <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                      Lebar (px)
                    </label>
                    <input
                      type="number"
                      min={320}
                      max={3840}
                      value={customWidthInput}
                      onChange={(e) => setCustomWidthInput(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] text-zinc-500 dark:text-zinc-400 mb-1">
                      Tinggi (px)
                    </label>
                    <input
                      type="number"
                      min={240}
                      max={2160}
                      value={customHeightInput}
                      onChange={(e) => setCustomHeightInput(e.target.value)}
                      className="w-full min-h-[38px] px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={applyCustomResolution}
                    className="min-h-[38px] px-2 text-xs font-medium rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:opacity-90"
                  >
                    Set
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">Frame Rate</span>
                  <div className="flex items-center gap-1">
                    {[24, 30, 50, 60].map((fps) => (
                      <button
                        key={fps}
                        type="button"
                        onClick={() => onUpdateSettings({ fps })}
                        className={`px-2.5 py-1.5 rounded-md text-xs font-mono tabular-nums transition-colors ${
                          activeProject.fps === fps
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                            : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {fps}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Format Kontainer
                  </span>
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                    {(['mp4', 'webm'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        type="button"
                        onClick={() => onUpdateSettings({ format: fmt })}
                        className={`px-3 py-1 text-xs font-mono uppercase rounded-md transition-colors ${
                          activeProject.format === fmt
                            ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-semibold shadow-xs'
                            : 'text-zinc-500 dark:text-zinc-400'
                        }`}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-600 dark:text-zinc-400">Bitrate Video</span>
                    <span className="font-mono tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                      {activeProject.videoBitrateMbps} Mbps
                    </span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={80}
                    step={1}
                    value={activeProject.videoBitrateMbps}
                    onChange={(e) =>
                      onUpdateSettings({ videoBitrateMbps: Number(e.target.value) })
                    }
                    className="w-full studio-slider"
                  />
                  <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    <span>{storageEstimate.mbPerMinute.toFixed(0)} MB/menit</span>
                    <span>{storageEstimate.gbPerHour.toFixed(1)} GB/jam</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Bitrate Audio</span>
                  <div className="flex items-center gap-1">
                    {[128, 192, 256, 320].map((kbps) => (
                      <button
                        key={kbps}
                        type="button"
                        onClick={() => onUpdateSettings({ audioBitrateKbps: kbps })}
                        className={`px-2 py-1 rounded text-[11px] font-mono tabular-nums ${
                          activeProject.audioBitrateKbps === kbps
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 font-semibold'
                            : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {kbps}k
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: Multi-Layar Beberapa Kamera */}
          {inspectorTab === 'multicam' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Tata Letak Multi Layar (Terekam Langsung)
                </span>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: 'single', title: '1 Layar', desc: 'Kamera utama penuh' },
                      { id: 'split_2', title: '2 Layar Split', desc: 'Kamera 1 & 2 berdampingan' },
                      { id: 'pip', title: 'Picture-in-Picture', desc: 'Utama + jendela sudut' },
                      { id: 'quad_4', title: '4 Layar Quad', desc: 'Grid 2×2 empat kamera' },
                    ] as { id: MultiCamLayout; title: string; desc: string }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setMultiLayout(item.id)}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        multiLayout === item.id
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {item.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {item.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {multiLayout === 'pip' && (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Posisi Jendela PiP</span>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { id: 'tl', label: 'Kiri Atas' },
                        { id: 'tr', label: 'Kanan Atas' },
                        { id: 'bl', label: 'Kiri Bawah' },
                        { id: 'br', label: 'Kanan Bawah' },
                      ] as { id: PipCorner; label: string }[]
                    ).map((pos) => (
                      <button
                        key={pos.id}
                        type="button"
                        onClick={() => setPipCorner(pos.id)}
                        className={`px-2 py-1 rounded text-[10px] font-medium ${
                          pipCorner === pos.id
                            ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                            : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400'
                        }`}
                      >
                        {pos.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <span className="text-zinc-600 dark:text-zinc-400">
                  Label kamera di pratinjau (tidak ikut terekam)
                </span>
                <button
                  type="button"
                  onClick={() => setShowCamLabelsOnPreview((v) => !v)}
                  className={`px-2.5 py-1 rounded text-[11px] font-semibold ${
                    showCamLabelsOnPreview
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-500'
                  }`}
                >
                  {showCamLabelsOnPreview ? 'Aktif' : 'Nonaktif'}
                </button>
              </div>

              {/* Per-Camera Source Assignment (CAM 1..4) */}
              <div className="space-y-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Sumber Tiap Kamera (Slot 1 – 4)
                </span>

                {cameraSlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 inline-flex items-center gap-1.5">
                        <Camera className="w-3.5 h-3.5 text-zinc-500" />
                        CAM {slot.id}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPrimarySlotId(slot.id)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                          primarySlotId === slot.id
                            ? 'bg-rose-600 text-white'
                            : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                        }`}
                      >
                        {primarySlotId === slot.id ? 'Utama' : 'Jadikan Utama'}
                      </button>
                    </div>

                    <select
                      value={
                        slot.sourceType === 'usb'
                          ? `usb:${slot.deviceId}`
                          : slot.sourceType === 'yealink_vc800'
                          ? 'yealink_vc800'
                          : `demo:${slot.demoFeed}`
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'yealink_vc800') {
                          updateCameraSlot(slot.id, {
                            sourceType: 'yealink_vc800',
                            label: 'Yealink VC800 PTZ',
                          });
                        } else if (val.startsWith('demo:')) {
                          const feed = val.replace('demo:', '') as DemoFeedId;
                          const feedInfo = DEMO_FEEDS.find((f) => f.id === feed);
                          updateCameraSlot(slot.id, {
                            sourceType: 'demo',
                            demoFeed: feed,
                            label: feedInfo?.label || `Kamera ${slot.id}`,
                          });
                        } else if (val.startsWith('usb:')) {
                          const devId = val.replace('usb:', '');
                          void connectUsbToSlot(slot.id, devId, selectedAudioId);
                        }
                      }}
                      className="w-full min-h-[36px] px-2.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                    >
                      <option value="yealink_vc800">Yealink VC800 (Remote PTZ 12×)</option>
                      {DEMO_FEEDS.map((f) => (
                        <option key={f.id} value={`demo:${f.id}`}>
                          {f.label}
                        </option>
                      ))}
                      {videoDevices.map((dev, idx) => (
                        <option key={dev.deviceId || idx} value={`usb:${dev.deviceId}`}>
                          USB UVC: {dev.label || `Kamera USB #${idx + 1}`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: Setting Remote Kamera Yealink VC800 */}
          {inspectorTab === 'vc800' && (
            <YealinkRemotePanel
              ptz={yealinkPtz}
              presets={yealinkPresets}
              onChangePtz={(patch) => setYealinkPtz((prev) => ({ ...prev, ...patch }))}
              onRecallPreset={(preset) =>
                setYealinkPtz((prev) => ({
                  ...prev,
                  pan: preset.pan,
                  tilt: preset.tilt,
                  zoom: preset.zoom,
                }))
              }
              onSavePreset={(slot) =>
                setYealinkPresets((prev) =>
                  prev.map((p) =>
                    p.slot === slot
                      ? {
                          ...p,
                          pan: yealinkPtz.pan,
                          tilt: yealinkPtz.tilt,
                          zoom: yealinkPtz.zoom,
                        }
                      : p
                  )
                )
              }
            />
          )}

          {/* TAB 4: Real-Time 90° Rotation & Video Crop */}
          {inspectorTab === 'transform' && (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Rotasi 90° Real-Time
                  </span>
                  <span className="text-xs font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                    {activeProject.rotation}°
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {([0, 90, 180, 270] as RotationAngle[]).map((angle) => (
                    <button
                      key={angle}
                      type="button"
                      onClick={() => onUpdateSettings({ rotation: angle })}
                      className={`min-h-[40px] rounded-lg text-xs font-mono tabular-nums font-medium border transition-colors ${
                        activeProject.rotation === angle
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {angle}°
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ flipH: !activeProject.flipH })}
                    className={`min-h-[40px] px-3 rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-2 transition-colors ${
                      activeProject.flipH
                        ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <FlipHorizontal className="w-3.5 h-3.5" />
                    Cermin Horizontal
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ flipV: !activeProject.flipV })}
                    className={`min-h-[40px] px-3 rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-2 transition-colors ${
                      activeProject.flipV
                        ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                        : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                    }`}
                  >
                    <FlipVertical className="w-3.5 h-3.5" />
                    Balik Vertikal
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Rasio Crop Real-Time
                  </span>
                  <button
                    type="button"
                    onClick={() => applyAspectCrop('16:9')}
                    className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Reset
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { id: '9:16', label: '9:16 Vertikal' },
                      { id: '16:9', label: '16:9 Penuh' },
                      { id: '4:5', label: '4:5 Feed' },
                      { id: '1:1', label: '1:1 Persegi' },
                      { id: 'free', label: 'Bebas' },
                    ] as { id: CropAspect; label: string }[]
                  ).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => applyAspectCrop(item.id)}
                      className={`min-h-[38px] px-2 rounded-lg text-xs font-medium border transition-colors ${
                        activeProject.cropAspect === item.id
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="space-y-3 pt-1">
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500 dark:text-zinc-400">Geser Horizontal (X)</span>
                      <span className="font-mono tabular-nums">{activeProject.cropX}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, 100 - activeProject.cropW)}
                      value={activeProject.cropX}
                      onChange={(e) => onUpdateSettings({ cropX: Number(e.target.value) })}
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500 dark:text-zinc-400">Geser Vertikal (Y)</span>
                      <span className="font-mono tabular-nums">{activeProject.cropY}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, 100 - activeProject.cropH)}
                      value={activeProject.cropY}
                      onChange={(e) => onUpdateSettings({ cropY: Number(e.target.value) })}
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500 dark:text-zinc-400">Lebar Bingkai Crop</span>
                      <span className="font-mono tabular-nums">{activeProject.cropW}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={activeProject.cropW}
                      onChange={(e) => {
                        const nextW = Number(e.target.value);
                        const nextX = Math.min(activeProject.cropX, 100 - nextW);
                        onUpdateSettings({ cropW: nextW, cropX: nextX });
                      }}
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500 dark:text-zinc-400">Tinggi Bingkai Crop</span>
                      <span className="font-mono tabular-nums">{activeProject.cropH}%</span>
                    </div>
                    <input
                      type="range"
                      min={20}
                      max={100}
                      value={activeProject.cropH}
                      onChange={(e) => {
                        const nextH = Number(e.target.value);
                        const nextY = Math.min(activeProject.cropY, 100 - nextH);
                        onUpdateSettings({ cropH: nextH, cropY: nextY });
                      }}
                      className="w-full studio-slider"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 5: Precision Audio Sync & Input */}
          {inspectorTab === 'audio' && (
            <>
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Sumber Input Audio USB / Eksternal
                </label>
                <select
                  value={selectedAudioId}
                  onChange={(e) => {
                    setSelectedAudioId(e.target.value);
                    if (sourceMode === 'usb') {
                      void connectUsbToSlot(primarySlotId, selectedVideoId, e.target.value);
                    }
                  }}
                  className="w-full min-h-[40px] px-3 py-2 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100"
                >
                  {audioDevices.length === 0 ? (
                    <option value="">Audio HDMI / Mikrofon Default</option>
                  ) : (
                    audioDevices.map((dev, idx) => (
                      <option key={dev.deviceId || idx} value={dev.deviceId}>
                        {dev.label || `Input Audio USB #${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    Sinkronisasi Audio Presisi
                  </span>
                  <span className="text-xs font-mono tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                    {activeProject.audioSyncMs >= 0
                      ? `+${activeProject.audioSyncMs} ms`
                      : `${activeProject.audioSyncMs} ms`}
                  </span>
                </div>

                <input
                  type="range"
                  min={-500}
                  max={500}
                  step={1}
                  value={activeProject.audioSyncMs}
                  onChange={(e) =>
                    onUpdateSettings({ audioSyncMs: Number(e.target.value) })
                  }
                  className="w-full studio-slider"
                />

                <div className="grid grid-cols-5 gap-1">
                  {[-10, -1, 0, 1, 10].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => {
                        if (delta === 0) {
                          onUpdateSettings({ audioSyncMs: 0 });
                        } else {
                          const next = Math.max(
                            -500,
                            Math.min(500, activeProject.audioSyncMs + delta)
                          );
                          onUpdateSettings({ audioSyncMs: next });
                        }
                      }}
                      className="min-h-[36px] rounded-md bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-[11px] font-mono tabular-nums text-zinc-800 dark:text-zinc-200"
                    >
                      {delta === 0 ? '0 ms' : delta > 0 ? `+${delta}` : `${delta}`}
                    </button>
                  ))}
                </div>

                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  Nilai positif menunda jalur audio melalui Web Audio DelayNode secara presisi untuk
                  menyamakan latensi dekoding HDMI Micro-USB.
                </p>

                <button
                  type="button"
                  onClick={triggerSyncCalibrationTest}
                  className={`w-full min-h-[42px] px-4 rounded-lg text-xs font-semibold border transition-colors ${
                    syncFlashActive
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-800 dark:text-zinc-200'
                  }`}
                >
                  Uji Kalibrasi A/V Sync (Kilat + Nada 1 kHz)
                </button>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-600 dark:text-zinc-400">Penguatan Input (Gain)</span>
                  <span className="font-mono tabular-nums">{Math.round(audioGain * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={audioGain}
                  onChange={(e) => setAudioGain(Number(e.target.value))}
                  className="w-full studio-slider"
                />
              </div>
            </>
          )}

          {/* TAB 6: Direct-to-SD Card & Android 10 Micro-USB OTG */}
          {inspectorTab === 'storage' && (
            <>
              <div className="space-y-3">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Penyimpanan Langsung Kartu SD Eksternal
                </span>

                <button
                  type="button"
                  onClick={() => void handleMountSd()}
                  className="w-full min-h-[42px] px-3.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                  <FolderOpen className="w-4 h-4" />
                  {sdDirectory
                    ? `Ganti Folder SD (${sdDirectory.name})`
                    : 'Pilih Folder Kartu SD / Lokal'}
                </button>

                {sdFeedback && (
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    {sdFeedback}
                  </p>
                )}

                <div className="space-y-1.5">
                  <label className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                    Jalur Penyimpanan Android SD Card (SAF / Legacy)
                  </label>
                  <input
                    type="text"
                    maxLength={BLUEPRINT_LIMITS.SD_PATH_MAX}
                    value={activeProject.sdStoragePath}
                    onChange={(e) => onUpdateSettings({ sdStoragePath: e.target.value })}
                    className="w-full min-h-[38px] px-3 py-1.5 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Pemisahan File Otomatis FAT32 (Kartu SD)
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {([2, 4, 0] as const).map((gb) => (
                    <button
                      key={gb}
                      type="button"
                      onClick={() => onUpdateSettings({ sdSplitGb: gb })}
                      className={`min-h-[38px] rounded-lg text-xs font-mono tabular-nums border transition-colors ${
                        activeProject.sdSplitGb === gb
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100 font-semibold'
                          : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {gb === 0 ? 'Tanpa Split' : `${gb} GB`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
                  Estimasi batas 4 GB pada bitrate {activeProject.videoBitrateMbps} Mbps:{' '}
                  ~{Math.max(1, Math.round(storageEstimate.minutesPer4Gb))} menit/segmen.
                </p>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
                <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  Mode Kompatibilitas USB OTG
                </span>
                <div className="space-y-1.5">
                  {[
                    {
                      id: 'android10_micro_usb' as const,
                      title: 'Android 10 & ke Bawah (Micro-USB 2.0)',
                      desc: 'Optimasi MJPEG 480 Mbps & izin kartu SD legacy.',
                    },
                    {
                      id: 'android11_usbc' as const,
                      title: 'Android 11+ (USB-C UVC 3.0)',
                      desc: 'Bandwidth penuh 4K60 & Scoped Storage SAF.',
                    },
                    {
                      id: 'desktop_uvc' as const,
                      title: 'Desktop / Tablet Workstation',
                      desc: 'Bitrate tinggi hingga 80 Mbps tanpa batasan USB 2.0.',
                    },
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => onUpdateSettings({ deviceProfile: mode.id })}
                      className={`w-full p-2.5 rounded-lg text-left border transition-colors ${
                        activeProject.deviceProfile === mode.id
                          ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30'
                          : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                        {mode.title}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        {mode.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
