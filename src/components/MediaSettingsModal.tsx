import { useEffect, useRef } from 'react';
import {
  Camera,
  CameraOff,
  Headphones,
  Mic,
  MicOff,
  RefreshCw,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { soundEngine } from '../utils/sound.ts';

interface MediaSettingsModalProps {
  open: boolean;
  inRoom: boolean;
  localStream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  micLoopback: boolean;
  localAudioLevel: number;
  mediaError: string | null;
  isRequestingMedia: boolean;
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  audioOutputDevices: MediaDeviceInfo[];
  selectedVideoId: string;
  selectedAudioId: string;
  selectedAudioOutputId: string;
  onClose: () => void;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onToggleMicLoopback: (enabled: boolean) => void;
  onSwitchCamera: (deviceId: string) => void;
  onSwitchMicrophone: (deviceId: string) => void;
  onSwitchAudioOutput: (deviceId: string) => void;
  onRefreshDevices: () => void;
  onReconnectPeers?: () => void;
}

export function MediaSettingsModal({
  open,
  inRoom,
  localStream,
  cameraOn,
  micOn,
  micLoopback,
  localAudioLevel,
  mediaError,
  isRequestingMedia,
  videoDevices,
  audioDevices,
  audioOutputDevices,
  selectedVideoId,
  selectedAudioId,
  selectedAudioOutputId,
  onClose,
  onToggleCamera,
  onToggleMic,
  onToggleMicLoopback,
  onSwitchCamera,
  onSwitchMicrophone,
  onSwitchAudioOutput,
  onRefreshDevices,
  onReconnectPeers,
}: MediaSettingsModalProps) {
  const previewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) {
      onToggleMicLoopback(false);
      return;
    }
    onRefreshDevices();
  }, [open, onRefreshDevices, onToggleMicLoopback]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (open && localStream && cameraOn && localStream.getVideoTracks().length > 0) {
      el.srcObject = localStream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [open, localStream, cameraOn]);

  if (!open) return null;

  const supportsSinkId =
    typeof HTMLMediaElement !== 'undefined' &&
    'setSinkId' in HTMLMediaElement.prototype;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Ustawienia kamery i mikrofonu"
    >
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#161A22] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              Opcje kamery i mikrofonu
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Wybierz kamerę, mikrofon oraz głośniki i przetestuj obraz oraz dźwięk.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Live camera preview + quick toggles */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-12">
          <div className="sm:col-span-6 relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-[#0F1115]">
            {localStream && cameraOn && localStream.getVideoTracks().length > 0 ? (
              <video
                ref={previewRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover scale-x-[-1]"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center text-xs text-slate-400">
                <CameraOff className="h-6 w-6 mb-1.5 text-slate-500" />
                Kamera wyłączona
              </div>
            )}
          </div>

          <div className="sm:col-span-6 flex flex-col justify-between gap-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isRequestingMedia}
                onClick={onToggleCamera}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  cameraOn
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : 'border-white/15 bg-[#0F1115] text-slate-200 hover:bg-white/5'
                }`}
              >
                {cameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                {cameraOn ? 'Kamera wł.' : 'Włącz kamerę'}
              </button>

              <button
                type="button"
                disabled={isRequestingMedia}
                onClick={onToggleMic}
                className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  micOn
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                    : 'border-white/15 bg-[#0F1115] text-slate-200 hover:bg-white/5'
                }`}
              >
                {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                {micOn ? 'Mikrofon wł.' : 'Włącz mik.'}
              </button>
            </div>

            {/* Live Mic Level Meter + Self-Listen Toggle */}
            <div className="rounded-xl border border-white/8 bg-[#10131A] p-3">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="font-medium text-slate-300">Poziom mikrofonu</span>
                <span className="font-mono text-[11px] tabular-nums text-slate-400">
                  {micOn ? `${localAudioLevel}%` : 'Wyciszony'}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full transition-all duration-75 ${
                    localAudioLevel > 65
                      ? 'bg-amber-400'
                      : localAudioLevel > 6
                        ? 'bg-emerald-400'
                        : 'bg-slate-600'
                  }`}
                  style={{ width: `${micOn ? Math.max(4, localAudioLevel) : 0}%` }}
                />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  {!micOn
                    ? 'Włącz mikrofon, aby mówić'
                    : localAudioLevel > 8
                      ? 'Mikrofon działa poprawnie'
                      : 'Powiedz coś do mikrofonu'}
                </span>
                {micOn && (
                  <button
                    type="button"
                    onClick={() => onToggleMicLoopback(!micLoopback)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      micLoopback
                        ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                        : 'border-white/12 bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <Headphones className="h-3 w-3" />
                    {micLoopback ? 'Wyłącz odsłuch' : 'Usłysz siebie'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {mediaError && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200"
          >
            {mediaError}
          </div>
        )}

        {/* Device Selectors */}
        <div className="mt-5 space-y-4">
          <div>
            <label htmlFor="select-camera" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Kamera
            </label>
            <select
              id="select-camera"
              value={selectedVideoId}
              onChange={(e) => onSwitchCamera(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
            >
              {videoDevices.length === 0 ? (
                <option value="">Brak wykrytych kamer (kliknij „Włącz kamerę” aby nadać dostęp)</option>
              ) : (
                videoDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Kamera ${i + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label htmlFor="select-mic" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Mikrofon
            </label>
            <select
              id="select-mic"
              value={selectedAudioId}
              onChange={(e) => onSwitchMicrophone(e.target.value)}
              className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
            >
              {audioDevices.length === 0 ? (
                <option value="">Brak wykrytych mikrofonów (kliknij „Włącz mik.” aby nadać dostęp)</option>
              ) : (
                audioDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Mikrofon ${i + 1}`}
                  </option>
                ))
              )}
            </select>
          </div>

          {supportsSinkId && audioOutputDevices.length > 0 && (
            <div>
              <label
                htmlFor="select-speaker"
                className="block text-xs font-semibold text-slate-300 mb-1.5"
              >
                Głośniki / Słuchawki
              </label>
              <select
                id="select-speaker"
                value={selectedAudioOutputId}
                onChange={(e) => onSwitchAudioOutput(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-3.5 py-2.5 text-sm text-white focus:border-amber-400 focus:outline-none"
              >
                {audioOutputDevices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Wyjście audio ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Utility & Recovery actions */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onRefreshDevices}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#10131A] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Odśwież listę
            </button>

            <button
              type="button"
              onClick={() => soundEngine.playSolved()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#10131A] px-3 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Test głośników
            </button>

            {inRoom && onReconnectPeers && (
              <button
                type="button"
                onClick={onReconnectPeers}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Wifi className="h-3.5 w-3.5" />
                Odśwież połączenie
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
          >
            Gotowe
          </button>
        </div>
      </div>
    </div>
  );
}
