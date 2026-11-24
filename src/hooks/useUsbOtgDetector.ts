import { useCallback, useEffect, useRef, useState } from 'react';

interface WebUsbAlternateLike {
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
}

interface WebUsbInterfaceLike {
  interfaceNumber: number;
  alternates?: WebUsbAlternateLike[];
}

interface WebUsbConfigurationLike {
  interfaces?: WebUsbInterfaceLike[];
}

interface WebUsbDeviceLike {
  vendorId: number;
  productId: number;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  opened?: boolean;
  configuration?: WebUsbConfigurationLike | null;
}

interface WebUsbConnectionEventLike extends Event {
  device: WebUsbDeviceLike;
}

interface NavigatorWithUsb extends Navigator {
  usb?: {
    getDevices: () => Promise<WebUsbDeviceLike[]>;
    requestDevice: (options: {
      filters: Array<{ classCode?: number; vendorId?: number }>;
    }) => Promise<WebUsbDeviceLike>;
    addEventListener: (
      type: 'connect' | 'disconnect',
      listener: (event: WebUsbConnectionEventLike) => void
    ) => void;
    removeEventListener: (
      type: 'connect' | 'disconnect',
      listener: (event: WebUsbConnectionEventLike) => void
    ) => void;
  };
}

export interface DetectedUsbHardware {
  key: string;
  name: string;
  manufacturer: string;
  vendorHex: string;
  productHex: string;
  isUvcVideo: boolean;
}

export interface HotPlugNotice {
  type: 'connected' | 'disconnected';
  source: 'uvc_media' | 'webusb_otg';
  label: string;
  deviceId?: string;
  timestamp: number;
}

function formatUsbHex(num: number): string {
  return `0x${num.toString(16).toUpperCase().padStart(4, '0')}`;
}

function detectUvcInterface(dev: WebUsbDeviceLike): boolean {
  const ifaces = dev.configuration?.interfaces ?? [];
  for (const iface of ifaces) {
    for (const alt of iface.alternates ?? []) {
      if (alt.interfaceClass === 14) return true;
    }
  }
  // Known video capture / Yealink vendor IDs
  return [0x6993, 0x534d, 0x345f, 0x0fd9, 0x1bcf, 0x046d].includes(dev.vendorId);
}

function toHardwareRecord(dev: WebUsbDeviceLike): DetectedUsbHardware {
  const vendorHex = formatUsbHex(dev.vendorId);
  const productHex = formatUsbHex(dev.productId);
  const guessedMaker =
    dev.vendorId === 0x6993
      ? 'Yealink'
      : dev.vendorId === 0x534d || dev.vendorId === 0x345f
      ? 'MacroSilicon HDMI Capture'
      : 'USB UVC';

  return {
    key: `${vendorHex}:${productHex}:${dev.serialNumber || 'default'}`,
    name: dev.productName || `${guessedMaker} (${vendorHex}:${productHex})`,
    manufacturer: dev.manufacturerName || guessedMaker,
    vendorHex,
    productHex,
    isUvcVideo: detectUvcInterface(dev),
  };
}

export function isLikelyExternalUsbCamera(label: string, index: number, total: number): boolean {
  const lower = label.toLowerCase();
  if (
    lower.includes('usb') ||
    lower.includes('uvc') ||
    lower.includes('hdmi') ||
    lower.includes('capture') ||
    lower.includes('yealink') ||
    lower.includes('vc800') ||
    lower.includes('macro') ||
    lower.includes('ms2109') ||
    lower.includes('ms2130') ||
    lower.includes('external') ||
    lower.includes('webcam')
  ) {
    return true;
  }
  // Most Android phones expose built-in front/back as camera 0 & 1; external UVC appears at index >= 2
  if (total >= 3 && index >= 2 && !lower.includes('front') && !lower.includes('back')) {
    return true;
  }
  return false;
}

