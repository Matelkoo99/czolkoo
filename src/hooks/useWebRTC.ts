import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, ServerMessage } from '../shared/types.ts';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 6,
};

const TARGET_AUDIO_SAMPLE_RATE = 16000;

function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return window.btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = window.atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}

function downsampleTo16k(input: Float32Array, inputRate: number): Int16Array {
  if (inputRate === TARGET_AUDIO_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = inputRate / TARGET_AUDIO_SAMPLE_RATE;
  const outLength = Math.max(1, Math.round(input.length / ratio));
  const out = new Int16Array(outLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < outLength) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    const sample = count > 0 ? accum / count : 0;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[offsetResult] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return out;
}

interface PeerEntry {
  peerId: string;
  pc: RTCPeerConnection;
  remoteStream: MediaStream;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingIce: RTCIceCandidateInit[];
  iceRestartTimer: number | null;
}

export function useWebRTC(params: {
  myPlayerId: string | null;
  peerIds: string[];
  send: (msg: ClientMessage) => void;
  getBufferedAmount?: () => number;
}) {
  const { myPlayerId, peerIds, send, getBufferedAmount } = params;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteFrames, setRemoteFrames] = useState<Record<string, string>>({});
  const [remoteSpeaking, setRemoteSpeaking] = useState<Record<string, boolean>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});

  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micLoopback, setMicLoopback] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isRequestingMedia, setIsRequestingMedia] = useState(false);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);

  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputDevices, setAudioOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string>('');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState<string>('');

  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraOnRef = useRef(false);
  const micOnRef = useRef(false);
  const micLoopbackRef = useRef(false);
  const userTouchedMediaRef = useRef(false);

  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const sendRef = useRef(send);
  const getBufferedRef = useRef(getBufferedAmount);
  const myPlayerIdRef = useRef<string | null>(myPlayerId);

  // Playback AudioContext & per-peer jitter scheduler for WebSocket voice audio
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const peerNextPlayTimeRef = useRef<Record<string, number>>({});
  const remoteSpeakingTimersRef = useRef<Record<string, number>>({});

  // Off-DOM video & canvas for guaranteed WebSocket camera frame streaming
  const captureVideoElRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  sendRef.current = send;
  getBufferedRef.current = getBufferedAmount;
  myPlayerIdRef.current = myPlayerId;
  cameraOnRef.current = cameraOn;
  micOnRef.current = micOn;
  micLoopbackRef.current = micLoopback;

  const getOrInitPlaybackContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    if (!playbackCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      playbackCtxRef.current = new AudioCtx();
    }
    if (playbackCtxRef.current.state === 'suspended') {
      playbackCtxRef.current.resume().catch(() => {});
    }
    return playbackCtxRef.current;
  }, []);

  // Automatically unlock Web Audio API playback on any user interaction
  useEffect(() => {
    const unlock = () => {
      const ctx = getOrInitPlaybackContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    return () => {
      window.removeEventListener('click', unlock);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, [getOrInitPlaybackContext]);

  const rebuildLocalStreamState = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (videoTrackRef.current && videoTrackRef.current.readyState === 'live') {
      tracks.push(videoTrackRef.current);
    }
    if (audioTrackRef.current && audioTrackRef.current.readyState === 'live') {
      tracks.push(audioTrackRef.current);
    }
    setLocalStream(tracks.length > 0 ? new MediaStream(tracks) : null);

    // Keep off-DOM video element synced with current live video track
    if (typeof document !== 'undefined') {
      if (!captureVideoElRef.current) {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        captureVideoElRef.current = v;
      }
      if (videoTrackRef.current && videoTrackRef.current.readyState === 'live') {
        captureVideoElRef.current.srcObject = new MediaStream([videoTrackRef.current]);
        captureVideoElRef.current.play().catch(() => {});
      } else {
        captureVideoElRef.current.srcObject = null;
      }
    }
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      const mics = devices.filter((d) => d.kind === 'audioinput');
      const speakers = devices.filter((d) => d.kind === 'audiooutput');
      setVideoDevices(cams);
      setAudioDevices(mics);
      setAudioOutputDevices(speakers);

      const currentVideoId = videoTrackRef.current?.getSettings().deviceId;
      const currentAudioId = audioTrackRef.current?.getSettings().deviceId;

      if (currentVideoId) {
        setSelectedVideoId(currentVideoId);
      } else if (cams.length > 0) {
        setSelectedVideoId((prev) =>
          prev && cams.some((c) => c.deviceId === prev) ? prev : cams[0].deviceId,
        );
      }

      if (currentAudioId) {
        setSelectedAudioId(currentAudioId);
      } else if (mics.length > 0) {
        setSelectedAudioId((prev) =>
          prev && mics.some((m) => m.deviceId === prev) ? prev : mics[0].deviceId,
        );
      }

      if (speakers.length > 0) {
        setSelectedAudioOutputId((prev) =>
          prev && speakers.some((s) => s.deviceId === prev) ? prev : speakers[0].deviceId,
        );
      }
    } catch {
      // Ignore enumerate failure
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const handler = () => refreshDevices();
    md.addEventListener('devicechange', handler);
    return () => md.removeEventListener('devicechange', handler);
  }, [refreshDevices]);

  // Background camera frame capture -> WebSocket relay (guarantees every player sees cameras through any NAT)
  useEffect(() => {
    if (!cameraOn) return;

    if (!captureCanvasRef.current && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 180;
      captureCanvasRef.current = c;
    }

    const intervalId = window.setInterval(() => {
      if (!myPlayerIdRef.current || !cameraOnRef.current) return;
      const vTrack = videoTrackRef.current;
      if (!vTrack || vTrack.readyState !== 'live' || !vTrack.enabled) return;

      const buffered = getBufferedRef.current ? getBufferedRef.current() : 0;
      if (buffered > 128 * 1024) return;

      const videoEl = captureVideoElRef.current;
      const canvas = captureCanvasRef.current;
      if (!videoEl || !canvas) return;

      if (videoEl.paused) {
        videoEl.play().catch(() => {});
      }
      if (videoEl.readyState < 2 || videoEl.videoWidth === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
      sendRef.current({ type: 'media:video', frame: dataUrl });
    }, 115);

    return () => window.clearInterval(intervalId);
  }, [cameraOn, localStream]);

  // Background microphone PCM capture -> WebSocket voice relay + live VU meter + optional loopback test
  useEffect(() => {
    const audioTrack = audioTrackRef.current;
    if (!audioTrack || audioTrack.readyState !== 'live' || !micOn) {
      setLocalSpeaking(false);
      setLocalAudioLevel(0);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let muteGain: GainNode | null = null;
    let lastVoiceTime = 0;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      processor = audioCtx.createScriptProcessor(2048, 1, 1);
      muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;

      const inputSampleRate = audioCtx.sampleRate;

      processor.onaudioprocess = (ev) => {
        if (!micOnRef.current) return;
        const inputData = ev.inputBuffer.getChannelData(0);

        // Compute RMS audio level
        let sumSq = 0;
        for (let i = 0; i < inputData.length; i++) {
          sumSq += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sumSq / inputData.length);
        const level = Math.min(100, Math.round(rms * 380));
        setLocalAudioLevel(level);

        const now = Date.now();
        const isVoice = rms > 0.008;
        if (isVoice) {
          lastVoiceTime = now;
        }
        const withinHangover = now - lastVoiceTime < 360;
        setLocalSpeaking(isVoice || now - lastVoiceTime < 220);

        // Local microphone loopback test inside Settings Modal
        if (micLoopbackRef.current && (isVoice || withinHangover)) {
          const playCtx = getOrInitPlaybackContext();
          if (playCtx) {
            const buf = playCtx.createBuffer(1, inputData.length, inputSampleRate);
            buf.getChannelData(0).set(inputData);
            const src = playCtx.createBufferSource();
            src.buffer = buf;
            src.connect(playCtx.destination);
            src.start();
          }
        }

        // Transmit voice chunk to room over WebSocket
        if (myPlayerIdRef.current && (isVoice || withinHangover)) {
          const buffered = getBufferedRef.current ? getBufferedRef.current() : 0;
          if (buffered < 192 * 1024) {
            const int16 = downsampleTo16k(inputData, inputSampleRate);
            const b64 = int16ToBase64(int16);
            sendRef.current({
              type: 'media:audio',
              pcm: b64,
              sampleRate: TARGET_AUDIO_SAMPLE_RATE,
            });
          }
        }
      };

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);
    } catch {
      // Ignore Web Audio capture initialization error
    }

    return () => {
      try {
        source?.disconnect();
        processor?.disconnect();
        muteGain?.disconnect();
      } catch {
        // Ignore
      }
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
    };
  }, [localStream, micOn, getOrInitPlaybackContext]);

  // Play incoming remote PCM audio chunk with jitter-buffered scheduling
  const playRemoteAudioChunk = useCallback(
    (fromPlayerId: string, b64Pcm: string, sampleRate: number) => {
      const ctx = getOrInitPlaybackContext();
      if (!ctx) return;

      let int16: Int16Array;
      try {
        int16 = base64ToInt16(b64Pcm);
      } catch {
        return;
      }
      if (int16.length === 0) return;

      const float32 = new Float32Array(int16.length);
      let sumSq = 0;
      for (let i = 0; i < int16.length; i++) {
        const sample = int16[i] / 32768;
        float32[i] = sample;
        sumSq += sample * sample;
      }
      const rms = Math.sqrt(sumSq / int16.length);

      // Update remote speaking ring
      if (rms > 0.008) {
        setRemoteSpeaking((prev) => (prev[fromPlayerId] ? prev : { ...prev, [fromPlayerId]: true }));
        const prevTimer = remoteSpeakingTimersRef.current[fromPlayerId];
        if (prevTimer) window.clearTimeout(prevTimer);
        remoteSpeakingTimersRef.current[fromPlayerId] = window.setTimeout(() => {
          setRemoteSpeaking((prev) => ({ ...prev, [fromPlayerId]: false }));
        }, 380);
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
      audioBuffer.getChannelData(0).set(float32);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const now = ctx.currentTime;
      let startAt = peerNextPlayTimeRef.current[fromPlayerId] ?? 0;
      if (startAt < now || startAt > now + 0.6) {
        startAt = now + 0.035; // 35ms jitter cushion
      }
      source.start(startAt);
      peerNextPlayTimeRef.current[fromPlayerId] = startAt + audioBuffer.duration;
    },
    [getOrInitPlaybackContext],
  );

  const publishRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    const liveTracks = stream.getTracks().filter((t) => t.readyState !== 'ended');
    setRemoteStreams((prev) => ({
      ...prev,
      [peerId]: new MediaStream(liveTracks),
    }));
  }, []);

  /**
   * Ensures canonical transceiver order [0: audio, 1: video] on ANY peer connection
   * so m-line order in Unified Plan SDP never mismatches between polite and impolite peers.
   */
  const ensureCanonicalTransceivers = useCallback((pc: RTCPeerConnection) => {
    const existing = pc.getTransceivers();
    const hasAudio = existing.some(
      (t) => t.receiver.track?.kind === 'audio' || t.sender.track?.kind === 'audio',
    );
    const hasVideo = existing.some(
      (t) => t.receiver.track?.kind === 'video' || t.sender.track?.kind === 'video',
    );

    if (!hasAudio) {
      const aTrack =
        audioTrackRef.current && audioTrackRef.current.readyState === 'live'
          ? audioTrackRef.current
          : null;
      pc.addTransceiver(aTrack ?? 'audio', { direction: 'sendrecv' });
    }
    if (!hasVideo) {
      const vTrack =
        videoTrackRef.current && videoTrackRef.current.readyState === 'live'
          ? videoTrackRef.current
          : null;
      pc.addTransceiver(vTrack ?? 'video', { direction: 'sendrecv' });
    }
  }, []);

  const syncTrackToPeer = useCallback(
    async (entry: PeerEntry, kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
      const { pc } = entry;
      if (pc.signalingState === 'closed') return;

      ensureCanonicalTransceivers(pc);
      const transceivers = pc.getTransceivers();
      const matching = transceivers.find(
        (t) => t.receiver.track?.kind === kind || t.sender.track?.kind === kind,
      );

      if (matching) {
        try {
          await matching.sender.replaceTrack(track);
          if (matching.direction !== 'sendrecv') {
            matching.direction = 'sendrecv';
          }
        } catch {
          // Ignore if transceiver stopped
        }
      }
    },
    [ensureCanonicalTransceivers],
  );

  const syncTrackToAllPeers = useCallback(
    (kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
      for (const entry of peersRef.current.values()) {
        syncTrackToPeer(entry, kind, track);
      }
    },
    [syncTrackToPeer],
  );

  const acquireVideo = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Twoja przeglądarka nie obsługuje dostępu do kamery.');
        return false;
      }
      setIsRequestingMedia(true);
      setMediaError(null);
      try {
        const videoConstraints: MediaTrackConstraints = {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        };
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        const newTrack = stream.getVideoTracks()[0] ?? null;
        if (!newTrack) {
          setMediaError('Nie wykryto obrazu z wybranej kamery.');
          return false;
        }

        if (videoTrackRef.current) {
          videoTrackRef.current.stop();
        }
        newTrack.enabled = true;
        videoTrackRef.current = newTrack;
        cameraOnRef.current = true;
        setCameraOn(true);
        rebuildLocalStreamState();
        syncTrackToAllPeers('video', newTrack);
        await refreshDevices();
        return true;
      } catch (err) {
        if (deviceId) {
          return acquireVideo(undefined);
        }
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Brak zgody na kamerę. Kliknij ikonę kłódki/kamery w pasku adresu przeglądarki i zezwól na dostęp.'
            : 'Nie udało się uruchomić kamery. Sprawdź, czy nie blokuje jej inna aplikacja (np. Discord/OBS).';
        setMediaError(msg);
        return false;
      } finally {
        setIsRequestingMedia(false);
      }
    },
    [rebuildLocalStreamState, refreshDevices, syncTrackToAllPeers],
  );

  const acquireAudio = useCallback(
    async (deviceId?: string): Promise<boolean> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMediaError('Twoja przeglądarka nie obsługuje dostępu do mikrofonu.');
        return false;
      }
      setIsRequestingMedia(true);
      setMediaError(null);
      getOrInitPlaybackContext();
      try {
        const audioConstraints: MediaTrackConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        };
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
        const newTrack = stream.getAudioTracks()[0] ?? null;
        if (!newTrack) {
          setMediaError('Nie wykryto sygnału z wybranego mikrofonu.');
          return false;
        }

        if (audioTrackRef.current) {
          audioTrackRef.current.stop();
        }
        newTrack.enabled = true;
        audioTrackRef.current = newTrack;
        micOnRef.current = true;
        setMicOn(true);
        rebuildLocalStreamState();
        syncTrackToAllPeers('audio', newTrack);
        await refreshDevices();
        return true;
      } catch (err) {
        if (deviceId) {
          return acquireAudio(undefined);
        }
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Brak zgody na mikrofon. Kliknij ikonę kłódki w pasku adresu przeglądarki i zezwól na mikrofon.'
            : 'Nie udało się uruchomić mikrofonu. Sprawdź wybrane urządzenie w opcjach.';
        setMediaError(msg);
        return false;
      } finally {
        setIsRequestingMedia(false);
      }
    },
    [getOrInitPlaybackContext, rebuildLocalStreamState, refreshDevices, syncTrackToAllPeers],
  );

  /**
   * Acquires BOTH camera and microphone in a single permission request
   * (with automatic graceful fallback to video-only or audio-only if one device is missing).
   */
  const enableBothMedia = useCallback(async (): Promise<{
    cameraOn: boolean;
    micOn: boolean;
  }> => {
    userTouchedMediaRef.current = true;
    getOrInitPlaybackContext();

    const hasLiveVideo =
      videoTrackRef.current && videoTrackRef.current.readyState === 'live';
    const hasLiveAudio =
      audioTrackRef.current && audioTrackRef.current.readyState === 'live';

    if (hasLiveVideo && hasLiveAudio) {
      videoTrackRef.current!.enabled = true;
      audioTrackRef.current!.enabled = true;
      cameraOnRef.current = true;
      micOnRef.current = true;
      setCameraOn(true);
      setMicOn(true);
      return { cameraOn: true, micOn: true };
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      return { cameraOn: cameraOnRef.current, micOn: micOnRef.current };
    }

    setIsRequestingMedia(true);
    setMediaError(null);
    try {
      const combined = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 24 },
          ...(selectedVideoId ? { deviceId: { ideal: selectedVideoId } } : {}),
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(selectedAudioId ? { deviceId: { ideal: selectedAudioId } } : {}),
        },
      });

      const vTrack = combined.getVideoTracks()[0] ?? null;
      const aTrack = combined.getAudioTracks()[0] ?? null;

      if (vTrack) {
        videoTrackRef.current?.stop();
        vTrack.enabled = true;
        videoTrackRef.current = vTrack;
        cameraOnRef.current = true;
        setCameraOn(true);
        syncTrackToAllPeers('video', vTrack);
      }
      if (aTrack) {
        audioTrackRef.current?.stop();
        aTrack.enabled = true;
        audioTrackRef.current = aTrack;
        micOnRef.current = true;
        setMicOn(true);
        syncTrackToAllPeers('audio', aTrack);
      }

      rebuildLocalStreamState();
      await refreshDevices();
      return {
        cameraOn: Boolean(vTrack),
        micOn: Boolean(aTrack),
      };
    } catch {
      // Fallback: try acquiring video and audio independently so a missing webcam doesn't block the mic (or vice versa)
      const [vOk, aOk] = await Promise.all([
        hasLiveVideo ? Promise.resolve(true) : acquireVideo(selectedVideoId || undefined),
        hasLiveAudio ? Promise.resolve(true) : acquireAudio(selectedAudioId || undefined),
      ]);
      return { cameraOn: vOk, micOn: aOk };
    } finally {
      setIsRequestingMedia(false);
    }
  }, [
    acquireAudio,
    acquireVideo,
    getOrInitPlaybackContext,
    rebuildLocalStreamState,
    refreshDevices,
    selectedAudioId,
    selectedVideoId,
    syncTrackToAllPeers,
  ]);

  /**
   * Automatically starts camera & mic when creating or joining a room
   * if the user hasn't manually configured them yet.
   */
  const ensureMediaForRoom = useCallback(async (): Promise<{
    cameraOn: boolean;
    micOn: boolean;
  }> => {
    getOrInitPlaybackContext();
    if (userTouchedMediaRef.current) {
      return { cameraOn: cameraOnRef.current, micOn: micOnRef.current };
    }
    return enableBothMedia();
  }, [enableBothMedia, getOrInitPlaybackContext]);

  const toggleCamera = useCallback(async () => {
    userTouchedMediaRef.current = true;
    const existing = videoTrackRef.current;
    if (existing && existing.readyState === 'live') {
      const next = !cameraOnRef.current;
      existing.enabled = next;
      cameraOnRef.current = next;
      setCameraOn(next);
      return next;
    }
    const camOk = await acquireVideo(selectedVideoId || undefined);
    // If user hasn't turned on mic yet, also try turning on mic so voice works right away
    if (!audioTrackRef.current || audioTrackRef.current.readyState !== 'live') {
      acquireAudio(selectedAudioId || undefined).catch(() => {});
    }
    return camOk;
  }, [acquireAudio, acquireVideo, selectedAudioId, selectedVideoId]);

  const toggleMic = useCallback(async () => {
    userTouchedMediaRef.current = true;
    getOrInitPlaybackContext();
    const existing = audioTrackRef.current;
    if (existing && existing.readyState === 'live') {
      const next = !micOnRef.current;
      existing.enabled = next;
      micOnRef.current = next;
      setMicOn(next);
      return next;
    }
    return acquireAudio(selectedAudioId || undefined);
  }, [acquireAudio, getOrInitPlaybackContext, selectedAudioId]);

  const switchCameraDevice = useCallback(
    async (deviceId: string) => {
      userTouchedMediaRef.current = true;
      setSelectedVideoId(deviceId);
      await acquireVideo(deviceId);
    },
    [acquireVideo],
  );

  const switchMicrophoneDevice = useCallback(
    async (deviceId: string) => {
      userTouchedMediaRef.current = true;
      setSelectedAudioId(deviceId);
      await acquireAudio(deviceId);
    },
    [acquireAudio],
  );

  const switchAudioOutputDevice = useCallback(
    (deviceId: string) => {
      setSelectedAudioOutputId(deviceId);
      const ctx = getOrInitPlaybackContext();
      if (ctx && 'setSinkId' in ctx) {
        (ctx as AudioContext & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(deviceId)
          .catch(() => {});
      }
    },
    [getOrInitPlaybackContext],
  );

  const destroyPeer = useCallback((peerId: string) => {
    const entry = peersRef.current.get(peerId);
    if (!entry) return;
    if (entry.iceRestartTimer) {
      window.clearTimeout(entry.iceRestartTimer);
    }
    entry.pc.onnegotiationneeded = null;
    entry.pc.onicecandidate = null;
    entry.pc.ontrack = null;
    entry.pc.onconnectionstatechange = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.close();
    peersRef.current.delete(peerId);

    setRemoteStreams((prev) => {
      if (!(peerId in prev)) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
    setPeerStates((prev) => {
      if (!(peerId in prev)) return prev;
      const copy = { ...prev };
      delete copy[peerId];
      return copy;
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, explicitSelfId?: string): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const selfId = explicitSelfId || myPlayerIdRef.current || '';
      const polite = selfId < peerId;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const remoteStream = new MediaStream();

      const entry: PeerEntry = {
        peerId,
        pc,
        remoteStream,
        polite,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingIce: [],
        iceRestartTimer: null,
      };
      peersRef.current.set(peerId, entry);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          sendRef.current({
            type: 'rtc:ice',
            toPlayerId: peerId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (ev) => {
        const track = ev.track;
        const alreadyHas = entry.remoteStream.getTracks().some((t) => t.id === track.id);
        if (!alreadyHas) {
          for (const old of entry.remoteStream.getTracks()) {
            if (old.kind === track.kind && old.readyState === 'ended') {
              entry.remoteStream.removeTrack(old);
            }
          }
          entry.remoteStream.addTrack(track);
        }

        const refresh = () => publishRemoteStream(peerId, entry.remoteStream);
        refresh();

        track.onunmute = refresh;
        track.onmute = refresh;
        track.onended = () => {
          entry.remoteStream.removeTrack(track);
          refresh();
        };
      };

      pc.onnegotiationneeded = async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendRef.current({
              type: 'rtc:offer',
              toPlayerId: peerId,
              sdp: pc.localDescription,
            });
          }
        } catch {
          // Ignore transient negotiation race
        } finally {
          entry.makingOffer = false;
        }
      };

      pc.onconnectionstatechange = () => {
        setPeerStates((prev) => ({ ...prev, [peerId]: pc.connectionState }));
      };

      pc.oniceconnectionstatechange = () => {
        if (entry.iceRestartTimer) {
          window.clearTimeout(entry.iceRestartTimer);
          entry.iceRestartTimer = null;
        }
        if (pc.iceConnectionState === 'failed' && !entry.polite) {
          pc.restartIce();
        } else if (pc.iceConnectionState === 'disconnected') {
          entry.iceRestartTimer = window.setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' && !entry.polite) {
              pc.restartIce();
            }
          }, 2500);
        }
      };

      // Impolite peer immediately creates canonical [0: audio, 1: video] sendrecv transceivers
      if (!polite) {
        ensureCanonicalTransceivers(pc);
      }

      return entry;
    },
    [ensureCanonicalTransceivers, publishRemoteStream],
  );

  // Sync peer connections and cleanup remote frames when players join/leave
  useEffect(() => {
    if (!myPlayerId) {
      for (const peerId of Array.from(peersRef.current.keys())) {
        destroyPeer(peerId);
      }
      setRemoteFrames({});
      setRemoteSpeaking({});
      return;
    }

    const otherIds = peerIds.filter((id) => id !== myPlayerId);
    const otherSet = new Set(otherIds);

    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!otherSet.has(peerId)) {
        destroyPeer(peerId);
      }
    }

    setRemoteFrames((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (otherSet.has(k)) {
          next[k] = v;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    for (const peerId of otherIds) {
      if (!peersRef.current.has(peerId)) {
        createPeerConnection(peerId, myPlayerId);
      }
    }
  }, [myPlayerId, peerIds, createPeerConnection, destroyPeer]);

  const reconnectAllPeers = useCallback(() => {
    const selfId = myPlayerIdRef.current;
    if (!selfId) return;
    const currentPeerIds = Array.from(peersRef.current.keys());
    for (const peerId of currentPeerIds) {
      destroyPeer(peerId);
      sendRef.current({ type: 'rtc:reset', toPlayerId: peerId });
    }
    window.setTimeout(() => {
      for (const peerId of currentPeerIds) {
        createPeerConnection(peerId, selfId);
      }
    }, 150);
  }, [createPeerConnection, destroyPeer]);

  // Handle incoming WebRTC signaling AND WebSocket live media relay packets
  const handleRtcSignal = useCallback(
    async (
      msg: Extract<
        ServerMessage,
        {
          type:
            | 'rtc:offer'
            | 'rtc:answer'
            | 'rtc:ice'
            | 'rtc:reset'
            | 'media:video'
            | 'media:audio';
        }
      >,
    ) => {
      const peerId = msg.fromPlayerId;

      if (msg.type === 'media:video') {
        setRemoteFrames((prev) => ({
          ...prev,
          [peerId]: msg.frame,
        }));
        return;
      }

      if (msg.type === 'media:audio') {
        playRemoteAudioChunk(peerId, msg.pcm, msg.sampleRate);
        return;
      }

      if (msg.type === 'rtc:reset') {
        destroyPeer(peerId);
        createPeerConnection(peerId);
        return;
      }

      const entry = createPeerConnection(peerId);
      const { pc } = entry;

      if (msg.type === 'rtc:offer' || msg.type === 'rtc:answer') {
        const description = msg.sdp;
        const readyForOffer =
          !entry.makingOffer &&
          (pc.signalingState === 'stable' || entry.isSettingRemoteAnswerPending);
        const offerCollision = description.type === 'offer' && !readyForOffer;

        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) {
          return;
        }

        try {
          entry.isSettingRemoteAnswerPending = description.type === 'answer';
          await pc.setRemoteDescription(description);
          entry.isSettingRemoteAnswerPending = false;

          for (const ice of entry.pendingIce.splice(0)) {
            await pc.addIceCandidate(ice).catch(() => {});
          }

          if (description.type === 'offer') {
            const aTrack =
              audioTrackRef.current && audioTrackRef.current.readyState === 'live'
                ? audioTrackRef.current
                : null;
            const vTrack =
              videoTrackRef.current && videoTrackRef.current.readyState === 'live'
                ? videoTrackRef.current
                : null;

            await syncTrackToPeer(entry, 'audio', aTrack);
            await syncTrackToPeer(entry, 'video', vTrack);

            await pc.setLocalDescription();
            if (pc.localDescription) {
              sendRef.current({
                type: 'rtc:answer',
                toPlayerId: peerId,
                sdp: pc.localDescription,
              });
            }
          }
        } catch {
          entry.isSettingRemoteAnswerPending = false;
        }
        return;
      }

      if (msg.type === 'rtc:ice') {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(msg.candidate);
          } else {
            entry.pendingIce.push(msg.candidate);
          }
        } catch {
          // Ignore stale candidate
        }
      }
    },
    [createPeerConnection, destroyPeer, playRemoteAudioChunk, syncTrackToPeer],
  );

  // Sync camera/mic state to room server when in a room
  useEffect(() => {
    if (myPlayerId) {
      sendRef.current({ type: 'player:media', cameraOn, micOn });
    }
  }, [myPlayerId, cameraOn, micOn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      videoTrackRef.current?.stop();
      audioTrackRef.current?.stop();
      for (const t of Object.values(remoteSpeakingTimersRef.current)) {
        window.clearTimeout(t);
      }
      for (const peerId of Array.from(peersRef.current.keys())) {
        const entry = peersRef.current.get(peerId);
        if (entry) {
          if (entry.iceRestartTimer) window.clearTimeout(entry.iceRestartTimer);
          entry.pc.close();
        }
      }
      peersRef.current.clear();
      if (playbackCtxRef.current) {
        playbackCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return {
    localStream,
    remoteStreams,
    remoteFrames,
    remoteSpeaking,
    peerStates,
    cameraOn,
    micOn,
    micLoopback,
    setMicLoopback,
    mediaError,
    isRequestingMedia,
    localSpeaking,
    localAudioLevel,
    videoDevices,
    audioDevices,
    audioOutputDevices,
    selectedVideoId,
    selectedAudioId,
    selectedAudioOutputId,
    refreshDevices,
    enableBothMedia,
    ensureMediaForRoom,
    toggleCamera,
    toggleMic,
    switchCameraDevice,
    switchMicrophoneDevice,
    switchAudioOutputDevice,
    reconnectAllPeers,
    handleRtcSignal,
  };
}
