import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ClientMessage,
  GamePhase,
  PlayerReaction,
  RoomEventItem,
  RoomPlayerView,
  RoomSettings,
  RoomStateView,
  ServerMessage,
} from './src/shared/types.ts';
import { DEFAULT_CATEGORY_IDS, pickRandomWord } from './src/shared/words.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AVATAR_COLORS = [
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#EC4899',
  '#8B5CF6',
  '#EF4444',
  '#14B8A6',
  '#F97316',
];

interface InternalPlayer {
  id: string;
  name: string;
  avatarColor: string;
  isPlaying: boolean;
  score: number;
  word: string | null;
  wordCategory: string | null;
  wordAuthorName: string | null;
  assignedTargetId: string | null;
  hintVisibleToOwner: boolean;
  solved: boolean;
  solvedRank: number | null;
  revealed: boolean;
  cameraOn: boolean;
  micOn: boolean;
  lastReaction: PlayerReaction | null;
  ws: WebSocket;
}

interface InternalRoom {
  code: string;
  hostId: string;
  phase: GamePhase;
  roundNumber: number;
  settings: RoomSettings;
  players: InternalPlayer[];
  activeTurnPlayerId: string | null;
  turnEndsAt: number | null;
  events: RoomEventItem[];
  usedWords: Set<string>;
}

const rooms = new Map<string, InternalRoom>();
const socketSession = new WeakMap<WebSocket, { roomCode: string; playerId: string }>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function sanitizeText(input: string, maxLen: number): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function addEvent(
  room: InternalRoom,
  type: RoomEventItem['type'],
  text: string,
  authorName?: string,
) {
  room.events.push({
    id: generateId(),
    type,
    authorName,
    text,
    createdAt: Date.now(),
  });
  if (room.events.length > 50) {
    room.events = room.events.slice(-50);
  }
}

function sendJson(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Projects authoritative room state for a specific player.
 * Strictly strips the recipient's OWN secret word during ASSIGNING/PLAYING
 * so a player can never see or inspect their own forehead card until solved/revealed.
 */
function serializeRoomForPlayer(room: InternalRoom, recipientId: string): RoomStateView {
  const players: RoomPlayerView[] = room.players.map((p) => {
    const isSelf = p.id === recipientId;
    const hideSecret =
      isSelf &&
      (room.phase === 'PLAYING' || room.phase === 'ASSIGNING') &&
      !p.solved &&
      !p.revealed;

    return {
      id: p.id,
      name: p.name,
      avatarColor: p.avatarColor,
      isPlaying: p.isPlaying,
      score: p.score,
      word: hideSecret ? null : p.word,
      wordCategory: hideSecret && !p.hintVisibleToOwner ? null : p.wordCategory,
      wordAuthorName: hideSecret ? null : p.wordAuthorName,
      assignedTargetId: isSelf ? p.assignedTargetId : null,
      hasWord: Boolean(p.word),
      hintVisibleToOwner: p.hintVisibleToOwner,
      solved: p.solved,
      solvedRank: p.solvedRank,
      revealed: p.revealed,
      cameraOn: p.cameraOn,
      micOn: p.micOn,
      lastReaction: p.lastReaction,
    };
  });

  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    settings: room.settings,
    players,
    activeTurnPlayerId: room.activeTurnPlayerId,
    turnEndsAt: room.turnEndsAt,
    events: room.events,
  };
}

function broadcastRoomState(room: InternalRoom) {
  for (const player of room.players) {
    sendJson(player.ws, {
      type: 'room:state',
      room: serializeRoomForPlayer(room, player.id),
    });
  }
}

function resetPlayerWordsForRound(room: InternalRoom) {
  for (const p of room.players) {
    p.word = null;
    p.wordCategory = null;
    p.wordAuthorName = null;
    p.assignedTargetId = null;
    p.hintVisibleToOwner = false;
    p.solved = false;
    p.solvedRank = null;
    p.revealed = false;
  }
}

function getActiveUnsolvedPlayers(room: InternalRoom): InternalPlayer[] {
  return room.players.filter((p) => p.isPlaying && !p.solved && !p.revealed);
}