export function useUsbOtgDetector() {
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [usbHardwareList, setUsbHardwareList] = useState<DetectedUsbHardware[]>([]);
  const [hotPlugNotice, setHotPlugNotice] = useState<HotPlugNotice | null>(null);
  const [webUsbSupported, setWebUsbSupported] = useState<boolean>(false);
  const [usbPermissionError, setUsbPermissionError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  const prevVideoIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef<boolean>(false);

  const scanDevices = useCallback(async (isHotPlugEvent = false) => {
    setIsScanning(true);
    try {
      if (navigator.mediaDevices?.enumerateDevices) {
        const list = await navigator.mediaDevices.enumerateDevices();
        const vids = list.filter((d) => d.kind === 'videoinput');
        const auds = list.filter((d) => d.kind === 'audioinput');

        if (initializedRef.current && isHotPlugEvent) {
          const prevIds = prevVideoIdsRef.current;
          const newlyAdded = vids.find((v) => v.deviceId && !prevIds.has(v.deviceId));
          if (newlyAdded) {
            setHotPlugNotice({
              type: 'connected',
              source: 'uvc_media',
              label: newlyAdded.label || 'Kamera / Capture Card USB OTG Baru',
              deviceId: newlyAdded.deviceId,
              timestamp: Date.now(),
            });
          } else if (vids.length < prevIds.size) {
            setHotPlugNotice({
              type: 'disconnected',
              source: 'uvc_media',
              label: 'Perangkat kamera USB OTG dilepas',
              timestamp: Date.now(),
            });
          }
        }

        prevVideoIdsRef.current = new Set(vids.map((v) => v.deviceId).filter(Boolean));
        initializedRef.current = true;
        setVideoDevices(vids);
        setAudioDevices(auds);
      }

      const navUsb = (navigator as NavigatorWithUsb).usb;
      if (navUsb) {
        setWebUsbSupported(true);
        try {
          const paired = await navUsb.getDevices();
          setUsbHardwareList(paired.map(toHardwareRecord));
        } catch {
          // Blocked by iframe permissions policy
        }
      }
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    void scanDevices(false);

    const handleDeviceChange = () => {
      void scanDevices(true);
    };

    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);

    const navUsb = (navigator as NavigatorWithUsb).usb;
    const handleUsbConnect = (ev: WebUsbConnectionEventLike) => {
      const hw = toHardwareRecord(ev.device);
      setUsbHardwareList((prev) => {
        const exists = prev.some((item) => item.key === hw.key);
        return exists ? prev : [hw, ...prev];
      });
      setHotPlugNotice({
        type: 'connected',
        source: 'webusb_otg',
        label: `${hw.name} (${hw.vendorHex}:${hw.productHex}) tercolok via USB OTG`,
        timestamp: Date.now(),
      });
      void scanDevices(false);
    };

    const handleUsbDisconnect = (ev: WebUsbConnectionEventLike) => {
      const hw = toHardwareRecord(ev.device);
      setUsbHardwareList((prev) => prev.filter((item) => item.key !== hw.key));
      setHotPlugNotice({
        type: 'disconnected',
        source: 'webusb_otg',
        label: `${hw.name} dilepas dari port USB OTG`,
        timestamp: Date.now(),
      });
      void scanDevices(false);
    };

    if (navUsb) {
      setWebUsbSupported(true);
      navUsb.addEventListener('connect', handleUsbConnect);
      navUsb.addEventListener('disconnect', handleUsbDisconnect);
    }

    return () => {
      mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
      if (navUsb) {
        navUsb.removeEventListener('connect', handleUsbConnect);
        navUsb.removeEventListener('disconnect', handleUsbDisconnect);
      }
    };
  }, [scanDevices]);

  // Prompt Android Chrome WebUSB OTG device picker (UVC class 14 + Yealink + MacroSilicon)
  const requestWebUsbOtgDevice = useCallback(async () => {
    setUsbPermissionError(null);
    const navUsb = (navigator as NavigatorWithUsb).usb;
    if (!navUsb) {
      setUsbPermissionError(
        'Browser ini tidak mendukung WebUSB API. Gunakan Google Chrome di Android untuk mendeteksi perangkat USB OTG.'
      );
      return null;
    }

    try {
      const device = await navUsb.requestDevice({
        filters: [
          { classCode: 14 }, // Standard USB Video Class (UVC)
          { vendorId: 0x6993 }, // Yealink (VC800 / UVC series)
          { vendorId: 0x534d }, // MacroSilicon MS2109 HDMI-to-USB Capture
          { vendorId: 0x345f }, // MacroSilicon MS2130 USB 3.0 HDMI Capture
          { vendorId: 0x0fd9 }, // Elgato Cam Link
          { vendorId: 0x046d }, // Logitech UVC
          { vendorId: 0x1bcf }, // Sunplus / Generic USB OTG Camera
          { vendorId: 0x0c45 }, // Microdia UVC
        ],
      });
      const hw = toHardwareRecord(device);
      setUsbHardwareList((prev) => {
        const exists = prev.some((item) => item.key === hw.key);
        return exists ? prev : [hw, ...prev];
      });
      setHotPlugNotice({
        type: 'connected',
        source: 'webusb_otg',
        label: `Hardware USB OTG terbaca: ${hw.name} (${hw.vendorHex}:${hw.productHex})`,
        timestamp: Date.now(),
      });
      await scanDevices(false);
      return hw;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') {
        return null;
      }
      setUsbPermissionError(
        'Izin WebUSB OTG dibatasi di jendela pratinjau atau perangkat belum mendapat suplai daya OTG. Buka langsung di Chrome Android dan pastikan opsi Koneksi OTG di Pengaturan HP aktif.'
      );
      return null;
    }
  }, [scanDevices]);

  const dismissHotPlugNotice = useCallback(() => {
    setHotPlugNotice(null);
  }, []);

  return {
    videoDevices,
    audioDevices,
    usbHardwareList,
    hotPlugNotice,
    webUsbSupported,
    usbPermissionError,
    isScanning,
    scanDevices: () => scanDevices(false),
    requestWebUsbOtgDevice,
    dismissHotPlugNotice,
  };
}
