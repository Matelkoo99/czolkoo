import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Check,
  ChevronRight,
  Copy,
  Crown,
  Dices,
  Eye,
  Flag,
  LayoutPanelTop,
  LayoutTemplate,
  LogOut,
  MessageSquareOff,
  Mic,
  MicOff,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trophy,
  UserCheck,
  UserMinus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  PLAYER_BORDER_COLORS,
  type ClientMessage,
  type ReactionType,
  type RoomPlayerView,
  type RoomStateView,
  type SpotlightLayout,
  type WordMode,
} from '../shared/types.ts';
import { WORD_CATEGORIES, pickRandomWord } from '../shared/words.ts';
import { soundEngine } from '../utils/sound.ts';
import { PlayerCameraTile } from './PlayerCameraTile.tsx';
import { WordAssignModal } from './WordAssignModal.tsx';

interface GameRoomProps {
  room: RoomStateView;
  myPlayerId: string;
  localStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  remoteFrames: Record<string, string>;
  remoteSpeaking: Record<string, boolean>;
  cameraOn: boolean;
  micOn: boolean;
  localSpeaking: boolean;
  mediaError: string | null;
  roomError: string | null;
  onClearRoomError: () => void;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onOpenMediaSettings: () => void;
  onSend: (msg: ClientMessage) => void;
  onLeave: () => void;
}

const TIMER_OPTIONS = [
  { value: 0, label: 'Bez limitu' },
  { value: 30, label: '30 s' },
  { value: 60, label: '60 s' },
  { value: 90, label: '90 s' },
];

