import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Crown,
  Dices,
  Eye,
  Lightbulb,
  Lock,
  MessageSquareOff,
  Mic,
  MicOff,
  Pencil,
  UserCheck,
  UserMinus,
  VideoOff,
} from 'lucide-react';
import type { GamePhase, ReactionType, RoomPlayerView } from '../shared/types.ts';

interface PlayerCameraTileProps {
  player: RoomPlayerView;
  isSelf: boolean;
  isHost: boolean;
  viewerIsHost: boolean;
  isActiveTurn: boolean;
  turnAnimations?: boolean;
  isSpotlight?: boolean;
  phase: GamePhase;
  stream: MediaStream | null;
  remoteFrame?: string | null;
  isSpeaking?: boolean;
  compact?: boolean;
  onToggleSelfCamera?: () => void;
  onToggleSelfMic?: () => void;
  onEditWord?: (player: RoomPlayerView) => void;
  onRerollWord?: (playerId: string) => void;
  onMarkSolved?: (playerId: string) => void;
  onRevealHint?: (playerId: string) => void;
  onSelectTurn?: (playerId: string) => void;
  onToggleParticipating?: (playerId: string) => void;
  onToggleReactionsBlocked?: (playerId: string) => void;
}

const REACTION_STYLES: Record<ReactionType, { label: string; bg: string; text: string }> = {
  TAK: { label: 'TAK!', bg: 'bg-emerald-500', text: 'text-emerald-950' },
  NIE: { label: 'NIE!', bg: 'bg-rose-500', text: 'text-white' },
  BLISKO: { label: 'BLISKO!', bg: 'bg-amber-400', text: 'text-amber-950' },
  NIE_WIEM: { label: 'NIE WIEM', bg: 'bg-slate-200', text: 'text-slate-900' },
};

