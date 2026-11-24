import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMessage, RoomStateView, ServerMessage } from '../shared/types.ts';
import { soundEngine } from '../utils/sound.ts';

export type RtcSignalHandler = (
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
) => void;

export function useGameSocket(onRtcSignal?: RtcSignalHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const pendingQueueRef = useRef<ClientMessage[]>([]);
  const rtcHandlerRef = useRef<RtcSignalHandler | undefined>(onRtcSignal);
  const prevRoomRef = useRef<RoomStateView | null>(null);

  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rtcHandlerRef.current = onRtcSignal;
  }, [onRtcSignal]);

  const connect = useCallback(() => {
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      const queued = pendingQueueRef.current.splice(0, pendingQueueRef.current.length);
      for (const item of queued) {
        ws.send(JSON.stringify(item));
      }
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (
        msg.type === 'rtc:offer' ||
        msg.type === 'rtc:answer' ||
        msg.type === 'rtc:ice' ||
        msg.type === 'rtc:reset' ||
        msg.type === 'media:video' ||
        msg.type === 'media:audio'
      ) {
        rtcHandlerRef.current?.(msg);
        return;
      }

      if (msg.type === 'room:error') {
        setError(msg.message);
        return;
      }

      if (msg.type === 'session:joined') {
        setError(null);
        setPlayerId(msg.playerId);
        prevRoomRef.current = msg.room;
        setRoom(msg.room);
        return;
      }

      if (msg.type === 'room:state') {
        const prev = prevRoomRef.current;
        const next = msg.room;

        // Play subtle contextual audio cues on meaningful state changes
        if (prev) {
          if (prev.phase !== 'PLAYING' && next.phase === 'PLAYING') {
            soundEngine.playCardDeal();
          } else if (
            prev.phase === 'PLAYING' &&
            next.phase === 'PLAYING' &&
            prev.activeTurnPlayerId !== next.activeTurnPlayerId
          ) {
            soundEngine.playTurnSwitch();
          }

          const prevSolved = prev.players.filter((p) => p.solved).length;
          const nextSolved = next.players.filter((p) => p.solved).length;
          if (nextSolved > prevSolved) {
            soundEngine.playSolved();
          }

          for (const p of next.players) {
            const oldP = prev.players.find((x) => x.id === p.id);
            if (p.lastReaction && (!oldP?.lastReaction || oldP.lastReaction.at !== p.lastReaction.at)) {
              soundEngine.playReaction(p.lastReaction.type);
              break;
            }
          }
        }

        prevRoomRef.current = next;
        setRoom(next);
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  const send = useCallback(
    (msg: ClientMessage) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else {
        // Don't buffer volatile media chunks when offline
        if (msg.type !== 'media:video' && msg.type !== 'media:audio') {
          pendingQueueRef.current.push(msg);
        }
        connect();
      }
    },
    [connect],
  );

  const getBufferedAmount = useCallback(() => {
    return wsRef.current?.bufferedAmount ?? 0;
  }, []);

  const leaveRoom = useCallback(() => {
    send({ type: 'room:leave' });
    setRoom(null);
    setPlayerId(null);
    prevRoomRef.current = null;
    setError(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has('room')) {
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  }, [send]);

  const clearError = useCallback(() => setError(null), []);

  return {
    connected,
    playerId,
    room,
    error,
    clearError,
    send,
    getBufferedAmount,
    leaveRoom,
  };
}
