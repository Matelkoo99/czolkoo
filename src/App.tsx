/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameRoom } from './components/GameRoom.tsx';
import { LandingScreen } from './components/LandingScreen.tsx';
import { MediaSettingsModal } from './components/MediaSettingsModal.tsx';
import { useGameSocket, type RtcSignalHandler } from './hooks/useGameSocket.ts';
import { useWebRTC } from './hooks/useWebRTC.ts';

function getInitialRoomCodeFromUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return (params.get('room') || '').toUpperCase().slice(0, 6);
}

export default function App() {
  const initialRoomCode = useMemo(() => getInitialRoomCodeFromUrl(), []);
  const rtcForwardRef = useRef<RtcSignalHandler | null>(null);
  const [mediaSettingsOpen, setMediaSettingsOpen] = useState(false);

  const forwardRtcSignal = useCallback<RtcSignalHandler>((msg) => {
    rtcForwardRef.current?.(msg);
  }, []);

  const { connected, playerId, room, error, clearError, send, leaveRoom } =
    useGameSocket(forwardRtcSignal);

  const peerIds = useMemo(() => (room ? room.players.map((p) => p.id) : []), [room]);

  const {
    localStream,
    remoteStreams,
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
  } = useWebRTC({
    myPlayerId: playerId,
    peerIds,
    send,
  });

  useEffect(() => {
    rtcForwardRef.current = handleRtcSignal;
  }, [handleRtcSignal]);

  // Keep room code reflected in URL for easy sharing
  useEffect(() => {
    if (!room?.code) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('room') !== room.code) {
      url.searchParams.set('room', room.code);
      window.history.replaceState({}, '', url.toString());
    }
  }, [room?.code]);

  const handleCreateRoom = useCallback(
    (name: string) => {
      send({ type: 'room:create', name, cameraOn, micOn });
    },
    [send, cameraOn, micOn],
  );

  const handleJoinRoom = useCallback(
    (code: string, name: string) => {
      send({ type: 'room:join', code, name, cameraOn, micOn });
    },
    [send, cameraOn, micOn],
  );

  return (
    <>
      {room && playerId ? (
        <GameRoom
          room={room}
          myPlayerId={playerId}
          localStream={localStream}
          remoteStreams={remoteStreams}
          cameraOn={cameraOn}
          micOn={micOn}
          localSpeaking={localSpeaking}
          mediaError={mediaError}
          audioOutputId={selectedAudioOutputId}
          roomError={error}
          onClearRoomError={clearError}
          onToggleCamera={toggleCamera}
          onToggleMic={toggleMic}
          onOpenMediaSettings={() => setMediaSettingsOpen(true)}
          onSend={send}
          onLeave={leaveRoom}
        />
      ) : (
        <LandingScreen
          initialRoomCode={initialRoomCode}
          connected={connected}
          error={error}
          localStream={localStream}
          cameraOn={cameraOn}
          micOn={micOn}
          localAudioLevel={localAudioLevel}
          mediaError={mediaError}
          isRequestingMedia={isRequestingMedia}
          onToggleCamera={toggleCamera}
          onToggleMic={toggleMic}
          onOpenMediaSettings={() => setMediaSettingsOpen(true)}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onClearError={clearError}
        />
      )}

      <MediaSettingsModal
        open={mediaSettingsOpen}
        inRoom={Boolean(room && playerId)}
        localStream={localStream}
        cameraOn={cameraOn}
        micOn={micOn}
        localAudioLevel={localAudioLevel}
        mediaError={mediaError}
        isRequestingMedia={isRequestingMedia}
        videoDevices={videoDevices}
        audioDevices={audioDevices}
        audioOutputDevices={audioOutputDevices}
        selectedVideoId={selectedVideoId}
        selectedAudioId={selectedAudioId}
        selectedAudioOutputId={selectedAudioOutputId}
        onClose={() => setMediaSettingsOpen(false)}
        onToggleCamera={toggleCamera}
        onToggleMic={toggleMic}
        onSwitchCamera={switchCameraDevice}
        onSwitchMicrophone={switchMicrophoneDevice}
        onSwitchAudioOutput={switchAudioOutputDevice}
        onRefreshDevices={refreshDevices}
        onReconnectPeers={reconnectAllPeers}
      />
    </>
  );
}