function setTurn(room: InternalRoom, nextPlayerId: string | null) {
  room.activeTurnPlayerId = nextPlayerId;
  room.turnEndsAt =
    nextPlayerId && room.settings.turnSeconds > 0
      ? Date.now() + room.settings.turnSeconds * 1000
      : null;
}

function advanceTurn(room: InternalRoom) {
  const candidates = getActiveUnsolvedPlayers(room);
  if (candidates.length === 0) {
    room.phase = 'ROUND_OVER';
    setTurn(room, null);
    addEvent(room, 'system', `Runda ${room.roundNumber} zakończona! Wszystkie hasła zostały odkryte.`);
    return;
  }
  const currentIdx = candidates.findIndex((p) => p.id === room.activeTurnPlayerId);
  const next = candidates[(currentIdx + 1) % candidates.length];
  setTurn(room, next.id);
}

function removePlayerFromRoom(ws: WebSocket) {
  const session = socketSession.get(ws);
  if (!session) return;
  socketSession.delete(ws);

  const room = rooms.get(session.roomCode);
  if (!room) return;

  const idx = room.players.findIndex((p) => p.id === session.playerId);
  if (idx === -1) return;

  const [removed] = room.players.splice(idx, 1);
  addEvent(room, 'system', `${removed.name} opuścił(a) pokój.`);

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.hostId === removed.id) {
    room.hostId = room.players[0].id;
    addEvent(room, 'system', `${room.players[0].name} został(a) nowym hostem.`);
  }

  if (room.activeTurnPlayerId === removed.id && room.phase === 'PLAYING') {
    advanceTurn(room);
  }

  broadcastRoomState(room);
}