export function PlayerCameraTile({
  player,
  isSelf,
  isHost,
  viewerIsHost,
  isActiveTurn,
  turnAnimations = true,
  isSpotlight = false,
  phase,
  stream,
  remoteFrame = null,
  isSpeaking = false,
  compact = false,
  onToggleSelfCamera,
  onToggleSelfMic,
  onEditWord,
  onRerollWord,
  onMarkSolved,
  onRevealHint,
  onSelectTurn,
  onToggleParticipating,
  onToggleReactionsBlocked,
}: PlayerCameraTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [p2pVideoReady, setP2pVideoReady] = useState(false);

  const liveVideoTracks =
    stream?.getVideoTracks().filter((t) => t.readyState === 'live' && (isSelf || !t.muted)) ?? [];
  const hasStreamVideo = Boolean(player.cameraOn && liveVideoTracks.length > 0);
  const hasRelayedFrame = Boolean(!isSelf && player.cameraOn && remoteFrame);

  // Bind video stream (local or P2P remote)
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && player.cameraOn && stream.getVideoTracks().length > 0) {
      el.srcObject = stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
      setP2pVideoReady(false);
    }
  }, [stream, player.cameraOn]);

  // Auto-expire reaction overlay after 4.5s
  useEffect(() => {
    if (!player.lastReaction) return;
    setNow(Date.now());
    const remaining = 4500 - (Date.now() - player.lastReaction.at);
    if (remaining <= 0) return;
    const t = window.setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => window.clearTimeout(t);
  }, [player.lastReaction]);

  const showReaction =
    player.lastReaction && now - player.lastReaction.at < 4500
      ? REACTION_STYLES[player.lastReaction.type]
      : null;

  const initials = player.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const canManageOtherWord =
    !isSelf && player.isPlaying && (phase === 'PLAYING' || phase === 'ASSIGNING');

  const showFlowingTurnBorder = isActiveTurn && turnAnimations;

  const borderClass = showFlowingTurnBorder
    ? 'turn-flowing-frame border-2'
    : isActiveTurn
      ? 'border-2'
      : isSpeaking
        ? 'ring-2 ring-emerald-400/80 border-emerald-400/60'
        : 'border-white/10';

  const customStyle: React.CSSProperties = {
    '--player-border-color': player.avatarColor,
    ...(isActiveTurn && !turnAnimations
      ? {
          borderColor: player.avatarColor,
          boxShadow: `0 0 18px -2px ${player.avatarColor}`,
        }
      : {}),
  } as React.CSSProperties;

  const showSelfVideo = isSelf && hasStreamVideo;
  const showRemoteVideoOrFrame = !isSelf && player.cameraOn && (p2pVideoReady || hasRelayedFrame);

  return (
    <div
      style={customStyle}
      className={`group relative overflow-hidden rounded-xl border bg-[#161A22] transition-all duration-200 ${borderClass} ${
        !player.isPlaying ? 'opacity-65' : ''
      } ${
        compact
          ? 'w-full h-full min-h-[104px] sm:min-h-[175px]'
          : isSpotlight
            ? 'w-full h-full min-h-[170px] sm:min-h-[260px]'
            : 'aspect-video w-full h-full min-h-[135px] sm:min-h-[210px]'
      }`}
    >
      {/* Animated flowing border ring when it is this player's turn */}
      {showFlowingTurnBorder && <div aria-hidden="true" className="turn-flowing-ring" />}

      {/* 1. Local camera feed */}
      {showSelfVideo && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover scale-x-[-1]"
        />
      )}

      {/* 2. Remote camera feed: Hybrid WebRTC P2P <video> + guaranteed WebSocket frame <img> */}
      {!isSelf && player.cameraOn && (
        <>
          {hasRelayedFrame && (
            <img
              src={remoteFrame!}
              alt={`Kamera gracza ${player.name}`}
              referrerPolicy="no-referrer"
              className={`h-full w-full object-cover ${p2pVideoReady ? 'hidden' : 'block'}`}
            />
          )}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedData={(e) => {
              if (e.currentTarget.videoWidth > 0) setP2pVideoReady(true);
            }}
            onPlaying={(e) => {
              if (e.currentTarget.videoWidth > 0) setP2pVideoReady(true);
            }}
            onEmptied={() => setP2pVideoReady(false)}
            className={`h-full w-full object-cover ${p2pVideoReady ? 'block' : 'hidden'}`}
          />
        </>
      )}

      {/* 3. Studio Avatar Fallback when camera is off (or before first frame arrives) */}
      {!showSelfVideo && !showRemoteVideoOrFrame && (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#181C24] px-2 text-center">
          <div
            className={`flex items-center justify-center rounded-full font-display font-bold text-slate-950 shadow-lg transition-transform duration-150 ${
              compact ? 'h-11 w-11 text-base sm:h-16 sm:w-16 sm:text-xl' : 'h-16 w-16 text-xl sm:h-20 sm:w-20 sm:text-2xl'
            } ${isSpeaking ? 'scale-105 ring-4 ring-emerald-400/45' : ''}`}
            style={{ backgroundColor: player.avatarColor }}
          >
            {initials || '?'}
          </div>
          <span className="mt-1.5 flex items-center gap-1 text-[10px] sm:text-xs text-slate-400">
            <VideoOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            {player.cameraOn && !isSelf ? 'Łączenie...' : 'Kamera wył.'}
          </span>

          {/* Direct 1-click button on user's own tile if their camera or mic is off */}
          {isSelf && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              {!player.cameraOn && onToggleSelfCamera && (
                <button
                  type="button"
                  onClick={onToggleSelfCamera}
                  className="inline-flex h-7 sm:h-8 items-center gap-1 rounded-lg bg-amber-500 px-2.5 text-[11px] sm:text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Camera className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Kamera
                </button>
              )}
              {!player.micOn && onToggleSelfMic && (
                <button
                  type="button"
                  onClick={onToggleSelfMic}
                  className="inline-flex h-7 sm:h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/10 px-2.5 text-[11px] sm:text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Mic className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  Mikrofon
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Top gradient scrim for forehead card legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 sm:h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />

      {/* FOREHEAD CARD (The signature Czółko element) */}
      {player.isPlaying && (phase === 'PLAYING' || phase === 'ROUND_OVER') && (
        <div className="absolute inset-x-1.5 top-1.5 sm:inset-x-3 sm:top-3 z-20 flex justify-center">
          {player.solved ? (
            <div className="forehead-solved relative max-w-[94%] rounded-md sm:rounded-lg border border-emerald-600/30 px-2.5 py-1 sm:px-4 sm:py-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[9px] sm:text-[11px] font-semibold tracking-wide text-emerald-800">
                <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span>ZGADNIĘTE · #{player.solvedRank}</span>
              </div>
              <div className="font-display text-xs sm:text-xl font-extrabold leading-tight text-slate-950 truncate">
                {player.word}
              </div>
            </div>
          ) : isSelf && !player.revealed && phase === 'PLAYING' ? (
            <div className="forehead-masked relative max-w-[92%] rounded-md sm:rounded-lg border border-white/15 px-3 py-1 sm:px-5 sm:py-2 text-center">
              <div className="flex items-center justify-center gap-1 font-display text-xs sm:text-xl font-extrabold tracking-widest text-amber-300">
                <Lock className="h-3 w-3 sm:h-4 sm:w-4 text-amber-400" />
                <span>? ? ?</span>
              </div>
              <div className="mt-0.5 text-[9px] sm:text-[11px] font-medium text-slate-300 truncate">
                {player.wordCategory
                  ? `Podpowiedź: ${player.wordCategory}`
                  : 'Hasło widzą inni'}
              </div>
            </div>
          ) : (
            <div className="forehead-paper relative max-w-[95%] rounded-md sm:rounded-lg border border-amber-700/20 px-2.5 py-1 sm:px-4 sm:py-2 text-center">
              <div
                aria-hidden="true"
                className="mx-auto -mt-2 sm:-mt-3.5 mb-0.5 sm:mb-1 h-1.5 w-7 sm:h-2.5 sm:w-10 rounded-xs bg-white/55 backdrop-blur-xs"
              />
              <div
                className={`font-display font-extrabold leading-tight text-stone-950 ${
                  isSpotlight
                    ? 'text-base sm:text-2xl'
                    : compact
                      ? 'text-xs sm:text-xl'
                      : 'text-sm sm:text-2xl'
                }`}
              >
                {player.word || 'Brak hasła'}
              </div>
              <div className="mt-0.5 hidden sm:flex items-center justify-center gap-1.5 text-[11px] font-medium text-stone-700">
                <span>{player.wordCategory || 'Hasło'}</span>
                {player.wordAuthorName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>od: {player.wordAuthorName}</span>
                  </>
                )}
                {player.revealed && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-semibold text-rose-700">Odkryte</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ASSIGNING phase forehead status */}
      {player.isPlaying && phase === 'ASSIGNING' && (
        <div className="absolute inset-x-2 top-2 sm:inset-x-3 sm:top-3 z-20 flex justify-center">
          <div className="rounded-md sm:rounded-lg border border-white/15 bg-[#12161E]/90 px-2.5 py-1 sm:px-3.5 sm:py-2 text-center backdrop-blur-sm">
            {player.hasWord ? (
              <div className="flex items-center gap-1.5 text-[10px] sm:text-xs font-semibold text-emerald-300">
                <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="truncate">
                  {isSelf ? 'Masz już tajne hasło!' : `Gotowe: ${player.word}`}
                </span>
              </div>
            ) : (
              <div className="text-[10px] sm:text-xs font-medium text-amber-200">
                {isSelf ? 'Wymyślają Twoje hasło...' : 'Czeka na hasło'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reaction burst overlay (TAK / NIE / BLISKO) */}
      {showReaction && (
        <div className="pointer-events-none absolute right-2 sm:right-3 top-1/2 z-30 -translate-y-1/2">
          <div
            className={`rounded-lg px-2.5 py-1 sm:px-3.5 sm:py-1.5 font-display text-sm sm:text-lg font-extrabold tracking-wide shadow-xl ${showReaction.bg} ${showReaction.text}`}
          >
            {showReaction.label}
          </div>
        </div>
      )}

      {/* Hover/Tap quick actions for OTHER players' forehead cards */}
      {canManageOtherWord && !player.solved && (
        <div className="absolute bottom-9 sm:bottom-14 right-1.5 sm:right-3 z-20 flex items-center gap-1 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          {onEditWord && (
            <button
              type="button"
              onClick={() => onEditWord(player)}
              title="Wpisz własne hasło temu graczowi"
              className="flex h-7 sm:h-9 items-center gap-1 rounded-md sm:rounded-lg border border-white/15 bg-[#12161E]/90 px-2 sm:px-2.5 text-[10px] sm:text-xs font-semibold text-slate-100 hover:bg-amber-500 hover:text-slate-950 transition-colors cursor-pointer"
            >
              <Pencil className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline whitespace-nowrap">Wpisz hasło</span>
            </button>
          )}
          {phase === 'PLAYING' && onRerollWord && (
            <button
              type="button"
              onClick={() => onRerollWord(player.id)}
              title="Wylosuj nowe hasło temu graczowi"
              className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-md sm:rounded-lg border border-white/15 bg-[#12161E]/90 text-slate-100 hover:bg-white/15 transition-colors cursor-pointer"
            >
              <Dices className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          )}
          {phase === 'PLAYING' && onRevealHint && !player.hintVisibleToOwner && (
            <button
              type="button"
              onClick={() => onRevealHint(player.id)}
              title="Pokaż graczowi kategorię jako podpowiedź"
              className="flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-md sm:rounded-lg border border-white/15 bg-[#12161E]/90 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              <Lightbulb className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </button>
          )}
          {phase === 'PLAYING' && onMarkSolved && !player.revealed && (
            <button
              type="button"
              onClick={() => onMarkSolved(player.id)}
              title="Zatwierdź że ten gracz zgadł hasło"
              className="flex h-7 sm:h-9 items-center gap-1 rounded-md sm:rounded-lg bg-emerald-500 px-2 sm:px-2.5 text-[10px] sm:text-xs font-bold text-emerald-950 hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="whitespace-nowrap">Zgadł!</span>
            </button>
          )}
        </div>
      )}

      {/* Bottom bar with measured dark scrim */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-1.5 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-2.5 pb-1.5 pt-6 sm:px-3.5 sm:pb-3 sm:pt-10">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 sm:h-2.5 sm:w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: player.avatarColor }}
              title="Kolor obramówki gracza"
            />
            <span className="truncate text-xs sm:text-sm font-semibold text-white">
              {player.name}
              {isSelf ? ' (Ty)' : ''}
            </span>
            {isHost && (
              <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-amber-300 shrink-0">
                <Crown className="h-3 w-3" />
                Host
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] sm:text-xs text-slate-300">
            <span className="font-mono tabular-nums">{player.score} pkt</span>
            <span aria-hidden="true">·</span>
            {!player.isPlaying ? (
              <span className="text-slate-400">Widz</span>
            ) : isActiveTurn ? (
              <span
                className="font-bold truncate"
                style={{ color: player.avatarColor }}
              >
                TERAZ PYTA
              </span>
            ) : player.solved ? (
              <span className="text-emerald-300">Odgadnięte</span>
            ) : (
              <span>W grze</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {player.reactionsDisabled && (
            <span
              title="Host wyłączył temu graczowi komendy TAK/NIE"
              className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-md bg-amber-500/20 text-amber-300"
            >
              <MessageSquareOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </span>
          )}

          {!player.micOn && (
            <span
              title="Mikrofon wyciszony"
              className="flex h-6 w-6 sm:h-7 sm:w-7 items-center justify-center rounded-md bg-rose-500/20 text-rose-300"
            >
              <MicOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </span>
          )}

          {/* Host anti-spam toggle for player's TAK/NIE buttons */}
          {viewerIsHost && !isSelf && onToggleReactionsBlocked && (
            <button
              type="button"
              onClick={() => onToggleReactionsBlocked(player.id)}
              title={
                player.reactionsDisabled
                  ? 'Odblokuj komendy TAK/NIE temu graczowi'
                  : 'Zablokuj komendy TAK/NIE (anty-spam)'
              }
              className={`flex h-6 w-6 sm:h-8 sm:w-8 items-center justify-center rounded-md border transition-colors cursor-pointer ${
                player.reactionsDisabled
                  ? 'border-rose-500/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30'
                  : 'border-white/15 bg-black/50 text-slate-300 hover:border-amber-400/60 hover:text-amber-200'
              }`}
            >
              <MessageSquareOff className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
            </button>
          )}

          {phase === 'PLAYING' &&
            viewerIsHost &&
            player.isPlaying &&
            !player.solved &&
            !player.revealed &&
            !isActiveTurn &&
            onSelectTurn && (
              <button
                type="button"
                onClick={() => onSelectTurn(player.id)}
                className="flex h-6 sm:h-8 items-center gap-1 rounded-md border border-white/15 bg-black/50 px-1.5 sm:px-2.5 text-[10px] sm:text-xs font-medium text-slate-200 hover:border-amber-400/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span className="hidden sm:inline">Daj turę</span>
              </button>
            )}

          {phase === 'LOBBY' && (viewerIsHost || isSelf) && onToggleParticipating && (
            <button
              type="button"
              onClick={() => onToggleParticipating(player.id)}
              title={player.isPlaying ? 'Przełącz na widza' : 'Dodaj do gry'}
              className={`flex h-6 sm:h-8 items-center gap-1 rounded-md border px-2 sm:px-2.5 text-[10px] sm:text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                player.isPlaying
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                  : 'border-white/15 bg-black/50 text-slate-300 hover:bg-white/10'
              }`}
            >
              {player.isPlaying ? (
                <>
                  <UserCheck className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span>Gra</span>
                </>
              ) : (
                <>
                  <UserMinus className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span>Widz</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
