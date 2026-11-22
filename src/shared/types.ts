export type GamePhase = 'LOBBY' | 'ASSIGNING' | 'PLAYING' | 'ROUND_OVER';

export type WordMode = 'RANDOM' | 'CUSTOM';

export type ReactionType = 'TAK' | 'NIE' | 'BLISKO' | 'NIE_WIEM';

export interface RoomSettings {
  wordMode: WordMode;
  categories: string[];
  turnSeconds: number; // 0 = bez limitu
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
  | { type: 'room:create'; name: string; cameraOn: boolean; micOn: boolean }
  | { type: 'room:join'; code: string; name: string; cameraOn: boolean; micOn: boolean }
  | { type: 'room:leave' }
  | { type: 'player:media'; cameraOn: boolean; micOn: boolean }
  | { type: 'player:toggleParticipating'; targetPlayerId: string }
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
  | { type: 'rtc:reset'; toPlayerId: string };

// Server -> Client WebSocket messages
export type ServerMessage =
  | { type: 'session:joined'; playerId: string; room: RoomStateView }
  | { type: 'room:state'; room: RoomStateView }
  | { type: 'room:error'; message: string }
  | { type: 'rtc:offer'; fromPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:answer'; fromPlayerId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc:ice'; fromPlayerId: string; candidate: RTCIceCandidateInit }
  | { type: 'rtc:reset'; fromPlayerId: string };