function handleMessage(ws: WebSocket, raw: string) {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    return;
  }

  if (msg.type === 'room:create') {
    removePlayerFromRoom(ws);
    const name = sanitizeText(msg.name || 'Gracz', 24) || 'Gracz';
    const code = generateRoomCode();
    const playerId = generateId();
    const player: InternalPlayer = {
      id: playerId,
      name,
      avatarColor: AVATAR_COLORS[0],
      isPlaying: true,
      score: 0,
      word: null,
      wordCategory: null,
      wordAuthorName: null,
      assignedTargetId: null,
      hintVisibleToOwner: false,
      solved: false,
      solvedRank: null,
      revealed: false,
      cameraOn: Boolean(msg.cameraOn),
      micOn: Boolean(msg.micOn),
      lastReaction: null,
      ws,
    };

    const room: InternalRoom = {
      code,
      hostId: playerId,
      phase: 'LOBBY',
      roundNumber: 1,
      settings: {
        wordMode: 'RANDOM',
        categories: [...DEFAULT_CATEGORY_IDS],
        turnSeconds: 0,
      },
      players: [player],
      activeTurnPlayerId: null,
      turnEndsAt: null,
      events: [],
      usedWords: new Set<string>(),
    };

    addEvent(room, 'system', `${name} utworzył(a) pokój ${code}.`);
    rooms.set(code, room);
    socketSession.set(ws, { roomCode: code, playerId });

    sendJson(ws, {
      type: 'session:joined',
      playerId,
      room: serializeRoomForPlayer(room, playerId),
    });
    return;
  }

  if (msg.type === 'room:join') {
    removePlayerFromRoom(ws);
    const code = sanitizeText(msg.code || '', 10).toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      sendJson(ws, {
        type: 'room:error',
        message: `Nie znaleziono pokoju o kodzie "${code}". Sprawdź kod i spróbuj ponownie.`,
      });
      return;
    }
    if (room.players.length >= 12) {
      sendJson(ws, {
        type: 'room:error',
        message: 'Pokój jest pełny (maksymalnie 12 osób).',
      });
      return;
    }

    const name = sanitizeText(msg.name || 'Gracz', 24) || 'Gracz';
    const playerId = generateId();
    const player: InternalPlayer = {
      id: playerId,
      name,
      avatarColor: AVATAR_COLORS[room.players.length % AVATAR_COLORS.length],
      isPlaying: room.phase === 'LOBBY',
      score: 0,
      word: null,
      wordCategory: null,
      wordAuthorName: null,
      assignedTargetId: null,
      hintVisibleToOwner: false,
      solved: false,
      solvedRank: null,
      revealed: false,
      cameraOn: Boolean(msg.cameraOn),
      micOn: Boolean(msg.micOn),
      lastReaction: null,
      ws,
    };

    room.players.push(player);
    socketSession.set(ws, { roomCode: code, playerId });
    addEvent(
      room,
      'system',
      room.phase === 'LOBBY'
        ? `${name} dołączył(a) do pokoju.`
        : `${name} dołączył(a) jako widz (może dołączyć w następnej rundzie).`,
    );

    sendJson(ws, {
      type: 'session:joined',
      playerId,
      room: serializeRoomForPlayer(room, playerId),
    });
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'room:leave') {
    removePlayerFromRoom(ws);
    return;
  }

  const session = socketSession.get(ws);
  if (!session) return;
  const room = rooms.get(session.roomCode);
  if (!room) return;
  const sender = room.players.find((p) => p.id === session.playerId);
  if (!sender) return;

  // WebRTC signaling relay (scoped to room)
  if (
    msg.type === 'rtc:offer' ||
    msg.type === 'rtc:answer' ||
    msg.type === 'rtc:ice' ||
    msg.type === 'rtc:reset'
  ) {
    const target = room.players.find((p) => p.id === msg.toPlayerId);
    if (!target) return;
    if (msg.type === 'rtc:offer') {
      sendJson(target.ws, { type: 'rtc:offer', fromPlayerId: sender.id, sdp: msg.sdp });
    } else if (msg.type === 'rtc:answer') {
      sendJson(target.ws, { type: 'rtc:answer', fromPlayerId: sender.id, sdp: msg.sdp });
    } else if (msg.type === 'rtc:ice') {
      sendJson(target.ws, { type: 'rtc:ice', fromPlayerId: sender.id, candidate: msg.candidate });
    } else {
      sendJson(target.ws, { type: 'rtc:reset', fromPlayerId: sender.id });
    }
    return;
  }

  if (msg.type === 'player:media') {
    sender.cameraOn = Boolean(msg.cameraOn);
    sender.micOn = Boolean(msg.micOn);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'player:toggleParticipating') {
    const isHost = room.hostId === sender.id;
    const isSelf = msg.targetPlayerId === sender.id;
    if (!isHost && !isSelf) return;

    const target = room.players.find((p) => p.id === msg.targetPlayerId);
    if (!target) return;
    target.isPlaying = !target.isPlaying;

    // If toggled into an active round, roll a word for them immediately
    if (room.phase === 'PLAYING' && target.isPlaying && !target.word) {
      const picked = pickRandomWord(room.settings.categories, room.usedWords);
      target.word = picked.word;
      target.wordCategory = picked.categoryName;
      target.wordAuthorName = 'Losowe';
      room.usedWords.add(picked.word.toLowerCase());
    }
    if (room.phase === 'PLAYING' && !target.isPlaying && room.activeTurnPlayerId === target.id) {
      advanceTurn(room);
    }

    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'room:updateSettings') {
    if (room.hostId !== sender.id) return;
    if (msg.settings.wordMode === 'RANDOM' || msg.settings.wordMode === 'CUSTOM') {
      room.settings.wordMode = msg.settings.wordMode;
    }
    if (Array.isArray(msg.settings.categories) && msg.settings.categories.length > 0) {
      room.settings.categories = msg.settings.categories;
    }
    if (typeof msg.settings.turnSeconds === 'number' && [0, 30, 60, 90].includes(msg.settings.turnSeconds)) {
      room.settings.turnSeconds = msg.settings.turnSeconds;
    }
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:start') {
    if (room.hostId !== sender.id) return;
    const activePlayers = room.players.filter((p) => p.isPlaying);
    if (activePlayers.length === 0) {
      sendJson(ws, {
        type: 'room:error',
        message: 'Wybierz przynajmniej jednego aktywnego gracza, aby rozpocząć rundę.',
      });
      return;
    }

    resetPlayerWordsForRound(room);

    if (room.settings.wordMode === 'RANDOM') {
      for (const p of activePlayers) {
        const picked = pickRandomWord(room.settings.categories, room.usedWords);
        p.word = picked.word;
        p.wordCategory = picked.categoryName;
        p.wordAuthorName = 'Losowe';
        room.usedWords.add(picked.word.toLowerCase());
      }
      room.phase = 'PLAYING';
      setTurn(room, activePlayers[0].id);
      addEvent(
        room,
        'system',
        `Runda ${room.roundNumber} rozpoczęta! Wylosowano hasła dla ${activePlayers.length} graczy.`,
      );
      broadcastRoomState(room);
      return;
    }

    // CUSTOM mode: require at least 2 people in room to assign words secretly to others
    if (room.players.length < 2) {
      sendJson(ws, {
        type: 'room:error',
        message:
          'Aby wpisywać hasła innym graczom w tajemnicy, zaproś przynajmniej jeszcze jedną osobę (albo przełącz na tryb „Losowe hasła”).',
      });
      return;
    }

    // Build a shuffled circular assignment so every player gets a suggested target (not themselves)
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      const writer = shuffled[i];
      const target = shuffled[(i + 1) % shuffled.length];
      writer.assignedTargetId = target.id !== writer.id ? target.id : null;
    }
    // Spectators can also write a word for the first active player
    for (const p of room.players) {
      if (!p.isPlaying && activePlayers.length > 0) {
        p.assignedTargetId = activePlayers[0].id;
      }
    }

    room.phase = 'ASSIGNING';
    setTurn(room, null);
    addEvent(room, 'system', 'Faza wpisywania haseł! Wybierz gracza i wpisz hasło na jego czoło.');
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:assignWord') {
    const target = room.players.find((p) => p.id === msg.targetPlayerId);
    if (!target) return;
    if (target.id === sender.id) {
      sendJson(ws, {
        type: 'room:error',
        message: 'Nie możesz wpisać hasła samemu sobie — zepsułoby to zabawę!',
      });
      return;
    }
    const cleanWord = sanitizeText(msg.word || '', 48);
    if (!cleanWord) {
      sendJson(ws, { type: 'room:error', message: 'Wpisz hasło przed zapisaniem.' });
      return;
    }
    const cleanCat = sanitizeText(msg.category || '', 32) || 'Własne hasło';

    target.word = cleanWord;
    target.wordCategory = cleanCat;
    target.wordAuthorName = sender.name;
    target.solved = false;
    target.solvedRank = null;
    target.revealed = false;
    target.hintVisibleToOwner = false;

    addEvent(room, 'system', `${sender.name} ustawił(a) nowe hasło dla gracza ${target.name}.`);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:rerollWord') {
    const target = room.players.find((p) => p.id === msg.targetPlayerId);
    if (!target) return;
    // Allow rerolling someone else's word, OR host rerolling during lobby/testing
    if (target.id === sender.id && room.players.length > 1) {
      // Actually rerolling your own random word is totally safe because server hides it from you!
    }
    const catFilter = msg.categoryId ? [msg.categoryId] : room.settings.categories;
    const picked = pickRandomWord(catFilter, room.usedWords);
    target.word = picked.word;
    target.wordCategory = picked.categoryName;
    target.wordAuthorName = 'Losowe';
    target.solved = false;
    target.solvedRank = null;
    target.revealed = false;
    target.hintVisibleToOwner = false;
    room.usedWords.add(picked.word.toLowerCase());

    addEvent(room, 'system', `Wylosowano nowe hasło dla gracza ${target.name}.`);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:beginPlaying') {
    if (room.hostId !== sender.id || room.phase !== 'ASSIGNING') return;
    const activePlayers = room.players.filter((p) => p.isPlaying);
    for (const p of activePlayers) {
      if (!p.word) {
        const picked = pickRandomWord(room.settings.categories, room.usedWords);
        p.word = picked.word;
        p.wordCategory = picked.categoryName;
        p.wordAuthorName = 'Losowe';
        room.usedWords.add(picked.word.toLowerCase());
      }
    }
    room.phase = 'PLAYING';
    setTurn(room, activePlayers[0]?.id ?? null);
    addEvent(room, 'system', `Runda ${room.roundNumber} wystartowała! Kartki na czoło!`);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:setTurn') {
    if (room.phase !== 'PLAYING') return;
    const isHost = room.hostId === sender.id;
    const isCurrentTurn = room.activeTurnPlayerId === sender.id;
    if (!isHost && !isCurrentTurn) return;

    if (msg.targetPlayerId === 'NEXT') {
      advanceTurn(room);
    } else {
      const target = room.players.find(
        (p) => p.id === msg.targetPlayerId && p.isPlaying && !p.solved && !p.revealed,
      );
      if (!target) return;
      setTurn(room, target.id);
    }
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:markSolved') {
    if (room.phase !== 'PLAYING') return;
    const target = room.players.find((p) => p.id === msg.targetPlayerId && p.isPlaying);
    if (!target || target.solved) return;

    const alreadySolvedCount = room.players.filter((p) => p.solved).length;
    const rank = alreadySolvedCount + 1;
    const activeCount = room.players.filter((p) => p.isPlaying).length;
    const pointsAwarded = Math.max(1, activeCount - alreadySolvedCount);

    target.solved = true;
    target.solvedRank = rank;
    target.score += pointsAwarded;

    addEvent(
      room,
      'solved',
      `${target.name} zgadł(a) hasło „${target.word}” (#${rank}, +${pointsAwarded} pkt)!`,
    );

    const remaining = getActiveUnsolvedPlayers(room);
    if (remaining.length === 0) {
      room.phase = 'ROUND_OVER';
      setTurn(room, null);
      addEvent(room, 'system', `Runda ${room.roundNumber} zakończona!`);
    } else if (room.activeTurnPlayerId === target.id) {
      advanceTurn(room);
    }

    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:revealSelf') {
    if (room.phase !== 'PLAYING') return;
    if (sender.solved || sender.revealed) return;
    sender.revealed = true;
    addEvent(room, 'system', `${sender.name} poddał(a) się i odkrył(a) hasło: „${sender.word}”.`);

    const remaining = getActiveUnsolvedPlayers(room);
    if (remaining.length === 0) {
      room.phase = 'ROUND_OVER';
      setTurn(room, null);
    } else if (room.activeTurnPlayerId === sender.id) {
      advanceTurn(room);
    }
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:revealCategoryHint') {
    if (room.phase !== 'PLAYING') return;
    const target = room.players.find((p) => p.id === msg.targetPlayerId);
    if (!target || target.id === sender.id) return;
    target.hintVisibleToOwner = true;
    addEvent(room, 'system', `${sender.name} odkrył(a) podpowiedź kategorii dla gracza ${target.name}.`);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:endRound') {
    if (room.hostId !== sender.id) return;
    room.phase = 'ROUND_OVER';
    setTurn(room, null);
    addEvent(room, 'system', `Host zakończył rundę ${room.roundNumber}. Wszystkie hasła odkryte!`);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:returnToLobby') {
    if (room.hostId !== sender.id) return;
    if (room.phase === 'ROUND_OVER') {
      room.roundNumber += 1;
    }
    room.phase = 'LOBBY';
    setTurn(room, null);
    resetPlayerWordsForRound(room);
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'game:react') {
    const allowed = new Set(['TAK', 'NIE', 'BLISKO', 'NIE_WIEM']);
    if (!allowed.has(msg.reaction)) return;
    sender.lastReaction = { type: msg.reaction, at: Date.now() };
    broadcastRoomState(room);
    return;
  }

  if (msg.type === 'chat:send') {
    const text = sanitizeText(msg.text || '', 220);
    if (!text) return;

    // Anti-spoiler guard: block sending an unsolved player's exact hidden word in public chat
    if (room.phase === 'PLAYING') {
      const lowered = text.toLowerCase();
      const leaked = room.players.find(
        (p) =>
          p.isPlaying &&
          !p.solved &&
          !p.revealed &&
          p.word &&
          p.word.length >= 3 &&
          lowered.includes(p.word.toLowerCase()),
      );
      if (leaked) {
        sendJson(ws, {
          type: 'room:error',
          message: `Wiadomość zablokowana (anty-spoiler) — zawiera ukryte hasło gracza ${leaked.name}!`,
        });
        return;
      }
    }

    addEvent(room, 'chat', text, sender.name);
    broadcastRoomState(room);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeRooms: rooms.size });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      handleMessage(ws, data.toString());
    });
    ws.on('close', () => {
      removePlayerFromRoom(ws);
    });
    ws.on('error', () => {
      removePlayerFromRoom(ws);
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Czółko server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
