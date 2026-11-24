export type GamePhase = 'LOBBY' | 'ASSIGNING' | 'PLAYING' | 'ROUND_OVER';

export type WordMode = 'RANDOM' | 'CUSTOM';

export type ReactionType = 'TAK' | 'NIE' | 'BLISKO' | 'NIE_WIEM';

export type SpotlightLayout = 'TOP' | 'TOP_LEFT';

export const PLAYER_BORDER_COLORS = [
  { id: 'amber', hex: '#F59E0B', name: 'Złoty' },
  { id: 'emerald', hex: '#10B981', name: 'Szmaragdowy' },
  { id: 'blue', hex: '#3B82F6', name: 'Błękitny' },
  { id: 'pink', hex: '#EC4899', name: 'Różowy' },
  { id: 'purple', hex: '#8B5CF6', name: 'Fioletowy' },
  { id: 'red', hex: '#EF4444', name: 'Czerwony' },
  { id: 'cyan', hex: '#06B6D4', name: 'Cyjan' },
  { id: 'lime', hex: '#84CC16', name: 'Limonkowy' },
] as const;

export interface RoomSettings {
  wordMode: WordMode;
  categories: string[];
  turnSeconds: number; // 0 = bez limitu
  turnAnimations: boolean;
  spotlightLayout: SpotlightLayout;
}

export interface PlayerReaction {
  type: ReactionType;
  at: number;
}

export interface RoomPlayerView {
  id: string;
  name: string;
  avatarColor: string;
  isPlaying: boolean;
  score: number;
  word: string | null;
  wordCategory: string | null;
  wordAuthorName: string | null;
  assignedTargetId: string | null;
  hasWord: boolean;
  hintVisibleToOwner: boolean;
  solved: boolean;
  solvedRank: number | null;
  revealed: boolean;
  cameraOn: boolean;
  micOn: boolean;
  reactionsDisabled: boolean;
  lastReaction: PlayerReaction | null;
}

export interface RoomEventItem {
  id: string;
  type: 'system' | 'chat' | 'solved';
  authorName?: string;
  text: string;
  createdAt: number;
}

export interface RoomStateView {
  code: string;
  hostId: string;
  phase: GamePhase;
  roundNumber: number;
  settings: RoomSettings;
  players: RoomPlayerView[];
  activeTurnPlayerId: string | null;
  turnEndsAt: number | null;
  events: RoomEventItem[];
}

export interface WordCategory {
  id: string;
  name: string;
  description: string;
  words: string[];
}

// Client -> Server WebSocket messages
export type ClientMessage =
  | {
      type: 'room:create';
      name: string;
      cameraOn: boolean;
      micOn: boolean;
      borderColor?: string;
    }
  | {
      type: 'room:join';
      code: string;
      name: string;
      cameraOn: boolean;
      micOn: boolean;
      borderColor?: string;
    }
  | { type: 'room:leave' }
  | { type: 'player:media'; cameraOn: boolean; micOn: boolean }
  | { type: 'player:setBorderColor'; color: string }
  | { type: 'player:toggleParticipating'; targetPlayerId: string }
  | { type: 'player:toggleReactionsBlocked'; targetPlayerId: string }
  | { type: 'room:updateSettings'; settings: Partial<RoomSettings> }
  | { type: 'game:start' }
  | { type: 'game:assignWord'; targetPlayerId: string; word: string; category?: string }
  | { type: 'game:rerollWord'; targetPlayerId: string; categoryId?: string }
  | { type: 'game:beginPlaying' }
  | { type: 'game:setTurn'; targetPlayerId: string | 'NEXT' }
  | { type: 'game:markSolved'; targetPlayerId: string }
  | { type: 'game:revealSelf' }
  | { type: 'game:revealCategoryHint'; targetPlayerId: string }
  | { type: 'game:endRound' }
  | { type: 'game:returnToLobby' }
  | { type: 'game:react'; reaction: ReactionType }
  | { type: 'chat:send'; text: string }
  | { type: 'rtc:offer'; toPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:answer'; toPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:ice'; toPlayerId: string; candidate: RTCIceCandidateInit }
  | { type: 'rtc:reset'; toPlayerId: string }
  | { type: 'media:video'; frame: string }
  | { type: 'media:audio'; pcm: string; sampleRate: number };

// Server -> Client WebSocket messages
export type ServerMessage =
  | { type: 'session:joined'; playerId: string; room: RoomStateView }
  | { type: 'room:state'; room: RoomStateView }
  | { type: 'room:error'; message: string }
  | { type: 'rtc:offer'; fromPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:answer'; fromPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:ice'; fromPlayerId: string; candidate: RTCIceCandidateInit }
  | { type: 'rtc:reset'; fromPlayerId: string }
  | { type: 'media:video'; fromPlayerId: string; frame: string }
  | { type: 'media:audio'; fromPlayerId: string; pcm: string; sampleRate: number };