export function GameRoom({
  room,
  myPlayerId,
  localStream,
  remoteStreams,
  remoteFrames,
  remoteSpeaking,
  cameraOn,
  micOn,
  localSpeaking,
  mediaError,
  roomError,
  onClearRoomError,
  onToggleCamera,
  onToggleMic,
  onOpenMediaSettings,
  onSend,
  onLeave,
}: GameRoomProps) {
  // Default sidebar open on desktop (>=1024px) and closed on mobile so all cameras are immediately visible!
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  );
  const [copiedLink, setCopiedLink] = useState(false);
  const [soundMuted, setSoundMuted] = useState(soundEngine.isMuted());
  const [editModalTargetId, setEditModalTargetId] = useState<string | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Inline assigning panel state
  const [assignTargetId, setAssignTargetId] = useState<string>('');
  const [assignWord, setAssignWord] = useState('');
  const [assignCategory, setAssignCategory] = useState('Własne hasło');

  // Playing helpers: private scratchpad & chat
  const [scratchpad, setScratchpad] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const me = useMemo(
    () => room.players.find((p) => p.id === myPlayerId) ?? null,
    [room.players, myPlayerId],
  );
  const isHost = room.hostId === myPlayerId;
  const activePlayers = useMemo(() => room.players.filter((p) => p.isPlaying), [room.players]);
  const otherActivePlayers = useMemo(
    () => activePlayers.filter((p) => p.id !== myPlayerId),
    [activePlayers, myPlayerId],
  );
  const activeTurnPlayer = useMemo(
    () => room.players.find((p) => p.id === room.activeTurnPlayerId) ?? null,
    [room.players, room.activeTurnPlayerId],
  );

  // When phase switches to PLAYING on mobile, auto-close drawer so all cameras are visible
  useEffect(() => {
    if (room.phase === 'PLAYING' && typeof window !== 'undefined' && window.innerWidth < 1024) {
      setSidebarOpen(false);
    } else if (
      room.phase === 'ASSIGNING' &&
      typeof window !== 'undefined' &&
      window.innerWidth < 1024
    ) {
      setSidebarOpen(true);
    }
  }, [room.phase]);

  // Reset scratchpad & give-up confirmation when a new round begins
  useEffect(() => {
    if (room.phase === 'LOBBY') {
      setScratchpad('');
      setConfirmGiveUp(false);
    }
  }, [room.phase, room.roundNumber]);

  // Pre-select suggested target when entering ASSIGNING phase
  useEffect(() => {
    if (room.phase === 'ASSIGNING') {
      const suggested = me?.assignedTargetId;
      if (suggested && otherActivePlayers.some((p) => p.id === suggested)) {
        setAssignTargetId(suggested);
      } else if (
        otherActivePlayers.length > 0 &&
        !otherActivePlayers.some((p) => p.id === assignTargetId)
      ) {
        setAssignTargetId(otherActivePlayers[0].id);
      }
    }
  }, [room.phase, me?.assignedTargetId, otherActivePlayers, assignTargetId]);

  // Turn countdown timer
  useEffect(() => {
    if (!room.turnEndsAt || room.phase !== 'PLAYING') {
      setSecondsLeft(null);
      return;
    }

    let lastTickedSec = -1;
    const update = () => {
      const diff = Math.max(0, Math.ceil((room.turnEndsAt! - Date.now()) / 1000));
      setSecondsLeft(diff);
      if (diff <= 5 && diff > 0 && diff !== lastTickedSec) {
        lastTickedSec = diff;
        soundEngine.playTimerTick();
      } else if (diff === 0 && lastTickedSec !== 0) {
        lastTickedSec = 0;
        soundEngine.playTimerEnd();
      }
    };
    update();
    const id = window.setInterval(update, 250);
    return () => window.clearInterval(id);
  }, [room.turnEndsAt, room.phase]);

  // Scroll chat to bottom on new events
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [room.events.length]);

  const copyInviteLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', room.code);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2200);
    } catch {
      // Fallback if clipboard blocked
    }
  };

  const toggleSound = () => {
    const next = !soundMuted;
    soundEngine.setMuted(next);
    setSoundMuted(next);
  };

  const toggleCategory = (catId: string) => {
    if (!isHost) return;
    const current = room.settings.categories;
    let next: string[];
    if (current.includes(catId)) {
      if (current.length === 1) return;
      next = current.filter((c) => c !== catId);
    } else {
      next = [...current, catId];
    }
    onSend({ type: 'room:updateSettings', settings: { categories: next } });
  };

  const handleAssignSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTargetId || !assignWord.trim()) return;
    onSend({
      type: 'game:assignWord',
      targetPlayerId: assignTargetId,
      word: assignWord.trim(),
      category: assignCategory.trim() || 'Własne hasło',
    });
    setAssignWord('');
    const nextMissing = otherActivePlayers.find((p) => p.id !== assignTargetId && !p.hasWord);
    if (nextMissing) {
      setAssignTargetId(nextMissing.id);
    }
  };

  const handleRandomFillAssign = () => {
    const picked = pickRandomWord(room.settings.categories);
    setAssignWord(picked.word);
    setAssignCategory(picked.categoryName);
  };

  const handleOpenEditModal = (target?: RoomPlayerView) => {
    setEditModalTargetId(target?.id ?? otherActivePlayers[0]?.id ?? null);
    setEditModalOpen(true);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    onSend({ type: 'chat:send', text: chatInput.trim() });
    setChatInput('');
  };

  const sendReaction = (reaction: ReactionType) => {
    if (me?.reactionsDisabled) return;
    onSend({ type: 'game:react', reaction });
  };

  // Order players: when turnAnimations is enabled during PLAYING, move activeTurnPlayer to index 0 (spotlight)
  const orderedPlayers = useMemo(() => {
    if (room.phase === 'PLAYING' && room.settings.turnAnimations && room.activeTurnPlayerId) {
      const active = room.players.find((p) => p.id === room.activeTurnPlayerId);
      if (active) {
        return [active, ...room.players.filter((p) => p.id !== room.activeTurnPlayerId)];
      }
    }
    return room.players;
  }, [room.players, room.phase, room.settings.turnAnimations, room.activeTurnPlayerId]);

  const hasSpotlightActive = Boolean(
    room.phase === 'PLAYING' &&
      room.settings.turnAnimations &&
      activeTurnPlayer &&
      room.players.length > 1,
  );
  const spotlightLayout: SpotlightLayout = room.settings.spotlightLayout || 'TOP';

  // Standard responsive grid (always 2 columns on mobile when >=2 players so everyone fits on screen without scrolling)
  const playerCount = room.players.length;
  const standardGridClass =
    playerCount === 1
      ? 'grid-cols-1 max-w-3xl mx-auto w-full'
      : playerCount === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : playerCount <= 4
          ? 'grid-cols-2'
          : playerCount <= 6
            ? 'grid-cols-2 xl:grid-cols-3'
            : playerCount <= 9
              ? 'grid-cols-2 sm:grid-cols-3'
              : 'grid-cols-3 xl:grid-cols-4';

  const readyCount = activePlayers.filter((p) => p.hasWord).length;
  const sortedLeaderboard = [...room.players].sort((a, b) => b.score - a.score);

  const phaseLabel =
    room.phase === 'LOBBY'
      ? 'Poczekalnia'
      : room.phase === 'ASSIGNING'
        ? 'Wpisywanie haseł'
        : room.phase === 'PLAYING'
          ? activeTurnPlayer
            ? `Tura: ${activeTurnPlayer.name}`
            : 'Rozgrywka'
          : 'Podsumowanie rundy';

  const renderTile = (player: RoomPlayerView, opts?: { isSpotlight?: boolean; compact?: boolean }) => {
    const isSelf = player.id === myPlayerId;
    const stream = isSelf ? localStream : remoteStreams[player.id] ?? null;
    const isTurn = room.phase === 'PLAYING' && room.activeTurnPlayerId === player.id;
    return (
      <PlayerCameraTile
        key={player.id}
        player={player}
        isSelf={isSelf}
        isHost={player.id === room.hostId}
        viewerIsHost={isHost}
        isActiveTurn={isTurn}
        turnAnimations={room.settings.turnAnimations}
        isSpotlight={opts?.isSpotlight ?? false}
        compact={opts?.compact ?? false}
        phase={room.phase}
        stream={stream}
        remoteFrame={isSelf ? null : remoteFrames[player.id] ?? null}
        isSpeaking={isSelf ? localSpeaking : Boolean(remoteSpeaking[player.id])}
        onToggleSelfCamera={onToggleCamera}
        onToggleSelfMic={onToggleMic}
        onEditWord={(target) => handleOpenEditModal(target)}
        onRerollWord={(targetId) => onSend({ type: 'game:rerollWord', targetPlayerId: targetId })}
        onMarkSolved={(targetId) => onSend({ type: 'game:markSolved', targetPlayerId: targetId })}
        onRevealHint={(targetId) =>
          onSend({ type: 'game:revealCategoryHint', targetPlayerId: targetId })
        }
        onSelectTurn={(targetId) => onSend({ type: 'game:setTurn', targetPlayerId: targetId })}
        onToggleParticipating={(targetId) =>
          onSend({ type: 'player:toggleParticipating', targetPlayerId: targetId })
        }
        onToggleReactionsBlocked={(targetId) =>
          onSend({ type: 'player:toggleReactionsBlocked', targetPlayerId: targetId })
        }
      />
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#0F1115] text-[#F3F4F6]">
      {/* Compact Broadcast Top Bar */}
      <header className="flex h-12 sm:h-14 shrink-0 items-center justify-between gap-2 sm:gap-4 border-b border-white/8 bg-[#13161C] px-3 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <span className="font-display text-base sm:text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0">
            Czółko
          </span>
          <span aria-hidden="true" className="text-slate-600">
            /
          </span>
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <span className="text-xs text-slate-400 hidden sm:inline whitespace-nowrap">Pokój</span>
            <span className="font-mono text-xs sm:text-sm font-bold tracking-wider text-amber-300 tabular-nums">
              {room.code}
            </span>
            <button
              type="button"
              onClick={copyInviteLink}
              className="inline-flex h-7 sm:h-8 items-center gap-1 rounded-md border border-white/12 bg-white/5 px-2 sm:px-2.5 text-[11px] sm:text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedLink ? (
                <>
                  <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-emerald-400" />
                  <span>Skopiowano</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                  <span>Zaproś</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Center round & turn status */}
        <div className="hidden md:flex items-center gap-3 text-sm">
          <span className="text-slate-400 whitespace-nowrap">Runda {room.roundNumber}</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="font-semibold text-white whitespace-nowrap">{phaseLabel}</span>
          {secondsLeft !== null && room.phase === 'PLAYING' && (
            <>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span
                className={`inline-flex items-center gap-1 font-mono text-sm font-bold tabular-nums ${
                  secondsLeft <= 10 ? 'text-rose-400' : 'text-amber-300'
                }`}
              >
                <Timer className="h-3.5 w-3.5" />
                {secondsLeft}s
              </span>
            </>
          )}
        </div>

        {/* Right utility actions */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {secondsLeft !== null && room.phase === 'PLAYING' && (
            <span
              className={`md:hidden inline-flex items-center gap-1 font-mono text-xs font-bold tabular-nums px-1.5 ${
                secondsLeft <= 10 ? 'text-rose-400' : 'text-amber-300'
              }`}
            >
              <Timer className="h-3 w-3" />
              {secondsLeft}s
            </span>
          )}

          <button
            type="button"
            onClick={toggleSound}
            title={soundMuted ? 'Włącz dźwięki gry' : 'Wycisz dźwięki gry'}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
          >
            {soundMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? 'Ukryj panel boczny' : 'Pokaż panel gry i opcje'}
            className={`inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border px-2.5 sm:px-3 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              sidebarOpen
                ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                : 'border-white/10 text-slate-200 hover:bg-white/5'
            }`}
          >
            {sidebarOpen ? (
              <>
                <PanelRightClose className="h-4 w-4" />
                <span>Ukryj panel</span>
              </>
            ) : (
              <>
                <PanelRightOpen className="h-4 w-4" />
                <span>Menu / Opcje</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onLeave}
            title="Wyjdź z pokoju"
            className="inline-flex h-8 sm:h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 sm:px-3 text-xs font-medium text-slate-300 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Wyjdź</span>
          </button>
        </div>
      </header>

      {/* Main Content Area: Dominant Webcam Stage + Responsive Overlay/Side Drawer */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {/* Webcam Grid Stage */}
        <main className="relative flex flex-1 flex-col min-w-0 overflow-y-auto p-2 sm:p-5">
          {/* Error toast bar */}
          {(roomError || mediaError) && (
            <div
              role="alert"
              className="mb-2 sm:mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs sm:text-sm text-amber-100"
            >
              <span>{roomError || mediaError}</span>
              {roomError && (
                <button
                  type="button"
                  onClick={onClearRoomError}
                  className="text-xs font-semibold text-amber-300 hover:text-white cursor-pointer whitespace-nowrap"
                >
                  Zamknij
                </button>
              )}
            </div>
          )}

          {/* Contextual Mobile Lobby Banner when sidebar is closed */}
          {room.phase === 'LOBBY' && !sidebarOpen && (
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-[#161A22] px-3 py-2 text-xs">
              <span className="text-slate-200">
                Poczekalnia · <strong className="text-amber-300">{activePlayers.length}</strong> w
                grze
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSidebarOpen(true)}
                  className="rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-semibold text-white hover:bg-white/10 cursor-pointer whitespace-nowrap"
                >
                  Opcje i kolor
                </button>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'game:start' })}
                    className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 font-bold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Start gry
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Solo room invite prompt */}
          {room.phase === 'LOBBY' && room.players.length === 1 && (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-white/10 bg-[#161A22] px-3.5 py-2.5 text-xs sm:text-sm">
              <div className="text-slate-300">
                Kod pokoju: <strong className="font-mono text-amber-300">{room.code}</strong>. Wyślij
                link znajomym, aby dołączyli z kamerkami.
              </div>
              <button
                type="button"
                onClick={copyInviteLink}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Copy className="h-3.5 w-3.5" />
                {copiedLink ? 'Skopiowano!' : 'Skopiuj link'}
              </button>
            </div>
          )}

          {/* Active turn top bar */}
          {room.phase === 'PLAYING' && activeTurnPlayer && (
            <div
              className="mb-2.5 sm:mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-[#171B24] px-3 py-2 sm:px-4 sm:py-3 transition-colors"
              style={{ borderColor: `${activeTurnPlayer.avatarColor}66` }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor: activeTurnPlayer.avatarColor,
                    boxShadow: `0 0 10px ${activeTurnPlayer.avatarColor}`,
                  }}
                />
                <div className="text-xs sm:text-sm truncate">
                  <span className="text-slate-400">Pytania zadaje: </span>
                  <strong
                    className="font-display text-sm sm:text-base font-bold"
                    style={{ color: activeTurnPlayer.avatarColor }}
                  >
                    {activeTurnPlayer.name}
                    {activeTurnPlayer.id === myPlayerId ? ' (Ty!)' : ''}
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                {me && me.isPlaying && !me.solved && !me.revealed && (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'game:markSolved', targetPlayerId: myPlayerId })}
                    className="inline-flex h-8 sm:h-9 items-center gap-1 rounded-lg bg-emerald-500 px-2.5 sm:px-3.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Check className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span>Zgadłem!</span>
                  </button>
                )}

                {otherActivePlayers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal()}
                    className="inline-flex h-8 sm:h-9 items-center gap-1 rounded-lg border border-white/15 bg-[#11151C] px-2.5 sm:px-3 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Wpisz hasło</span>
                  </button>
                )}

                {(isHost || activeTurnPlayer.id === myPlayerId) && (
                  <button
                    type="button"
                    onClick={() => onSend({ type: 'game:setTurn', targetPlayerId: 'NEXT' })}
                    className="inline-flex h-8 sm:h-9 items-center gap-1 rounded-lg bg-amber-500 px-2.5 sm:px-3.5 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <span>Następny</span>
                    <ChevronRight className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* WEBCAM STAGE: Spotlight Animated Modes vs Standard Grid */}
          {hasSpotlightActive && spotlightLayout === 'TOP' ? (
            /* MODE 1: Active Turn Player Enlarged at TOP ("Na górze") + Remaining players in compact grid below */
            <div className="flex flex-1 flex-col gap-2.5 sm:gap-4 min-h-0">
              <div className="w-full max-w-3xl mx-auto shrink-0">
                {renderTile(orderedPlayers[0], { isSpotlight: true })}
              </div>
              <div
                className={`grid flex-1 gap-2 sm:gap-3 ${
                  orderedPlayers.length - 1 === 1
                    ? 'grid-cols-1 max-w-md mx-auto w-full'
                    : orderedPlayers.length - 1 <= 4
                      ? 'grid-cols-2 sm:grid-cols-3'
                      : 'grid-cols-3 sm:grid-cols-4'
                }`}
              >
                {orderedPlayers.slice(1).map((p) => renderTile(p, { compact: true }))}
              </div>
            </div>
          ) : hasSpotlightActive && spotlightLayout === 'TOP_LEFT' ? (
            /* MODE 2: Active Turn Player Enlarged in TOP-LEFT corner ("W lewym górnym rogu") */
            <div className="grid flex-1 grid-cols-2 lg:grid-cols-12 gap-2.5 sm:gap-4 content-start">
              <div className="col-span-2 lg:col-span-7">
                {renderTile(orderedPlayers[0], { isSpotlight: true })}
              </div>
              <div
                className={`col-span-2 lg:col-span-5 grid gap-2 sm:gap-3 content-start ${
                  orderedPlayers.length - 1 === 1 ? 'grid-cols-1' : 'grid-cols-2'
                }`}
              >
                {orderedPlayers.slice(1).map((p) => renderTile(p, { compact: true }))}
              </div>
            </div>
          ) : (
            /* STANDARD GRID (or when turnAnimations is disabled) */
            <div className={`grid flex-1 content-center gap-2.5 sm:gap-4 ${standardGridClass}`}>
              {orderedPlayers.map((p) => renderTile(p, { compact: playerCount >= 4 }))}
            </div>
          )}

          {/* Round Summary Overlay when ROUND_OVER */}
          {room.phase === 'ROUND_OVER' && (
            <div className="mt-4 rounded-2xl border border-amber-400/25 bg-[#161A22] p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Trophy className="h-6 w-6 text-amber-400 shrink-0" />
                  <div>
                    <h2 className="font-display text-lg sm:text-xl font-bold text-white">
                      Koniec rundy {room.roundNumber} — hasła odkryte
                    </h2>
                    <p className="text-xs text-slate-400">
                      Zobacz, kto co miał na czole i aktualną punktację
                    </p>
                  </div>
                </div>

                {isHost && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onSend({ type: 'game:returnToLobby' })}
                      className="inline-flex h-9 sm:h-10 items-center gap-1.5 rounded-lg border border-white/15 px-3 sm:px-4 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Lobby
                    </button>
                    <button
                      type="button"
                      onClick={() => onSend({ type: 'game:start' })}
                      className="inline-flex h-9 sm:h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-4 sm:px-5 text-xs sm:text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <Play className="h-4 w-4" />
                      Kolejna runda
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {activePlayers.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-[#11151C] px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">{p.name}</div>
                      <div className="truncate font-display text-sm sm:text-base font-bold text-amber-200">
                        {p.word || '—'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {p.wordCategory || 'Hasło'}
                        {p.wordAuthorName ? ` · od: ${p.wordAuthorName}` : ''}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm font-bold text-white tabular-nums">
                        {p.score} pkt
                      </div>
                      <div
                        className={`text-[11px] font-medium ${
                          p.solved ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        {p.solved ? `Zgadł #${p.solvedRank}` : 'Nieodgadnięte'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* Mobile Backdrop Scrim when drawer is open */}
        {sidebarOpen && (
          <div
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-black/65 backdrop-blur-xs lg:hidden"
          />
        )}

        {/* Right Control Panel (Slide-over Drawer on Mobile, Side Panel on Desktop) */}
        {sidebarOpen && (
          <aside className="fixed inset-y-0 right-0 z-40 flex w-[88vw] max-w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#141820] shadow-2xl lg:static lg:z-auto lg:w-[370px] lg:shadow-none">
            {/* Mobile drawer header with explicit close button */}
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3 lg:hidden">
              <span className="font-display text-sm font-bold text-white">
                Panel gry i ustawienia
              </span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
                Zamknij
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
              {/* Personal Border Color Picker (available to every player!) */}
              <div className="rounded-xl border border-white/8 bg-[#10131A] p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-200">
                    Twój kolor obramówki
                  </span>
                  <span
                    className="text-xs font-semibold"
                    style={{ color: me?.avatarColor ?? '#F59E0B' }}
                  >
                    {PLAYER_BORDER_COLORS.find((c) => c.hex === me?.avatarColor)?.name ?? 'Wybrany'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {PLAYER_BORDER_COLORS.map((c) => {
                    const active = me?.avatarColor === c.hex;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onSend({ type: 'player:setBorderColor', color: c.hex })}
                        title={c.name}
                        aria-label={`Zmień kolor obramówki na ${c.name}`}
                        className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                          active
                            ? 'scale-110 border-white'
                            : 'border-transparent opacity-70 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: c.hex,
                          boxShadow: active ? `0 0 12px ${c.hex}` : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* LOBBY CONTROLS */}
              {room.phase === 'LOBBY' && (
                <>
                  {/* Host Turn Animation & Spotlight Position Options */}
                  <div className="rounded-xl border border-white/8 bg-[#10131A] p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-amber-400 shrink-0" />
                        <div>
                          <h3 className="text-xs font-semibold text-white">
                            Animacja i powiększenie tury
                          </h3>
                          <p className="text-[11px] text-slate-400">
                            Płynąca obramówka i wyróżnienie gracza
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!isHost}
                        onClick={() =>
                          onSend({
                            type: 'room:updateSettings',
                            settings: { turnAnimations: !room.settings.turnAnimations },
                          })
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                          room.settings.turnAnimations
                            ? 'bg-emerald-500 text-emerald-950'
                            : 'bg-white/10 text-slate-300'
                        } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-80'}`}
                      >
                        {room.settings.turnAnimations ? 'WŁ.' : 'WYŁ.'}
                      </button>
                    </div>

                    {room.settings.turnAnimations && (
                      <div>
                        <span className="block text-[11px] font-semibold text-slate-300 mb-1.5">
                          Pozycja powiększonego gracza (gdy zadaje pytania):
                        </span>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            disabled={!isHost}
                            onClick={() =>
                              onSend({
                                type: 'room:updateSettings',
                                settings: { spotlightLayout: 'TOP' },
                              })
                            }
                            className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 px-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                              room.settings.spotlightLayout === 'TOP'
                                ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                                : 'border-white/10 bg-[#141820] text-slate-400 hover:text-slate-200'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <LayoutPanelTop className="h-3.5 w-3.5" />
                            Na górze
                          </button>
                          <button
                            type="button"
                            disabled={!isHost}
                            onClick={() =>
                              onSend({
                                type: 'room:updateSettings',
                                settings: { spotlightLayout: 'TOP_LEFT' },
                              })
                            }
                            className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 px-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                              room.settings.spotlightLayout === 'TOP_LEFT'
                                ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                                : 'border-white/10 bg-[#141820] text-slate-400 hover:text-slate-200'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <LayoutTemplate className="h-3.5 w-3.5" />
                            Lewy górny róg
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h2 className="font-display text-base font-bold text-white">
                      Tryb wyboru haseł
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      {isHost
                        ? 'Zdecyduj, czy hasła losuje gra, czy wpisujecie je sobie nawzajem.'
                        : 'Ustawienia rundy kontroluje host pokoju.'}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg bg-[#0F1115] p-1">
                      {(
                        [
                          { id: 'RANDOM', label: 'Losowe hasła', icon: Dices },
                          { id: 'CUSTOM', label: 'Wpisujemy graczom', icon: Pencil },
                        ] as Array<{ id: WordMode; label: string; icon: typeof Dices }>
                      ).map((opt) => {
                        const Icon = opt.icon;
                        const active = room.settings.wordMode === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            disabled={!isHost}
                            onClick={() =>
                              onSend({
                                type: 'room:updateSettings',
                                settings: { wordMode: opt.id },
                              })
                            }
                            className={`flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? 'bg-amber-500 text-slate-950'
                                : 'text-slate-300 hover:text-white'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default opacity-85'}`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Categories selector */}
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-200">Kategorie losowania</h3>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        {room.settings.categories.length}/{WORD_CATEGORIES.length}
                      </span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {WORD_CATEGORIES.map((cat) => {
                        const selected = room.settings.categories.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            disabled={!isHost}
                            onClick={() => toggleCategory(cat.id)}
                            className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                              selected
                                ? 'border-amber-400/50 bg-amber-500/10 text-amber-100'
                                : 'border-white/8 bg-[#10131A] text-slate-400 hover:border-white/20'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            <span className="font-medium truncate pr-2">{cat.name}</span>
                            <span className="font-mono text-[11px] tabular-nums shrink-0 opacity-80">
                              {cat.words.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Turn timer selector */}
                  <div>
                    <h3 className="text-xs font-semibold text-slate-200">Czas na turę</h3>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {TIMER_OPTIONS.map((t) => {
                        const active = room.settings.turnSeconds === t.value;
                        return (
                          <button
                            key={t.value}
                            type="button"
                            disabled={!isHost}
                            onClick={() =>
                              onSend({
                                type: 'room:updateSettings',
                                settings: { turnSeconds: t.value },
                              })
                            }
                            className={`rounded-lg border py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                                : 'border-white/10 bg-[#10131A] text-slate-400 hover:text-slate-200'
                            } ${isHost ? 'cursor-pointer' : 'cursor-default'}`}
                          >
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Players to choose from + Host anti-spam reaction mute */}
                  <div>
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-semibold text-slate-200">
                        Gracze ({activePlayers.length} w grze)
                      </h3>
                      <span className="text-[11px] text-slate-400">Status i komendy</span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {room.players.map((p) => {
                        const canToggle = isHost || p.id === myPlayerId;
                        return (
                          <div
                            key={p.id}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 ${
                              p.isPlaying
                                ? 'border-white/12 bg-[#181D27] text-white'
                                : 'border-white/6 bg-[#10131A] text-slate-400'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: p.avatarColor }}
                              />
                              <span className="truncate text-sm font-medium">
                                {p.name}
                                {p.id === myPlayerId ? ' (Ty)' : ''}
                              </span>
                              {p.id === room.hostId && (
                                <Crown className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isHost && p.id !== myPlayerId && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onSend({
                                      type: 'player:toggleReactionsBlocked',
                                      targetPlayerId: p.id,
                                    })
                                  }
                                  title={
                                    p.reactionsDisabled
                                      ? 'Odblokuj komendy TAK/NIE temu graczowi'
                                      : 'Zablokuj komendy TAK/NIE (anty-spam)'
                                  }
                                  className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors cursor-pointer ${
                                    p.reactionsDisabled
                                      ? 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                                      : 'border-white/10 bg-black/40 text-slate-300 hover:border-amber-400/50'
                                  }`}
                                >
                                  <MessageSquareOff className="h-3 w-3" />
                                  <span>{p.reactionsDisabled ? 'Odblokuj' : 'Mute TAK/NIE'}</span>
                                </button>
                              )}

                              <button
                                type="button"
                                disabled={!canToggle}
                                onClick={() =>
                                  onSend({
                                    type: 'player:toggleParticipating',
                                    targetPlayerId: p.id,
                                  })
                                }
                                className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-semibold shrink-0 ${
                                  p.isPlaying
                                    ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                                    : 'border-white/10 bg-black/40 text-slate-400'
                                } ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                              >
                                {p.isPlaying ? (
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Start game primary action */}
                  <div className="pt-2">
                    {isHost ? (
                      <button
                        type="button"
                        onClick={() => onSend({ type: 'game:start' })}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3.5 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                      >
                        <Play className="h-4 w-4" />
                        {room.settings.wordMode === 'CUSTOM'
                          ? 'Przejdź do wpisywania haseł'
                          : 'Wylosuj hasła i zacznij grę'}
                      </button>
                    ) : (
                      <div className="rounded-xl border border-white/10 bg-[#10131A] p-3.5 text-center text-xs text-slate-400">
                        Czekamy aż host rozpocznie rundę...
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ASSIGNING PHASE CONTROLS */}
              {room.phase === 'ASSIGNING' && (
                <>
                  <div>
                    <h2 className="font-display text-base font-bold text-white">
                      Wpisz hasło wybranemu graczowi
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Wybierz osobę poniżej i wpisz hasło na jej czoło. Możesz wpisać hasła nawet
                      kilku graczom.
                    </p>

                    <form onSubmit={handleAssignSubmit} className="mt-4 space-y-3.5">
                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Wybierz gracza
                        </label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {otherActivePlayers.map((p) => {
                            const selected = p.id === assignTargetId;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setAssignTargetId(p.id)}
                                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors cursor-pointer ${
                                  selected
                                    ? 'border-amber-400 bg-amber-500/15 text-amber-100'
                                    : 'border-white/10 bg-[#10131A] text-slate-300 hover:border-white/25'
                                }`}
                              >
                                <span className="truncate">{p.name}</span>
                                {p.hasWord && (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor="assign-word"
                            className="text-xs font-semibold text-slate-300"
                          >
                            Hasło na czoło
                          </label>
                          <button
                            type="button"
                            onClick={handleRandomFillAssign}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                          >
                            <Dices className="h-3.5 w-3.5" />
                            Wylosuj podpowiedź
                          </button>
                        </div>
                        <input
                          id="assign-word"
                          type="text"
                          value={assignWord}
                          onChange={(e) => setAssignWord(e.target.value)}
                          maxLength={48}
                          placeholder="np. Adam Małysz, Shrek..."
                          className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-3.5 py-2.5 text-sm font-semibold text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="assign-cat"
                          className="block text-xs font-semibold text-slate-300 mb-1"
                        >
                          Kategoria (opcjonalnie)
                        </label>
                        <input
                          id="assign-cat"
                          type="text"
                          value={assignCategory}
                          onChange={(e) => setAssignCategory(e.target.value)}
                          maxLength={32}
                          placeholder="np. Własne hasło"
                          className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-3.5 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={!assignTargetId || !assignWord.trim()}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <Send className="h-4 w-4" />
                        Zapisz hasło dla gracza
                      </button>
                    </form>
                  </div>

                  {/* Readiness status */}
                  <div className="border-t border-white/8 pt-5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">Status haseł</span>
                      <span className="font-mono text-amber-300 tabular-nums">
                        {readyCount}/{activePlayers.length} gotowych
                      </span>
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {activePlayers.map((p) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-2 text-xs"
                        >
                          <span className="text-slate-200">
                            {p.name}
                            {p.id === myPlayerId ? ' (Ty)' : ''}
                          </span>
                          <span
                            className={
                              p.hasWord ? 'font-semibold text-emerald-400' : 'text-amber-300'
                            }
                          >
                            {p.hasWord ? 'Gotowe' : 'Czeka...'}
                          </span>
                        </div>
                      ))}
                    </div>

                    {isHost && (
                      <button
                        type="button"
                        onClick={() => onSend({ type: 'game:beginPlaying' })}
                        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                      >
                        <Play className="h-4 w-4" />
                        {readyCount === activePlayers.length
                          ? 'Rozpocznij rundę — Kartki na czoło!'
                          : 'Rozpocznij (resztę wylosuj)'}
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* PLAYING PHASE CONTROLS */}
              {room.phase === 'PLAYING' && (
                <>
                  {/* Quick group answers (TAK / NIE / BLISKO) */}
                  <div>
                    <h2 className="text-xs font-semibold text-slate-300">
                      Szybka reakcja na pytanie (pokazuje się na kamerce)
                    </h2>
                    {me?.reactionsDisabled ? (
                      <div className="mt-2 rounded-lg border border-rose-500/35 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
                        Host wyłączył Ci możliwość klikania szybkich komend TAK / NIE.
                      </div>
                    ) : (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => sendReaction('TAK')}
                          className="rounded-lg bg-emerald-500/15 border border-emerald-500/35 py-2.5 font-display text-sm font-extrabold text-emerald-300 hover:bg-emerald-500 hover:text-emerald-950 transition-colors cursor-pointer"
                        >
                          TAK!
                        </button>
                        <button
                          type="button"
                          onClick={() => sendReaction('NIE')}
                          className="rounded-lg bg-rose-500/15 border border-rose-500/35 py-2.5 font-display text-sm font-extrabold text-rose-300 hover:bg-rose-500 hover:text-white transition-colors cursor-pointer"
                        >
                          NIE!
                        </button>
                        <button
                          type="button"
                          onClick={() => sendReaction('BLISKO')}
                          className="rounded-lg bg-amber-500/15 border border-amber-500/35 py-2 font-display text-xs font-extrabold text-amber-300 hover:bg-amber-400 hover:text-amber-950 transition-colors cursor-pointer"
                        >
                          BLISKO!
                        </button>
                        <button
                          type="button"
                          onClick={() => sendReaction('NIE_WIEM')}
                          className="rounded-lg bg-white/5 border border-white/12 py-2 font-display text-xs font-extrabold text-slate-200 hover:bg-white/15 transition-colors cursor-pointer"
                        >
                          NIE WIEM
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Host live anti-spam & animation controls during PLAYING */}
                  {isHost && (
                    <div className="border-t border-white/8 pt-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">
                          Moderacja komend TAK/NIE (anty-spam)
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {room.players
                          .filter((p) => p.id !== myPlayerId)
                          .map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between rounded-lg bg-[#10131A] px-3 py-1.5 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: p.avatarColor }}
                                />
                                <span className="truncate text-slate-200">{p.name}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  onSend({
                                    type: 'player:toggleReactionsBlocked',
                                    targetPlayerId: p.id,
                                  })
                                }
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer ${
                                  p.reactionsDisabled
                                    ? 'border-rose-500/40 bg-rose-500/20 text-rose-200'
                                    : 'border-white/10 bg-white/5 text-slate-300 hover:border-amber-400/50'
                                }`}
                              >
                                <MessageSquareOff className="h-3 w-3" />
                                {p.reactionsDisabled ? 'Zablokowany' : 'Zablokuj TAK/NIE'}
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Personal Clue Scratchpad */}
                  <div className="border-t border-white/8 pt-4">
                    <label
                      htmlFor="clue-notes"
                      className="block text-xs font-semibold text-slate-200 mb-1.5"
                    >
                      Twój prywatny notatnik wskazówek
                    </label>
                    <textarea
                      id="clue-notes"
                      rows={3}
                      value={scratchpad}
                      onChange={(e) => setScratchpad(e.target.value)}
                      placeholder="Zapisuj co już wiesz o swoim haśle (np. człowiek, z Polski, YouTuber)..."
                      className="w-full resize-none rounded-lg border border-white/12 bg-[#0F1115] p-3 text-xs leading-relaxed text-slate-200 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  {/* Self / Host Round Actions */}
                  <div className="border-t border-white/8 pt-4 space-y-2">
                    <h3 className="text-xs font-semibold text-slate-300">Akcje rundy</h3>

                    {me && me.isPlaying && !me.solved && !me.revealed && (
                      <>
                        {!confirmGiveUp ? (
                          <button
                            type="button"
                            onClick={() => setConfirmGiveUp(true)}
                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#10131A] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-rose-500/40 hover:text-rose-300 transition-colors cursor-pointer"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Poddaję się — odkryj moje hasło
                          </button>
                        ) : (
                          <div className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-3 text-xs">
                            <p className="text-rose-200 font-medium">
                              Na pewno odkryć Twoje hasło? Nie dostaniesz punktów w tej rundzie.
                            </p>
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  onSend({ type: 'game:revealSelf' });
                                  setConfirmGiveUp(false);
                                }}
                                className="flex-1 rounded-md bg-rose-500 py-1.5 font-bold text-white hover:bg-rose-400 cursor-pointer"
                              >
                                Tak, odkryj
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmGiveUp(false)}
                                className="flex-1 rounded-md border border-white/15 py-1.5 text-slate-200 hover:bg-white/5 cursor-pointer"
                              >
                                Anuluj
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {isHost && (
                      <button
                        type="button"
                        onClick={() => onSend({ type: 'game:endRound' })}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#10131A] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer"
                      >
                        <Flag className="h-3.5 w-3.5" />
                        Zakończ rundę i pokaż hasła
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* LEADERBOARD (in ROUND_OVER) */}
              {room.phase === 'ROUND_OVER' && (
                <div>
                  <h2 className="font-display text-base font-bold text-white">Tabela wyników</h2>
                  <div className="mt-3 space-y-1.5">
                    {sortedLeaderboard.map((p, idx) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg bg-[#10131A] px-3.5 py-2.5 text-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="font-mono text-xs font-bold text-amber-400 tabular-nums w-5">
                            #{idx + 1}
                          </span>
                          <span className="truncate font-medium text-white">{p.name}</span>
                        </div>
                        <span className="font-mono text-sm font-bold text-slate-200 tabular-nums">
                          {p.score} pkt
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Room Chat & Activity Feed (always accessible) */}
              <div className="border-t border-white/8 pt-4">
                <h3 className="text-xs font-semibold text-slate-300">Czat pokoju</h3>
                <div className="mt-2.5 max-h-48 space-y-2 overflow-y-auto pr-1 text-xs">
                  {room.events.map((ev) => (
                    <div
                      key={ev.id}
                      className={
                        ev.type === 'solved'
                          ? 'rounded-md bg-emerald-500/12 px-2.5 py-1.5 text-emerald-200 font-medium'
                          : ev.type === 'system'
                            ? 'text-slate-400'
                            : 'rounded-md bg-[#10131A] px-2.5 py-1.5 text-slate-200'
                      }
                    >
                      {ev.authorName && (
                        <span className="mr-1.5 font-semibold text-amber-300">
                          {ev.authorName}:
                        </span>
                      )}
                      <span>{ev.text}</span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleChatSubmit} className="mt-2.5 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    maxLength={220}
                    placeholder="Napisz wiadomość..."
                    className="min-w-0 flex-1 rounded-lg border border-white/12 bg-[#0F1115] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim()}
                    aria-label="Wyślij wiadomość"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 hover:bg-amber-500 hover:text-slate-950 disabled:opacity-40 transition-colors cursor-pointer"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Studio Media Dock */}
      <footer className="flex h-14 sm:h-16 shrink-0 items-center justify-between gap-2 sm:gap-4 border-t border-white/8 bg-[#13161C] px-3 sm:px-6">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onToggleCamera}
            className={`inline-flex h-9 sm:h-10 items-center gap-1.5 sm:gap-2 rounded-lg border px-2.5 sm:px-3.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              cameraOn
                ? 'border-white/15 bg-[#1B202B] text-white hover:bg-[#232A38]'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
            }`}
          >
            {cameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
            <span className="hidden sm:inline">{cameraOn ? 'Kamera wł.' : 'Kamera wył.'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMic}
            className={`inline-flex h-9 sm:h-10 items-center gap-1.5 sm:gap-2 rounded-lg border px-2.5 sm:px-3.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              micOn
                ? 'border-white/15 bg-[#1B202B] text-white hover:bg-[#232A38]'
                : 'border-rose-500/40 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
            }`}
          >
            {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            <span className="hidden sm:inline">{micOn ? 'Mikrofon wł.' : 'Wyciszony'}</span>
          </button>

          <button
            type="button"
            onClick={onOpenMediaSettings}
            className="inline-flex h-9 sm:h-10 items-center gap-1.5 sm:gap-2 rounded-lg border border-white/15 bg-[#1B202B] px-2.5 sm:px-3.5 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden sm:inline">Opcje audio/wideo</span>
          </button>
        </div>

        {/* Quick TAK / NIE / BLISKO / NIE WIEM buttons always accessible in bottom dock during PLAYING */}
        {room.phase === 'PLAYING' && (
          <div className="flex items-center gap-1 sm:gap-2">
            {me?.reactionsDisabled ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-300">
                <MessageSquareOff className="h-3 w-3" />
                Komendy wyłączone
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => sendReaction('TAK')}
                  className="h-8 sm:h-9 rounded-lg bg-emerald-500 px-2.5 sm:px-4 font-display text-[11px] sm:text-xs font-extrabold text-emerald-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap"
                >
                  TAK!
                </button>
                <button
                  type="button"
                  onClick={() => sendReaction('NIE')}
                  className="h-8 sm:h-9 rounded-lg bg-rose-500 px-2.5 sm:px-4 font-display text-[11px] sm:text-xs font-extrabold text-white hover:bg-rose-400 cursor-pointer whitespace-nowrap"
                >
                  NIE!
                </button>
                <button
                  type="button"
                  onClick={() => sendReaction('BLISKO')}
                  className="h-8 sm:h-9 rounded-lg bg-amber-400 px-2.5 sm:px-3.5 font-display text-[11px] sm:text-xs font-extrabold text-amber-950 hover:bg-amber-300 cursor-pointer whitespace-nowrap"
                >
                  BLISKO!
                </button>
                <button
                  type="button"
                  onClick={() => sendReaction('NIE_WIEM')}
                  className="hidden xs:inline-flex sm:inline-flex items-center h-8 sm:h-9 rounded-lg border border-white/15 bg-white/10 px-2.5 sm:px-3 font-display text-[11px] sm:text-xs font-extrabold text-white hover:bg-white/20 cursor-pointer whitespace-nowrap"
                >
                  NIE WIEM
                </button>
              </>
            )}
          </div>
        )}

        <div className="text-xs text-slate-400 hidden md:flex items-center gap-2">
          <span>
            {room.players.length}{' '}
            {room.players.length === 1 ? 'osoba' : room.players.length < 5 ? 'osoby' : 'osób'} w
            pokoju
          </span>
          <span aria-hidden="true">·</span>
          <span>{activePlayers.length} w grze</span>
        </div>
      </footer>

      {/* Modal for writing custom word to any chosen player */}
      <WordAssignModal
        open={editModalOpen}
        players={room.players}
        myPlayerId={myPlayerId}
        initialTargetId={editModalTargetId}
        selectedCategories={room.settings.categories}
        onClose={() => setEditModalOpen(false)}
        onSubmit={(targetPlayerId, word, category) => {
          onSend({ type: 'game:assignWord', targetPlayerId, word, category });
        }}
      />
    </div>
  );
}
