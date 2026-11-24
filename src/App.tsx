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

  const {
    connected,
    playerId,
    room,
    error,
    clearError,
    send,
    getBufferedAmount,
    leaveRoom,
  } = useGameSocket(forwardRtcSignal);

  const peerIds = useMemo(() => (room ? room.players.map((p) => p.id) : []), [room]);

  const {
    localStream,
    remoteStreams,
    remoteFrames,
    remoteSpeaking,
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
  } = useWebRTC({
    myPlayerId: playerId,
    peerIds,
    send,
    getBufferedAmount,
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
    async (name: string, borderColor: string) => {
      const state = await ensureMediaForRoom();
      send({
        type: 'room:create',
        name,
        cameraOn: state.cameraOn,
        micOn: state.micOn,
        borderColor,
      });
    },
    [ensureMediaForRoom, send],
  );

  const handleJoinRoom = useCallback(
    async (code: string, name: string, borderColor: string) => {
      const state = await ensureMediaForRoom();
      send({
        type: 'room:join',
        code,
        name,
        cameraOn: state.cameraOn,
        micOn: state.micOn,
        borderColor,
      });
    },
    [ensureMediaForRoom, send],
  );

  return (
    <>
      {room && playerId ? (
        <GameRoom
          room={room}
          myPlayerId={playerId}
          localStream={localStream}
          remoteStreams={remoteStreams}
          remoteFrames={remoteFrames}
          remoteSpeaking={remoteSpeaking}
          cameraOn={cameraOn}
          micOn={micOn}
          localSpeaking={localSpeaking}
          mediaError={mediaError}
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
          onEnableBothMedia={enableBothMedia}
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
        micLoopback={micLoopback}
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
        onToggleMicLoopback={setMicLoopback}
        onSwitchCamera={switchCameraDevice}
        onSwitchMicrophone={switchMicrophoneDevice}
        onSwitchAudioOutput={switchAudioOutputDevice}
        onRefreshDevices={refreshDevices}
        onReconnectPeers={reconnectAllPeers}
      />
    </>
  );
}
