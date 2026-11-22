import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Crown,
  Dices,
  Eye,
  Lightbulb,
  Lock,
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
  phase: GamePhase;
  stream: MediaStream | null;
  isSpeaking?: boolean;
  audioOutputId?: string;
  audioUnlockTick?: number;
  onAudioBlocked?: () => void;
  compact?: boolean;
  onEditWord?: (player: RoomPlayerView) => void;
  onRerollWord?: (playerId: string) => void;
  onMarkSolved?: (playerId: string) => void;
  onRevealHint?: (playerId: string) => void;
  onSelectTurn?: (playerId: string) => void;
  onToggleParticipating?: (playerId: string) => void;
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
  phase,
  stream,
  isSpeaking = false,
  audioOutputId = '',
  audioUnlockTick = 0,
  onAudioBlocked,
  compact = false,
  onEditWord,
  onRerollWord,
  onMarkSolved,
  onRevealHint,
  onSelectTurn,
  onToggleParticipating,
}: PlayerCameraTileProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);

  const liveVideoTracks = stream?.getVideoTracks().filter((t) => t.readyState === 'live') ?? [];
  const liveAudioTracks = stream?.getAudioTracks().filter((t) => t.readyState === 'live') ?? [];
  const hasLiveVideo = Boolean(player.cameraOn && liveVideoTracks.length > 0);
  const hasRemoteAudio = Boolean(!isSelf && stream && liveAudioTracks.length > 0);

  // Bind muted video stream whenever video becomes available
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (stream && hasLiveVideo) {
      el.srcObject = stream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
  }, [stream, hasLiveVideo]);

  // Bind dedicated <audio> element for remote peer — works even when remote camera is OFF!
  useEffect(() => {
    const el = audioRef.current;
    if (!el || isSelf) return;

    if (stream && liveAudioTracks.length > 0) {
      el.srcObject = stream;
      el.muted = false;
      el.volume = 1;

      if (audioOutputId && 'setSinkId' in el) {
        (el as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(audioOutputId)
          .catch(() => {});
      }

      const playPromise = el.play();
      if (playPromise) {
        playPromise.catch(() => {
          onAudioBlocked?.();
        });
      }
    } else {
      el.srcObject = null;
    }
  }, [stream, isSelf, liveAudioTracks.length, audioOutputId, audioUnlockTick, onAudioBlocked]);

  // Remote voice activity indicator so everyone sees who is speaking
  useEffect(() => {
    if (isSelf || !stream || !player.micOn || liveAudioTracks.length === 0) {
      setRemoteSpeaking(false);
      return;
    }

    let rafId = 0;
    let audioCtx: AudioContext | null = null;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(new MediaStream(liveAudioTracks));
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        setRemoteSpeaking(sum / data.length > 18);
        rafId = window.requestAnimationFrame(tick);
      };
      rafId = window.requestAnimationFrame(tick);
    } catch {
      // Ignore if AudioContext unavailable
    }

    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      if (audioCtx) audioCtx.close().catch(() => {});
    };
  }, [isSelf, stream, player.micOn, liveAudioTracks.length]);

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

  const speakingNow = isSelf ? isSpeaking : remoteSpeaking;
  const canManageOtherWord =
    !isSelf && player.isPlaying && (phase === 'PLAYING' || phase === 'ASSIGNING');

  const borderClass = isActiveTurn
    ? 'ring-2 ring-amber-400 border-amber-400/70'
    : speakingNow
      ? 'ring-2 ring-emerald-400/80 border-emerald-400/60'
      : 'border-white/10';

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-[#161A22] transition-all duration-150 ${borderClass} ${
        !player.isPlaying ? 'opacity-65' : ''
      } ${compact ? 'aspect-video' : 'aspect-video w-full h-full min-h-[210px]'}`}
    >
      {/* Dedicated always-mounted remote audio player (independent of cameraOn) */}
      {!isSelf && <audio ref={audioRef} autoPlay playsInline className="hidden" />}

      {/* Video feed (always muted since remote audio uses dedicated <audio> above) */}
      {hasLiveVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${isSelf ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-[#181C24]">
          <div
            className={`flex h-20 w-20 items-center justify-center rounded-full font-display text-2xl font-bold text-slate-950 shadow-lg transition-transform duration-150 ${
              speakingNow ? 'scale-105 ring-4 ring-emerald-400/45' : ''
            }`}
            style={{ backgroundColor: player.avatarColor }}
          >
            {initials || '?'}
          </div>
          <span className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
            <VideoOff className="h-3.5 w-3.5" />
            {player.cameraOn && !isSelf
              ? 'Łączenie obrazu...'
              : hasRemoteAudio && player.micOn
                ? 'Tylko dźwięk'
                : 'Kamera wyłączona'}
          </span>
        </div>
      )}

      {/* Top gradient scrim for forehead card legibility */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/75 via-black/30 to-transparent" />

      {/* FOREHEAD CARD (The signature Czółko element) */}
      {player.isPlaying && (phase === 'PLAYING' || phase === 'ROUND_OVER') && (
        <div className="absolute inset-x-3 top-3 z-20 flex justify-center">
          {player.solved ? (
            <div className="forehead-solved relative max-w-[92%] rounded-lg border border-emerald-600/30 px-4 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold tracking-wide text-emerald-800">
                <Check className="h-3.5 w-3.5" />
                <span>ZGADNIĘTE · #{player.solvedRank}</span>
              </div>
              <div className="font-display text-lg font-extrabold leading-tight text-slate-950 sm:text-xl">
                {player.word}
              </div>
            </div>
          ) : isSelf && !player.revealed && phase === 'PLAYING' ? (
            <div className="forehead-masked relative max-w-[90%] rounded-lg border border-white/15 px-5 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5 font-display text-lg font-extrabold tracking-widest text-amber-300 sm:text-xl">
                <Lock className="h-4 w-4 text-amber-400" />
                <span>? ? ?</span>
              </div>
              <div className="mt-0.5 text-[11px] font-medium text-slate-300">
                {player.wordCategory
                  ? `Podpowiedź: ${player.wordCategory}`
                  : 'Twoje hasło widzą tylko inni'}
              </div>
            </div>
          ) : (
            <div className="forehead-paper relative max-w-[94%] rounded-lg border border-amber-700/20 px-4 py-2 text-center">
              <div
                aria-hidden="true"
                className="mx-auto -mt-3.5 mb-1 h-2.5 w-10 rounded-sm bg-white/55 backdrop-blur-xs"
              />
              <div className="font-display text-lg font-extrabold leading-tight text-stone-950 sm:text-2xl">
                {player.word || 'Brak hasła'}
              </div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] font-medium text-stone-700">
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
        <div className="absolute inset-x-3 top-3 z-20 flex justify-center">
          <div className="rounded-lg border border-white/15 bg-[#12161E]/90 px-3.5 py-2 text-center backdrop-blur-sm">
            {player.hasWord ? (
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <Check className="h-3.5 w-3.5" />
                <span>
                  {isSelf ? 'Masz już wpisane tajne hasło!' : `Hasło gotowe: ${player.word}`}
                </span>
              </div>
            ) : (
              <div className="text-xs font-medium text-amber-200">
                {isSelf ? 'Ktoś właśnie wymyśla Twoje hasło...' : 'Czeka na wpisanie hasła'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reaction burst overlay (TAK / NIE / BLISKO) */}
      {showReaction && (
        <div className="pointer-events-none absolute right-3 top-1/2 z-30 -translate-y-1/2">
          <div
            className={`rounded-lg px-3.5 py-1.5 font-display text-lg font-extrabold tracking-wide shadow-xl ${showReaction.bg} ${showReaction.text}`}
          >
            {showReaction.label}
          </div>
        </div>
      )}

      {/* Hover quick actions for OTHER players' forehead cards */}
      {canManageOtherWord && !player.solved && (
        <div className="absolute bottom-14 right-3 z-20 flex items-center gap-1.5 opacity-100 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          {onEditWord && (
            <button
              type="button"
              onClick={() => onEditWord(player)}
              title="Wpisz własne hasło temu graczowi"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-white/15 bg-[#12161E]/90 px-2.5 text-xs font-semibold text-slate-100 hover:bg-amber-500 hover:text-slate-950 transition-colors cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Wpisz hasło</span>
            </button>
          )}
          {phase === 'PLAYING' && onRerollWord && (
            <button
              type="button"
              onClick={() => onRerollWord(player.id)}
              title="Wylosuj nowe hasło temu graczowi"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#12161E]/90 text-slate-100 hover:bg-white/15 transition-colors cursor-pointer"
            >
              <Dices className="h-4 w-4" />
            </button>
          )}
          {phase === 'PLAYING' && onRevealHint && !player.hintVisibleToOwner && (
            <button
              type="button"
              onClick={() => onRevealHint(player.id)}
              title="Pokaż graczowi kategorię jako podpowiedź"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-[#12161E]/90 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
              <Lightbulb className="h-4 w-4" />
            </button>
          )}
          {phase === 'PLAYING' && onMarkSolved && !player.revealed && (
            <button
              type="button"
              onClick={() => onMarkSolved(player.id)}
              title="Zatwierdź że ten gracz zgadł hasło"
              className="flex h-9 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 transition-colors cursor-pointer"
            >
              <Check className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Zgadł!</span>
            </button>
          )}
        </div>
      )}

      {/* Bottom bar with measured dark scrim */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-2 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3.5 pb-3 pt-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-white">
              {player.name}
              {isSelf ? ' (Ty)' : ''}
            </span>
            {isHost && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300 shrink-0">
                <Crown className="h-3 w-3" />
                Host
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-300">
            <span className="font-mono tabular-nums">{player.score} pkt</span>
            <span aria-hidden="true">·</span>
            {!player.isPlaying ? (
              <span className="text-slate-400">Widz</span>
            ) : isActiveTurn ? (
              <span className="font-semibold text-amber-300">Zadaje pytania</span>
            ) : player.solved ? (
              <span className="text-emerald-300">Odgadnięte</span>
            ) : (
              <span>W grze</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!player.micOn && (
            <span
              title="Mikrofon wyciszony"
              className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-500/20 text-rose-300"
            >
              <MicOff className="h-3.5 w-3.5" />
            </span>
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
                className="flex h-8 items-center gap-1 rounded-md border border-white/15 bg-black/50 px-2.5 text-xs font-medium text-slate-200 hover:border-amber-400/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Eye className="h-3.5 w-3.5" />
                Daj turę
              </button>
            )}

          {phase === 'LOBBY' && (viewerIsHost || isSelf) && onToggleParticipating && (
            <button
              type="button"
              onClick={() => onToggleParticipating(player.id)}
              title={player.isPlaying ? 'Przełącz na widza' : 'Dodaj do gry'}
              className={`flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                player.isPlaying
                  ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                  : 'border-white/15 bg-black/50 text-slate-300 hover:bg-white/10'
              }`}
            >
              {player.isPlaying ? (
                <>
                  <UserCheck className="h-3.5 w-3.5" />
                  Gra
                </>
              ) : (
                <>
                  <UserMinus className="h-3.5 w-3.5" />
                  Widz
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
