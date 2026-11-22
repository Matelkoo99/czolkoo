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
}) {
  const { myPlayerId, peerIds, send } = params;

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
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
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const sendRef = useRef(send);
  const myPlayerIdRef = useRef(myPlayerId);

  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  useEffect(() => {
    myPlayerIdRef.current = myPlayerId;
  }, [myPlayerId]);

  const rebuildLocalStreamState = useCallback(() => {
    const tracks: MediaStreamTrack[] = [];
    if (videoTrackRef.current && videoTrackRef.current.readyState === 'live') {
      tracks.push(videoTrackRef.current);
    }
    if (audioTrackRef.current && audioTrackRef.current.readyState === 'live') {
      tracks.push(audioTrackRef.current);
    }
    setLocalStream(tracks.length > 0 ? new MediaStream(tracks) : null);
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

  // Listen for hot-plugged webcams / microphones
  useEffect(() => {
    refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const handler = () => {
      refreshDevices();
    };
    md.addEventListener('devicechange', handler);
    return () => md.removeEventListener('devicechange', handler);
  }, [refreshDevices]);

  // Live microphone audio level & speaking detector
  useEffect(() => {
    const audioTrack = audioTrackRef.current;
    if (!audioTrack || audioTrack.readyState !== 'live' || !micOn) {
      setLocalSpeaking(false);
      setLocalAudioLevel(0);
      return;
    }

    let rafId = 0;
    let audioCtx: AudioContext | null = null;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const normalized = Math.min(100, Math.round((avg / 75) * 100));
        setLocalAudioLevel(normalized);
        setLocalSpeaking(avg > 18);
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    } catch {
      // Web Audio unavailable
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [localStream, micOn]);

  const publishRemoteStream = useCallback((peerId: string, stream: MediaStream) => {
    // Always pass a fresh MediaStream instance so React effects & video/audio bindings update reliably
    const liveTracks = stream.getTracks().filter((t) => t.readyState !== 'ended');
    setRemoteStreams((prev) => ({
      ...prev,
      [peerId]: new MediaStream(liveTracks),
    }));
  }, []);

  /**
   * Synchronizes a single track kind ('audio' or 'video') across all active RTCPeerConnections
   * using existing transceivers (zero-downtime replaceTrack whenever possible).
   */
  const syncTrackToPeer = useCallback(
    async (entry: PeerEntry, kind: 'audio' | 'video', track: MediaStreamTrack | null) => {
      const { pc } = entry;
      if (pc.signalingState === 'closed') return;

      const transceivers = pc.getTransceivers();
      const matching = transceivers.find(
        (t) =>
          t.receiver.track?.kind === kind ||
          t.sender.track?.kind === kind,
      );

      if (matching) {
        try {
          await matching.sender.replaceTrack(track);
          if (track && matching.direction !== 'sendrecv') {
            matching.direction = 'sendrecv';
          }
        } catch {
          // Fallback if transceiver was stopped
          if (track) {
            pc.addTransceiver(track, { direction: 'sendrecv' });
          }
        }
      } else if (track) {
        pc.addTransceiver(track, { direction: 'sendrecv' });
      }
    },
    [],
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

        // Stop old video track after acquiring new one
        if (videoTrackRef.current) {
          videoTrackRef.current.stop();
        }
        newTrack.enabled = true;
        videoTrackRef.current = newTrack;
        setCameraOn(true);
        rebuildLocalStreamState();
        syncTrackToAllPeers('video', newTrack);
        await refreshDevices();
        return true;
      } catch (err) {
        // Retry without exact deviceId if selected device was unplugged
        if (deviceId) {
          return acquireVideo(undefined);
        }
        const msg =
          err instanceof DOMException && err.name === 'NotAllowedError'
            ? 'Brak zgody na kamerę. Zezwól przeglądarce na dostęp do kamery w pasku adresu.'
            : 'Nie udało się uruchomić kamery. Sprawdź, czy nie używa jej inna aplikacja (np. Discord/OBS).';
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
            ? 'Brak zgody na mikrofon. Zezwól przeglądarce na dostęp do mikrofonu w pasku adresu.'
            : 'Nie udało się uruchomić mikrofonu. Sprawdź ustawienia urządzenia w opcjach.';
        setMediaError(msg);
        return false;
      } finally {
        setIsRequestingMedia(false);
      }
    },
    [rebuildLocalStreamState, refreshDevices, syncTrackToAllPeers],
  );

  const toggleCamera = useCallback(async () => {
    const existing = videoTrackRef.current;
    if (existing && existing.readyState === 'live') {
      const next = !cameraOn;
      existing.enabled = next;
      setCameraOn(next);
      return next;
    }
    return acquireVideo(selectedVideoId || undefined);
  }, [cameraOn, acquireVideo, selectedVideoId]);

  const toggleMic = useCallback(async () => {
    const existing = audioTrackRef.current;
    if (existing && existing.readyState === 'live') {
      const next = !micOn;
      existing.enabled = next;
      setMicOn(next);
      return next;
    }
    return acquireAudio(selectedAudioId || undefined);
  }, [micOn, acquireAudio, selectedAudioId]);

  const switchCameraDevice = useCallback(
    async (deviceId: string) => {
      setSelectedVideoId(deviceId);
      if (cameraOn || (videoTrackRef.current && videoTrackRef.current.readyState === 'live')) {
        await acquireVideo(deviceId);
      }
    },
    [cameraOn, acquireVideo],
  );

  const switchMicrophoneDevice = useCallback(
    async (deviceId: string) => {
      setSelectedAudioId(deviceId);
      if (micOn || (audioTrackRef.current && audioTrackRef.current.readyState === 'live')) {
        await acquireAudio(deviceId);
      }
    },
    [micOn, acquireAudio],
  );

  const switchAudioOutputDevice = useCallback((deviceId: string) => {
    setSelectedAudioOutputId(deviceId);
  }, []);

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

  /**
   * Creates a W3C Perfect Negotiation RTCPeerConnection for a peer.
   * - Impolite peer (`myId > peerId`) proactively creates both `audio` & `video`
   *   `sendrecv` transceivers so both audio & video work bi-directionally from turn 1.
   * - Polite peer (`myId < peerId`) accepts offers cleanly with automatic collision rollback
   *   and populates its own local tracks into the matched `sendrecv` transceivers before answering!
   */
  const createPeerConnection = useCallback(
    (peerId: string): PeerEntry => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing;

      const selfId = myPlayerIdRef.current || '';
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
          // Remove any stale ended track of the same kind
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
        if (pc.iceConnectionState === 'failed') {
          if (!entry.polite) {
            pc.restartIce();
          }
        } else if (pc.iceConnectionState === 'disconnected') {
          entry.iceRestartTimer = window.setTimeout(() => {
            if (pc.iceConnectionState === 'disconnected' && !entry.polite) {
              pc.restartIce();
            }
          }, 3000);
        }
      };

      // Impolite peer initiates both sendrecv m-lines immediately (audio + video)
      if (!polite) {
        const aTrack =
          audioTrackRef.current && audioTrackRef.current.readyState === 'live'
            ? audioTrackRef.current
            : null;
        const vTrack =
          videoTrackRef.current && videoTrackRef.current.readyState === 'live'
            ? videoTrackRef.current
            : null;

        pc.addTransceiver(aTrack ?? 'audio', { direction: 'sendrecv' });
        pc.addTransceiver(vTrack ?? 'video', { direction: 'sendrecv' });
      }

      return entry;
    },
    [publishRemoteStream],
  );

  // Sync peer connections with room membership
  useEffect(() => {
    if (!myPlayerId) {
      for (const peerId of Array.from(peersRef.current.keys())) {
        destroyPeer(peerId);
      }
      return;
    }

    const otherIds = peerIds.filter((id) => id !== myPlayerId);
    const otherSet = new Set(otherIds);

    for (const peerId of Array.from(peersRef.current.keys())) {
      if (!otherSet.has(peerId)) {
        destroyPeer(peerId);
      }
    }

    for (const peerId of otherIds) {
      if (!peersRef.current.has(peerId)) {
        createPeerConnection(peerId);
      }
    }
  }, [myPlayerId, peerIds, createPeerConnection, destroyPeer]);

  // Manual full WebRTC reconnect helper (accessible from Media Settings)
  const reconnectAllPeers = useCallback(() => {
    if (!myPlayerIdRef.current) return;
    const currentPeerIds = Array.from(peersRef.current.keys());
    for (const peerId of currentPeerIds) {
      destroyPeer(peerId);
      sendRef.current({ type: 'rtc:reset', toPlayerId: peerId });
    }
    window.setTimeout(() => {
      for (const peerId of currentPeerIds) {
        createPeerConnection(peerId);
      }
    }, 150);
  }, [createPeerConnection, destroyPeer]);

  // Handle incoming WebRTC signaling (W3C Perfect Negotiation)
  const handleRtcSignal = useCallback(
    async (
      msg: Extract<ServerMessage, { type: 'rtc:offer' | 'rtc:answer' | 'rtc:ice' | 'rtc:reset' }>,
    ) => {
      const peerId = msg.fromPlayerId;

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

          // Flush queued ICE candidates now that remote description is applied
          for (const ice of entry.pendingIce.splice(0)) {
            await pc.addIceCandidate(ice).catch(() => {});
          }

          if (description.type === 'offer') {
            // Attach our local audio & video tracks into the negotiated sendrecv transceivers BEFORE answering!
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
          if (!entry.ignoreOffer) {
            // Ignore stale candidate
          }
        }
      }
    },
    [createPeerConnection, destroyPeer, syncTrackToPeer],
  );

  // Sync camera/mic state to room server when in a room
  useEffect(() => {
    if (myPlayerId) {
      sendRef.current({ type: 'player:media', cameraOn, micOn });
    }
  }, [myPlayerId, cameraOn, micOn]);

  // Cleanup all tracks and peers on unmount
  useEffect(() => {
    return () => {
      videoTrackRef.current?.stop();
      audioTrackRef.current?.stop();
      for (const peerId of Array.from(peersRef.current.keys())) {
        const entry = peersRef.current.get(peerId);
        if (entry) {
          if (entry.iceRestartTimer) window.clearTimeout(entry.iceRestartTimer);
          entry.pc.close();
        }
      }
      peersRef.current.clear();
    };
  }, []);

  return {
    localStream,
    remoteStreams,
    peerStates,
    cameraOn,
    micOn,
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
    toggleCamera,
    toggleMic,
    switchCameraDevice,
    switchMicrophoneDevice,
    switchAudioOutputDevice,
    reconnectAllPeers,
    handleRtcSignal,
  };
}
