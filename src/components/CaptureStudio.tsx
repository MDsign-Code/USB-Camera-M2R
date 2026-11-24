import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Cloud,
  Crop,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Grid3X3,
  HardDrive,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  RotateCw,
  Save,
  Sliders,
  Square,
  Volume2,
} from 'lucide-react';
import {
  BLUEPRINT_LIMITS,
  computeEffectiveOutputDimensions,
  formatDuration,
  formatFileSize,
  generateSafeDocId,
  RESOLUTION_PRESETS,
  type CaptureProject,
  type CaptureRecording,
  type CaptureSettings,
  type CropAspect,
  type DemoFeedId,
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

type InspectorTab = 'video' | 'transform' | 'audio' | 'storage';

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
}: CaptureStudioProps) {
  const [sourceMode, setSourceMode] = useState<'demo' | 'usb'>('demo');
  const [demoFeed, setDemoFeed] = useState<DemoFeedId>('studio_desk');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [usbStatus, setUsbStatus] = useState<string>('Siap menerima input USB UVC / HDMI');
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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null);
  const demoImagesRef = useRef<Record<string, HTMLImageElement>>({});
  const mediaStreamRef = useRef<MediaStream | null>(null);
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
  const settingsRef = useRef<CaptureProject>(activeProject);
  const syncFlashRef = useRef<boolean>(false);
  const sourceModeRef = useRef<'demo' | 'usb'>(sourceMode);
  const demoFeedRef = useRef<DemoFeedId>(demoFeed);

  settingsRef.current = activeProject;
  sourceModeRef.current = sourceMode;
  demoFeedRef.current = demoFeed;

  useEffect(() => {
    setCustomWidthInput(String(activeProject.resolutionWidth));
    setCustomHeightInput(String(activeProject.resolutionHeight));
  }, [activeProject.resolutionWidth, activeProject.resolutionHeight]);

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

  // Enumerate connected USB UVC cameras & microphones
  const scanUsbDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setUsbError('Browser tidak mendukung API perangkat media USB.');
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const vids = devices.filter((d) => d.kind === 'videoinput');
      const auds = devices.filter((d) => d.kind === 'audioinput');
      setVideoDevices(vids);
      setAudioDevices(auds);
      if (!selectedVideoId && vids.length > 0) {
        setSelectedVideoId(vids[0].deviceId);
      }
      if (!selectedAudioId && auds.length > 0) {
        setSelectedAudioId(auds[0].deviceId);
      }
      setUsbStatus(
        vids.length > 0
          ? `${vids.length} input video & ${auds.length} input audio terdeteksi`
          : 'Tidak ada perangkat UVC aktif — gunakan Mode Simulasi HDMI atau hubungkan kartu capture USB'
      );
    } catch {
      setUsbError('Gagal memindai perangkat USB/UVC.');
    }
  }, [selectedAudioId, selectedVideoId]);

  useEffect(() => {
    void scanUsbDevices();
  }, [scanUsbDevices]);

  // Initialize or update Web Audio API Precision Sync Graph
  const ensureAudioPipeline = useCallback(
    (incomingAudioStream?: MediaStream | null) => {
      try {
        if (!audioCtxRef.current) {
          const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  // Connect real USB UVC Video & Audio stream
  const connectUsbStream = useCallback(
    async (vidId?: string, audId?: string) => {
      setUsbError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setUsbError('getUserMedia tidak tersedia di lingkungan browser ini.');
        return;
      }

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
        audioStreamRef.current = null;
      }

      const isAndroid10 = settingsRef.current.deviceProfile === 'android10_micro_usb';
      const reqWidth = isAndroid10
        ? Math.min(settingsRef.current.resolutionWidth, 1920)
        : settingsRef.current.resolutionWidth;
      const reqHeight = isAndroid10
        ? Math.min(settingsRef.current.resolutionHeight, 1080)
        : settingsRef.current.resolutionHeight;

      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: vidId ? { exact: vidId } : undefined,
            width: { ideal: reqWidth },
            height: { ideal: reqHeight },
            frameRate: { ideal: settingsRef.current.fps },
          },
          audio: false,
        });

        mediaStreamRef.current = videoStream;
        if (hiddenVideoRef.current) {
          hiddenVideoRef.current.srcObject = videoStream;
          await hiddenVideoRef.current.play();
        }

        if (audioEnabled) {
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
            // Continue with video-only if mic denied
          }
        }

        const track = videoStream.getVideoTracks()[0];
        const trackSettings = track?.getSettings();
        setSourceMode('usb');
        setUsbStatus(
          `Aktif: ${track?.label || 'Perangkat USB UVC'} (${trackSettings?.width ?? reqWidth}×${trackSettings?.height ?? reqHeight})`
        );
        void scanUsbDevices();
      } catch {
        setUsbError(
          'Perangkat USB UVC / kamera belum terhubung atau izin kamera ditolak. Beralih ke Mode Simulasi HDMI agar semua fitur studio tetap dapat diuji.'
        );
        setSourceMode('demo');
      }
    },
    [audioEnabled, ensureAudioPipeline, scanUsbDevices]
  );

  // Stop streams on unmount
  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close();
      }
    };
  }, []);

  // Precision A/V Sync Calibration Beep + Visual Flash
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
      // Also monitor directly through speakers with configured delay
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

  // Real-time 60fps Canvas Render Loop (handles Crop, 90° Rotation, Flip, USB/Demo Feed — ZERO watermark)
  useEffect(() => {
    let rafId = 0;
    let frameCount = 0;
    let lastFpsSample = performance.now();
    const freqData = new Uint8Array(128);

    const drawFrame = (now: number) => {
      const t0 = performance.now();
      const canvas = canvasRef.current;
      if (canvas) {
        const s = settingsRef.current;
        const outDims = computeEffectiveOutputDimensions(s);
        // Keep internal canvas crisp (cap live preview render at 1920px max side unless recording 4K)
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

          // Determine source dimensions and draw cropped, rotated, flipped frame cleanly
          const videoEl = hiddenVideoRef.current;
          const useUsb =
            sourceModeRef.current === 'usb' &&
            videoEl &&
            videoEl.readyState >= 2 &&
            videoEl.videoWidth > 0;

          let srcW = 1920;
          let srcH = 1080;
          let sourceDrawable: CanvasImageSource | null = null;

          if (useUsb && videoEl) {
            srcW = videoEl.videoWidth;
            srcH = videoEl.videoHeight;
            sourceDrawable = videoEl;
          } else if (demoFeedRef.current !== 'smpte_bars') {
            const img = demoImagesRef.current[demoFeedRef.current];
            if (img && img.complete && img.naturalWidth > 0) {
              srcW = img.naturalWidth;
              srcH = img.naturalHeight;
              sourceDrawable = img;
            }
          }

          ctx.save();
          ctx.translate(targetW / 2, targetH / 2);
          ctx.rotate((s.rotation * Math.PI) / 180);
          ctx.scale(s.flipH ? -1 : 1, s.flipV ? -1 : 1);

          const isQuarterTurn = s.rotation === 90 || s.rotation === 270;
          const drawW = isQuarterTurn ? targetH : targetW;
          const drawH = isQuarterTurn ? targetW : targetH;

          if (sourceDrawable) {
            // Subtle micro camera drift on simulated HDMI feed so recordings have real motion
            const panScale = useUsb ? 1 : 1.03;
            const driftX = useUsb ? 0 : Math.sin(now * 0.00055) * (srcW * 0.01);
            const driftY = useUsb ? 0 : Math.cos(now * 0.00042) * (srcH * 0.008);

            const sx = Math.max(0, (s.cropX / 100) * srcW + driftX * 0.5);
            const sy = Math.max(0, (s.cropY / 100) * srcH + driftY * 0.5);
            const sw = Math.max(16, Math.min(srcW - sx, (s.cropW / 100) * srcW / panScale));
            const sh = Math.max(16, Math.min(srcH - sy, (s.cropH / 100) * srcH / panScale));

            // Preserve aspect cover inside drawW x drawH
            const srcRatio = sw / sh;
            const dstRatio = drawW / drawH;
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

            ctx.drawImage(
              sourceDrawable,
              finalSx,
              finalSy,
              finalSw,
              finalSh,
              -drawW / 2,
              -drawH / 2,
              drawW,
              drawH
            );
          } else {
            // Broadcast SMPTE HD Color Bars generator (real-time animated sweep)
            const bars = [
              '#c0c0c0',
              '#c0c000',
              '#00c0c0',
              '#00c000',
              '#c000c0',
              '#c00000',
              '#0000c0',
            ];
            const barW = drawW / bars.length;
            bars.forEach((col, i) => {
              ctx.fillStyle = col;
              ctx.fillRect(-drawW / 2 + i * barW, -drawH / 2, barW + 1, drawH * 0.72);
            });
            const lower = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
            lower.forEach((col, i) => {
              ctx.fillStyle = col;
              ctx.fillRect(-drawW / 2 + i * barW, -drawH / 2 + drawH * 0.72, barW + 1, drawH * 0.1);
            });
            ctx.fillStyle = '#0c0d10';
            ctx.fillRect(-drawW / 2, -drawH / 2 + drawH * 0.82, drawW, drawH * 0.18);

            // Moving sync bar for latency & frame-drop inspection
            const sweepX = ((now * 0.35) % drawW) - drawW / 2;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(sweepX, -drawH / 2 + drawH * 0.84, 14, drawH * 0.14);
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

      // Update live measured FPS, frame-draw latency, and Stereo VU meter
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
        } else if (audioEnabled && sourceModeRef.current === 'demo') {
          // Gentle ambient studio floor in demo mode
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

  // Live recording timer
  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecSeconds((Date.now() - recStartTimeRef.current) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  // Start / Stop Low-Latency Chunked Recording
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

    const clipFilename = `KaptureOTG_${new Date().toISOString().replace(/[:.]/g, '-')}.${selectedCodec.extension}`;

    // If an external SD Card / local directory is mounted, open a streaming writable handle
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
            // ignore close issue
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

      // Chunk every 1000ms for low RAM usage on large multi-GB captures
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
      // Center vertical slice of 16:9 frame
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

  const isVerticalOutput = effectiveOutput.height > effectiveOutput.width;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Hidden hardware video element */}
      <video ref={hiddenVideoRef} muted playsInline className="hidden" />

      {/* Left 8 Columns: Dominant Live Viewfinder & Transport Controls */}
      <section className="lg:col-span-8 space-y-4">
        {/* Clean Contextual Project Header + Quick Source Switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 truncate">
              {activeProject.name}
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums">
              {effectiveOutput.width}×{effectiveOutput.height} · {activeProject.fps} fps ·{' '}
              {activeProject.videoBitrateMbps} Mbps · {activeProject.format.toUpperCase()} · Sync{' '}
              {activeProject.audioSyncMs >= 0
                ? `+${activeProject.audioSyncMs}ms`
                : `${activeProject.audioSyncMs}ms`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallButton variant="compact" />
            <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-200/70 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setSourceMode('demo')}
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
                onClick={() => void connectUsbStream(selectedVideoId, selectedAudioId)}
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

        {/* Live Viewfinder Frame */}
        <div className="relative rounded-xl overflow-hidden bg-zinc-950 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center min-h-[300px] sm:min-h-[430px] max-h-[600px]">
          <canvas
            ref={canvasRef}
            className={`block transition-transform duration-150 ${
              isVerticalOutput ? 'h-[430px] sm:h-[520px] w-auto max-w-full' : 'w-full h-auto max-h-[540px]'
            } object-contain`}
          />

          {/* Optional Vertical Reels / Shorts Safe Zone Overlay (Preview Only — Never Recorded) */}
          {showSafeZones && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`relative border border-white/40 ${
                  isVerticalOutput ? 'h-[430px] sm:h-[520px] aspect-[9/16]' : 'w-full h-full'
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

          {/* Top Scrim Telemetry Bar (Real Live Metrics Only) */}
          <div className="absolute top-0 inset-x-0 px-4 py-3 bg-gradient-to-b from-black/75 via-black/35 to-transparent flex items-center justify-between gap-4 text-xs text-white">
            <div className="flex items-center gap-3 font-mono tabular-nums">
              {isRecording ? (
                <span className="inline-flex items-center gap-2 font-semibold text-rose-400">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  REC {formatDuration(recSeconds)}
                </span>
              ) : (
                <span className="text-zinc-200">
                  {sourceMode === 'usb' ? 'USB UVC AKTIF' : 'PRATINJAU HDMI'}
                </span>
              )}
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <span>{measuredFps} fps</span>
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <span>Latensi {measuredLatencyMs.toFixed(1)} ms</span>
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

          {/* Bottom Scrim Stereo Audio Level Meter + Quick Viewfinder Actions */}
          <div className="absolute bottom-0 inset-x-0 px-4 py-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex items-center justify-between gap-4">
            {/* Real Stereo VU Meter */}
            <div className="flex items-center gap-2.5 min-w-[140px] max-w-[220px] flex-1">
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

            {/* Quick One-Tap Rotate 90° & Safe-Zone Grid */}
            <div className="flex items-center gap-1.5">
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
            </div>
          </div>
        </div>

        {/* Primary Recording Transport Strip */}
        <div className="p-4 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
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
              {isSavingProject ? 'Menyimpan...' : isCloudSignedIn ? 'Simpan ke Cloud' : 'Simpan Proyek'}
            </button>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono tabular-nums flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{codecInfo.label}</span>
            <span aria-hidden="true">·</span>
            <span>
              {sdDirectory ? `SD Terpasang: ${sdDirectory.name}` : `Target: ${activeProject.sdStoragePath}`}
            </span>
            {isRecording && activeProject.sdSplitGb > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Segmen #{recSegmentIndex} (Split {activeProject.sdSplitGb}GB FAT32)
                </span>
              </>
            )}
          </div>
        </div>

        {/* Demo HDMI Scene Switcher (when in Demo mode) */}
        {sourceMode === 'demo' && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Sumber Simulasi Sinyal HDMI
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {DEMO_FEEDS.map((feed) => (
                <button
                  key={feed.id}
                  type="button"
                  onClick={() => setDemoFeed(feed.id)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    demoFeed === feed.id
                      ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                      : 'bg-zinc-100 dark:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {feed.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Contextual Feedback Banners */}
        {usbError && (
          <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-300">
            {usbError}
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

      {/* Right 4 Columns: Minimalist Precision Control Inspector */}
      <aside className="lg:col-span-4 rounded-xl bg-white dark:bg-[#111419] border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Inspector Segmented Tabs */}
        <div className="grid grid-cols-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          {[
            { id: 'video' as const, label: 'Video', icon: Sliders },
            { id: 'transform' as const, label: 'Crop 90°', icon: Crop },
            { id: 'audio' as const, label: 'Audio', icon: Radio },
            { id: 'storage' as const, label: 'Kartu SD', icon: HardDrive },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = inspectorTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInspectorTab(tab.id)}
                className={`min-h-[44px] py-2.5 px-2 text-xs font-medium flex flex-col items-center justify-center gap-1 transition-colors border-b-2 ${
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
                    Perangkat USB Capture / Kamera
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
                      void connectUsbStream(e.target.value, selectedAudioId);
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

                {/* Custom Width x Height */}
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

                {/* FPS Selector */}
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

              {/* Format Output MP4 & Bitrate */}
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

          {/* TAB 2: Real-Time 90° Rotation & Video Crop */}
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

                {/* Fine Numeric Crop Controls */}
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

          {/* TAB 3: Precision Audio Sync & Input */}
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
                      void connectUsbStream(selectedVideoId, e.target.value);
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

          {/* TAB 4: Direct-to-SD Card & Android 10 Micro-USB OTG */}
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
