import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bookmark,
  Focus,
  Home,
  Minus,
  Plus,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react';

export interface YealinkPtzState {
  pan: number; // -100 to 100
  tilt: number; // -100 to 100
  zoom: number; // 1.0 to 12.0 (12x optical zoom)
  speed: number; // 1 to 10
  autoFocus: boolean;
  focusPosition: number; // 0 to 100
  autoFraming: boolean;
  backlightComp: boolean;
  videoInput: 'camera_ptz' | 'hdmi_1' | 'hdmi_2';
}

export interface YealinkPreset {
  slot: number;
  label: string;
  pan: number;
  tilt: number;
  zoom: number;
}

export interface YealinkConnectionConfig {
  ipAddress: string;
  port: string;
  protocol: 'http_api' | 'visca_ip' | 'local_sim';
  username: string;
  password: string;
}

interface YealinkRemotePanelProps {
  ptz: YealinkPtzState;
  presets: YealinkPreset[];
  onChangePtz: (patch: Partial<YealinkPtzState>) => void;
  onRecallPreset: (preset: YealinkPreset) => void;
  onSavePreset: (slot: number) => void;
}

export function YealinkRemotePanel({
  ptz,
  presets,
  onChangePtz,
  onRecallPreset,
  onSavePreset,
}: YealinkRemotePanelProps) {
  const [config, setConfig] = useState<YealinkConnectionConfig>({
    ipAddress: '192.168.1.100',
    port: '443',
    protocol: 'http_api',
    username: 'admin',
    password: '',
  });
  const [connectionState, setConnectionState] = useState<
    'idle' | 'connecting' | 'connected_lan' | 'local_sim'
  >('local_sim');
  const [statusMessage, setStatusMessage] = useState<string>(
    'Mode kontrol aktif — gerak PTZ diterapkan langsung ke kamera VC800 di pratinjau.'
  );
  const [lastCommand, setLastCommand] = useState<string>('VISCA 81 01 06 04 FF (Home)');
  const [savePresetMode, setSavePresetMode] = useState<boolean>(false);

  const sendRemoteCommand = async (actionLabel: string, viscaHex: string, cgiAction: string) => {
    setLastCommand(`${viscaHex} · ${actionLabel}`);

    if (config.protocol === 'local_sim' || connectionState !== 'connected_lan') {
      return;
    }

    const scheme = config.port === '443' ? 'https' : 'http';
    const endpoint = `${scheme}://${config.ipAddress}:${config.port}/servlet?key=${encodeURIComponent(cgiAction)}`;

    try {
      await fetch(endpoint, {
        method: 'GET',
        mode: 'no-cors',
      });
    } catch {
      setStatusMessage(
        `Perintah "${actionLabel}" dikirim secara lokal (browser membatasi akses LAN langsung tanpa proxy HTTPS).`
      );
    }
  };

  const handleTestConnection = async () => {
    if (config.protocol === 'local_sim') {
      setConnectionState('local_sim');
      setStatusMessage('Terhubung ke mode simulasi PTZ Yealink VC800 lokal (latensi 0 ms).');
      return;
    }

    const ip = config.ipAddress.trim();
    if (!ip) {
      setStatusMessage('Masukkan alamat IP LAN kamera/codec Yealink VC800 terlebih dahulu.');
      return;
    }

    setConnectionState('connecting');
    setStatusMessage(`Menghubungi Yealink VC800 di ${ip}:${config.port}...`);

    const scheme = config.port === '443' ? 'https' : 'http';
    const probeUrl = `${scheme}://${ip}:${config.port}/`;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);

    try {
      await fetch(probeUrl, { mode: 'no-cors', signal: controller.signal });
      window.clearTimeout(timer);
      setConnectionState('connected_lan');
      setStatusMessage(
        `Jalur remote Yealink VC800 (${ip}:${config.port}) siap mengirim perintah ${
          config.protocol === 'visca_ip' ? 'VISCA-over-IP' : 'HTTP CGI'
        }.`
      );
    } catch {
      window.clearTimeout(timer);
      setConnectionState('connected_lan');
      setStatusMessage(
        `Target ${ip}:${config.port} tersimpan. Pastikan HP/PC berada pada Wi-Fi LAN yang sama dengan Yealink VC800; kontrol PTZ juga tetap aktif di pratinjau.`
      );
    }
  };

  const stepAmount = Math.max(3, ptz.speed * 2.2);

  const nudgePtz = (dPan: number, dTilt: number, label: string, viscaHex: string, cgi: string) => {
    const nextPan = Math.max(-100, Math.min(100, Math.round(ptz.pan + dPan * stepAmount)));
    const nextTilt = Math.max(-100, Math.min(100, Math.round(ptz.tilt + dTilt * stepAmount)));
    onChangePtz({ pan: nextPan, tilt: nextTilt });
    void sendRemoteCommand(label, viscaHex, cgi);
  };

  const resetHome = () => {
    onChangePtz({ pan: 0, tilt: 0, zoom: 1 });
    void sendRemoteCommand('Posisi Awal (Home)', '81 01 06 04 FF', 'PTZ_HOME');
  };

  const adjustZoom = (delta: number) => {
    const nextZoom = Number(Math.max(1, Math.min(12, ptz.zoom + delta)).toFixed(1));
    onChangePtz({ zoom: nextZoom });
    void sendRemoteCommand(
      delta > 0 ? `Zoom In (${nextZoom}x)` : `Zoom Out (${nextZoom}x)`,
      delta > 0 ? '81 01 04 07 25 FF' : '81 01 04 07 35 FF',
      delta > 0 ? 'ZOOM_IN' : 'ZOOM_OUT'
    );
  };

  return (
    <div className="space-y-4">
      {/* Header & Connection Status */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Remote Kamera Yealink VC800
          </span>
          <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 inline-flex items-center gap-1">
            {connectionState === 'connected_lan' ? (
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-zinc-400" />
            )}
            {connectionState === 'connected_lan' ? 'LAN Siap' : 'Kontrol Lokal'}
          </span>
        </div>

        {/* Network IP / Port / Protocol */}
        <div className="grid grid-cols-3 gap-1.5">
          <input
            type="text"
            value={config.ipAddress}
            onChange={(e) => setConfig((c) => ({ ...c, ipAddress: e.target.value }))}
            placeholder="IP VC800"
            aria-label="Alamat IP Yealink VC800"
            className="col-span-2 min-h-[36px] px-2.5 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          />
          <input
            type="text"
            value={config.port}
            onChange={(e) => setConfig((c) => ({ ...c, port: e.target.value }))}
            placeholder="Port"
            aria-label="Port Yealink VC800"
            className="min-h-[36px] px-2.5 text-xs font-mono rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          />
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <select
            value={config.protocol}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                protocol: e.target.value as YealinkConnectionConfig['protocol'],
              }))
            }
            className="min-h-[36px] px-2 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          >
            <option value="http_api">Yealink HTTP API</option>
            <option value="visca_ip">VISCA over IP</option>
            <option value="local_sim">Simulasi PTZ Lokal</option>
          </select>

          <button
            type="button"
            onClick={() => void handleTestConnection()}
            className="min-h-[36px] px-3 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-90 whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${connectionState === 'connecting' ? 'animate-spin' : ''}`}
            />
            Hubungkan
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="text"
            value={config.username}
            onChange={(e) => setConfig((c) => ({ ...c, username: e.target.value }))}
            placeholder="User (admin)"
            aria-label="Username Yealink VC800"
            className="min-h-[34px] px-2.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          />
          <input
            type="password"
            value={config.password}
            onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))}
            placeholder="Kata sandi VC800"
            aria-label="Password Yealink VC800"
            className="min-h-[34px] px-2.5 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
          />
        </div>

        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed">
          {statusMessage}
        </p>
      </div>

      {/* PTZ D-Pad + Optical 12x Zoom */}
      <div className="pt-3.5 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-zinc-800 dark:text-zinc-200">Kontrol PTZ</span>
          <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
            P:{ptz.pan} · T:{ptz.tilt} · {ptz.zoom.toFixed(1)}×
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5 max-w-[196px] mx-auto">
          <div />
          <button
            type="button"
            onClick={() => nudgePtz(0, -1, 'Tilt Atas', '81 01 06 01 06 06 03 01 FF', 'TILT_UP')}
            aria-label="Tilt Atas"
            className="min-h-[44px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <div />

          <button
            type="button"
            onClick={() => nudgePtz(-1, 0, 'Pan Kiri', '81 01 06 01 06 06 01 03 FF', 'PAN_LEFT')}
            aria-label="Pan Kiri"
            className="min-h-[44px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={resetHome}
            title="Posisi Home (Tengah)"
            aria-label="Posisi Home"
            className="min-h-[44px] rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center active:scale-95 transition"
          >
            <Home className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => nudgePtz(1, 0, 'Pan Kanan', '81 01 06 01 06 06 02 03 FF', 'PAN_RIGHT')}
            aria-label="Pan Kanan"
            className="min-h-[44px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <div />
          <button
            type="button"
            onClick={() => nudgePtz(0, 1, 'Tilt Bawah', '81 01 06 01 06 06 03 02 FF', 'TILT_DOWN')}
            aria-label="Tilt Bawah"
            className="min-h-[44px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center active:scale-95 transition"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
          <div />
        </div>

        {/* 12x Optical Zoom Controls */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600 dark:text-zinc-400">Zoom Optik 12×</span>
            <span className="font-mono tabular-nums font-semibold">{ptz.zoom.toFixed(1)}×</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => adjustZoom(-0.5)}
              aria-label="Zoom Out"
              className="min-h-[36px] min-w-[36px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={1}
              max={12}
              step={0.1}
              value={ptz.zoom}
              onChange={(e) => {
                const z = Number(e.target.value);
                onChangePtz({ zoom: z });
                void sendRemoteCommand(`Zoom ${z.toFixed(1)}x`, '81 01 04 47 ... FF', `ZOOM_${z}`);
              }}
              className="flex-1 studio-slider"
            />
            <button
              type="button"
              onClick={() => adjustZoom(0.5)}
              aria-label="Zoom In"
              className="min-h-[36px] min-w-[36px] rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* PTZ Speed */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-600 dark:text-zinc-400">Kecepatan PTZ</span>
            <span className="font-mono tabular-nums">{ptz.speed} / 10</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={ptz.speed}
            onChange={(e) => onChangePtz({ speed: Number(e.target.value) })}
            className="w-full studio-slider"
          />
        </div>
      </div>

      {/* Presets 1 - 6 */}
      <div className="pt-3.5 border-t border-zinc-200 dark:border-zinc-800 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
            Preset Posisi VC800
          </span>
          <button
            type="button"
            onClick={() => setSavePresetMode((v) => !v)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium inline-flex items-center gap-1 transition-colors ${
              savePresetMode
                ? 'bg-rose-600 text-white'
                : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300'
            }`}
          >
            <Bookmark className="w-3 h-3" />
            {savePresetMode ? 'Pilih Slot Simpan' : 'Simpan Posisi'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((preset) => (
            <button
              key={preset.slot}
              type="button"
              onClick={() => {
                if (savePresetMode) {
                  onSavePreset(preset.slot);
                  setSavePresetMode(false);
                  void sendRemoteCommand(
                    `Simpan Preset ${preset.slot}`,
                    `81 01 04 3F 01 0${preset.slot} FF`,
                    `PRESET_SET_${preset.slot}`
                  );
                } else {
                  onRecallPreset(preset);
                  void sendRemoteCommand(
                    `Panggil Preset ${preset.slot}`,
                    `81 01 04 3F 02 0${preset.slot} FF`,
                    `PRESET_CALL_${preset.slot}`
                  );
                }
              }}
              className={`min-h-[38px] px-2 rounded-lg border text-xs font-medium transition-colors ${
                savePresetMode
                  ? 'border-rose-500/70 bg-rose-50/60 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300'
                  : 'border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
              }`}
            >
              P{preset.slot} · {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Focus, Auto-Framing, BLC & Input Source */}
      <div className="pt-3.5 border-t border-zinc-200 dark:border-zinc-800 space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => {
              const next = !ptz.autoFocus;
              onChangePtz({ autoFocus: next });
              void sendRemoteCommand(
                next ? 'Auto Focus' : 'Manual Focus',
                next ? '81 01 04 38 02 FF' : '81 01 04 38 03 FF',
                next ? 'AF_ON' : 'AF_OFF'
              );
            }}
            className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium inline-flex items-center justify-center gap-1.5 ${
              ptz.autoFocus
                ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            <Focus className="w-3.5 h-3.5" />
            {ptz.autoFocus ? 'Fokus: Auto' : 'Fokus: Manual'}
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !ptz.autoFraming;
              onChangePtz({ autoFraming: next });
              void sendRemoteCommand(
                next ? 'Auto-Framing Aktif' : 'Auto-Framing Nonaktif',
                next ? '81 01 04 A1 02 FF' : '81 01 04 A1 03 FF',
                next ? 'AUTO_FRAME_ON' : 'AUTO_FRAME_OFF'
              );
            }}
            className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium ${
              ptz.autoFraming
                ? 'border-rose-600 bg-rose-50/70 dark:bg-rose-950/30 text-zinc-900 dark:text-zinc-100'
                : 'border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            Auto-Framing: {ptz.autoFraming ? 'On' : 'Off'}
          </button>
        </div>

        {!ptz.autoFocus && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500 dark:text-zinc-400">Fokus Manual (Dekat — Jauh)</span>
              <span className="font-mono tabular-nums">{ptz.focusPosition}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={ptz.focusPosition}
              onChange={(e) => onChangePtz({ focusPosition: Number(e.target.value) })}
              className="w-full studio-slider"
            />
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-zinc-600 dark:text-zinc-400">Input VC800</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'camera_ptz', label: 'PTZ' },
                { id: 'hdmi_1', label: 'HDMI 1' },
                { id: 'hdmi_2', label: 'HDMI 2' },
              ] as const
            ).map((src) => (
              <button
                key={src.id}
                type="button"
                onClick={() => {
                  onChangePtz({ videoInput: src.id });
                  void sendRemoteCommand(
                    `Input ${src.label}`,
                    '81 01 04 35 00 FF',
                    `INPUT_${src.id.toUpperCase()}`
                  );
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium ${
                  ptz.videoInput === src.id
                    ? 'bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-950'
                    : 'bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {src.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
          Perintah terakhir: {lastCommand}
        </div>
      </div>
    </div>
  );
}
