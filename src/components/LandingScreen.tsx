import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Dices,
  Mic,
  MicOff,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Users,
  Video,
} from 'lucide-react';
import { PLAYER_BORDER_COLORS } from '../shared/types.ts';
import { WORD_CATEGORIES } from '../shared/words.ts';

interface LandingScreenProps {
  initialRoomCode: string;
  connected: boolean;
  error: string | null;
  localStream: MediaStream | null;
  cameraOn: boolean;
  micOn: boolean;
  localAudioLevel: number;
  mediaError: string | null;
  isRequestingMedia: boolean;
  onToggleCamera: () => void;
  onToggleMic: () => void;
  onEnableBothMedia: () => void;
  onOpenMediaSettings: () => void;
  onCreateRoom: (name: string, borderColor: string) => void;
  onJoinRoom: (code: string, name: string, borderColor: string) => void;
  onClearError: () => void;
}

const DEMO_CARDS = [
  { word: 'Robert Makłowicz', category: 'Celebryci, Muzyka i Sport' },
  { word: 'Kapibara', category: 'Zwierzęta' },
  { word: 'Geralt z Rivii', category: 'Filmy, Seriale i Bajki' },
  { word: 'Książulo', category: 'Polski Internet i Twórcy' },
  { word: 'Pieróg ruski', category: 'Przedmioty i Jedzenie' },
];

export function LandingScreen({
  initialRoomCode,
  connected,
  error,
  localStream,
  cameraOn,
  micOn,
  localAudioLevel,
  mediaError,
  isRequestingMedia,
  onToggleCamera,
  onToggleMic,
  onEnableBothMedia,
  onOpenMediaSettings,
  onCreateRoom,
  onJoinRoom,
  onClearError,
}: LandingScreenProps) {
  const [mode, setMode] = useState<'create' | 'join'>(initialRoomCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [roomCode, setRoomCode] = useState(initialRoomCode);
  const [borderColor, setBorderColor] = useState<string>(PLAYER_BORDER_COLORS[0].hex);
  const [demoIdx, setDemoIdx] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (localStream && cameraOn) {
      el.srcObject = localStream;
    } else {
      el.srcObject = null;
    }
  }, [localStream, cameraOn]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim() || 'Gracz';
    if (mode === 'create') {
      onCreateRoom(cleanName, borderColor);
    } else {
      const cleanCode = roomCode.trim().toUpperCase();
      if (!cleanCode) return;
      onJoinRoom(cleanCode, cleanName, borderColor);
    }
  };

  const focusCreate = () => {
    setMode('create');
    onClearError();
    nameInputRef.current?.focus();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const demoCard = DEMO_CARDS[demoIdx];

  return (
    <div className="min-h-screen bg-[#0F1115] text-[#F3F4F6]">
      {/* Clean 3-zone Top Bar Contract */}
      <header className="border-b border-white/8 bg-[#0F1115]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="/"
            className="font-display text-xl font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Czółko
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a
              href="#jak-grac"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Jak grać
            </a>
            <a
              href="#tryby"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Tryby haseł
            </a>
            <a
              href="#kategorie"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Kategorie
            </a>
          </nav>

          <button
            type="button"
            onClick={focusCreate}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Stwórz pokój
          </button>
        </div>
      </header>

      <main>
        {/* Split Hero: Join/Create Form + Live Webcam & Forehead Card Preview */}
        <section className="mx-auto max-w-6xl px-6 pb-16 pt-10 lg:pt-14">
          <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-12">
            {/* Left column: Headline + Room Entry Form */}
            <div className="flex flex-col justify-between lg:col-span-6">
              <div>
                <p className="text-sm font-medium text-amber-400">
                  Gra imprezowa z kamerkami · Do 12 osób w pokoju
                </p>
                <h1 className="mt-3 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white [text-wrap:balance] sm:text-5xl">
                  Zgadnij, kim jesteś — zanim zrobią to inni.
                </h1>
                <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300">
                  Wszyscy widzicie się na kamerkach z kartką hasła nad głową. Widzisz hasła
                  znajomych, ale nigdy swojego. Losuj hasła z polskich kategorii albo wpisuj
                  własne hasła wybranym graczom.
                </p>
              </div>

              {/* Entry form surface */}
              <div className="mt-8 rounded-2xl border border-white/10 bg-[#161A22] p-6">
                {/* Segmented mode switch */}
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#0F1115] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('create');
                      onClearError();
                    }}
                    className={`rounded-md py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'create'
                        ? 'bg-[#222834] text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Stwórz nowy pokój
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('join');
                      onClearError();
                    }}
                    className={`rounded-md py-2 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      mode === 'join'
                        ? 'bg-[#222834] text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Dołącz kodem
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="mt-5 space-y-4">
                  <div>
                    <label
                      htmlFor="player-name"
                      className="block text-xs font-semibold text-slate-300 mb-1.5"
                    >
                      Twój nick w grze
                    </label>
                    <input
                      ref={nameInputRef}
                      id="player-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      placeholder="np. Mateusz, Kasia, Bartek..."
                      required
                      className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-4 py-3 text-base font-medium text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>

                  {mode === 'join' && (
                    <div>
                      <label
                        htmlFor="room-code"
                        className="block text-xs font-semibold text-slate-300 mb-1.5"
                      >
                        Kod pokoju (5 znaków)
                      </label>
                      <input
                        id="room-code"
                        type="text"
                        value={roomCode}
                        onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                        maxLength={6}
                        placeholder="np. K8P4M"
                        required
                        className="w-full rounded-lg border border-white/15 bg-[#0F1115] px-4 py-3 font-mono text-lg font-bold tracking-widest text-amber-300 uppercase placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  )}

                  {/* Player custom border color picker */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-300">
                        Twój kolor obramówki (podświetlenie tury)
                      </span>
                      <span
                        className="text-xs font-semibold"
                        style={{ color: borderColor }}
                      >
                        {PLAYER_BORDER_COLORS.find((c) => c.hex === borderColor)?.name ?? 'Własny'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {PLAYER_BORDER_COLORS.map((c) => {
                        const active = c.hex === borderColor;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setBorderColor(c.hex)}
                            title={c.name}
                            aria-label={`Kolor obramówki: ${c.name}`}
                            className={`h-9 w-9 rounded-full border-2 transition-transform cursor-pointer ${
                              active ? 'scale-110 border-white shadow-md' : 'border-transparent opacity-75 hover:opacity-100'
                            }`}
                            style={{
                              backgroundColor: c.hex,
                              boxShadow: active ? `0 0 14px ${c.hex}` : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {/* Player custom border color picker */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-300">
                        Twój kolor obramówki (podświetlenie tury)
                      </span>
                      <span
                        className="text-xs font-semibold"
                        style={{ color: borderColor }}
                      >
                        {PLAYER_BORDER_COLORS.find((c) => c.hex === borderColor)?.name ?? 'Własny'}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {PLAYER_BORDER_COLORS.map((c) => {
                        const active = c.hex === borderColor;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setBorderColor(c.hex)}
                            title={c.name}
                            aria-label={`Kolor obramówki: ${c.name}`}
                            className={`h-9 w-9 rounded-full border-2 transition-transform cursor-pointer ${
                              active ? 'scale-110 border-white shadow-md' : 'border-transparent opacity-75 hover:opacity-100'
                            }`}
                            style={{
                              backgroundColor: c.hex,
                              boxShadow: active ? `0 0 14px ${c.hex}` : undefined,
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-lg border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200"
                    >
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={!connected || (mode === 'join' && roomCode.trim().length < 3)}
                    className="w-full rounded-lg bg-amber-500 px-5 py-3.5 text-base font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {!connected
                      ? 'Łączenie z serwerem...'
                      : mode === 'create'
                        ? 'Utwórz pokój z kamerkami'
                        : 'Dołącz do pokoju'}
                  </button>
                </form>
              </div>
            </div>

            {/* Right column: Live Webcam Preview + Forehead Card Demo */}
            <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#161A22] p-5 lg:col-span-6">
              <div className="flex items-center justify-between gap-4 pb-3.5">
                <div>
                  <h2 className="font-display text-lg font-bold text-white">
                    Podgląd kamerki i kartki
                  </h2>
                  <p className="text-xs text-slate-400">
                    Sprawdź obraz i dźwięk przed wejściem do pokoju
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDemoIdx((i) => (i + 1) % DEMO_CARDS.length)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0F1115] px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-400/50 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Inne przykładowe hasło
                </button>
              </div>

              {/* Live preview frame with animated flowing player border */}
              <div
                className="turn-flowing-frame relative flex-1 min-h-[260px] overflow-hidden rounded-xl border bg-[#0F1115]"
                style={{ '--player-border-color': borderColor } as React.CSSProperties}
              >
                <div aria-hidden="true" className="turn-flowing-ring" />
                {localStream && cameraOn ? (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover scale-x-[-1]"
                  />
                ) : (
                  <div className="flex h-full min-h-[260px] w-full flex-col items-center justify-center px-6 pt-12 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1F2532] text-slate-300">
                      <Video className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      Kamera jest obecnie wyłączona
                    </p>
                    <p className="mt-1 max-w-xs text-xs text-slate-400">
                      Włącz kamerę i mikrofon tutaj albo od razu wejdź do pokoju — gra poprosi o
                      dostęp automatycznie.
                    </p>
                    <button
                      type="button"
                      disabled={isRequestingMedia}
                      onClick={onEnableBothMedia}
                      className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-xs font-bold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Włącz kamerę i mikrofon
                    </button>
                  </div>
                )}

                {/* Top contrast scrim */}
                <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 via-black/25 to-transparent" />

                {/* Authentic Czółko forehead card preview */}
                <div className="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
                  <div className="forehead-paper max-w-[90%] rounded-lg border border-amber-700/20 px-5 py-2 text-center">
                    <div
                      aria-hidden="true"
                      className="mx-auto -mt-3.5 mb-1 h-2.5 w-10 rounded-sm bg-white/55"
                    />
                    <div className="font-display text-xl font-extrabold text-stone-950 sm:text-2xl">
                      {demoCard.word}
                    </div>
                    <div className="mt-0.5 text-[11px] font-medium text-stone-700">
                      {demoCard.category} · Tak widzą Cię inni gracze
                    </div>
                  </div>
                </div>

                {/* Bottom preview nameplate */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
                  <div className="flex items-center justify-between text-xs text-slate-200">
                    <span className="font-semibold text-white">{name.trim() || 'Twój podgląd'}</span>
                    <span>
                      {cameraOn ? 'Kamera aktywna' : 'Bez kamery'} ·{' '}
                      {micOn ? 'Mikrofon aktywny' : 'Mikrofon wyciszony'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Camera & mic controls */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isRequestingMedia}
                    onClick={onToggleCamera}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      cameraOn
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                        : 'border-white/15 bg-[#0F1115] text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    {cameraOn ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />}
                    {cameraOn ? 'Wyłącz kamerę' : 'Włącz kamerę'}
                  </button>

                  <button
                    type="button"
                    disabled={isRequestingMedia}
                    onClick={onToggleMic}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      micOn
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                        : 'border-white/15 bg-[#0F1115] text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                    {micOn ? 'Mikrofon wł.' : 'Włącz mikrofon'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onOpenMediaSettings}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-[#0F1115] px-3.5 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  Wybierz kamerę i mikrofon
                </button>
              </div>

              {micOn && (
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                  <span className="shrink-0">Poziom głosu:</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-75"
                      style={{ width: `${Math.max(4, localAudioLevel)}%` }}
                    />
                  </div>
                </div>
              )}

              {mediaError && (
                <p className="mt-3 text-xs text-amber-300" role="status">
                  {mediaError}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* How it works — clean horizontal editorial row */}
        <section id="jak-grac" className="border-t border-white/8 bg-[#12151C]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
              Jak wygląda rozgrywka
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3">
              <div>
                <div className="font-mono text-sm font-bold text-amber-400">01</div>
                <h3 className="mt-2 font-display text-lg font-bold text-white">
                  Wybierz graczy i kamerki
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Udostępnij znajomym link lub 5-znakowy kod pokoju. Host wybiera, kto bierze udział
                  w rundzie, a kto ogląda jako widz.
                </p>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-amber-400">02</div>
                <h3 className="mt-2 font-display text-lg font-bold text-white">
                  Losowe albo własne hasła
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Włącz automatyczne losowanie z polskich kategorii albo tryb wpisywania — każdy
                  wybiera gracza i wpisuje tajne hasło na jego czoło.
                </p>
              </div>
              <div>
                <div className="font-mono text-sm font-bold text-amber-400">03</div>
                <h3 className="mt-2 font-display text-lg font-bold text-white">
                  Zadawaj pytania i zgaduj
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Rozmawiajcie przez mikrofon i reagujcie przyciskami TAK / NIE / BLISKO. Serwer
                  chroni hasło przed podglądem aż do odgadnięcia.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Word modes spotlight */}
        <section id="tryby" className="border-t border-white/8">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-[#161A22] p-7">
                <Dices className="h-6 w-6 text-amber-400" />
                <h3 className="mt-4 font-display text-xl font-bold text-white">
                  Tryb losowych haseł
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Zaznacz dowolne kategorie z bazy ponad 230 haseł. System automatycznie przydzieli
                  każdemu aktywnemu graczowi niepowtarzalne hasło na czoło, a w trakcie rundy
                  możesz jednym kliknięciem wylosować graczowi nowe.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#161A22] p-7">
                <Pencil className="h-6 w-6 text-amber-400" />
                <h3 className="mt-4 font-display text-xl font-bold text-white">
                  Tryb wpisywania haseł graczom
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Przed startem rundy (lub w dowolnym momencie gry) wybierz konkretnego gracza z
                  listy i wpisz własne, kreatywne hasło oraz opcjonalną kategorię. Idealne na
                  wewnętrzne żarty ze znajomymi i na streama.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Categories overview */}
        <section id="kategorie" className="border-t border-white/8 bg-[#12151C]">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
                  Wbudowane polskie kategorie
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Gotowe pakiety haseł dostępne od razu po stworzeniu pokoju
                </p>
              </div>
              <span className="inline-flex items-center gap-2 text-sm text-slate-300">
                <Users className="h-4 w-4 text-amber-400" />
                <span>
                  {WORD_CATEGORIES.reduce((acc, c) => acc + c.words.length, 0)} haseł w{' '}
                  {WORD_CATEGORIES.length} kategoriach
                </span>
              </span>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {WORD_CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  className="rounded-xl border border-white/8 bg-[#161A22] p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-display text-base font-bold text-white">{cat.name}</h3>
                    <span className="font-mono text-xs text-amber-400 tabular-nums shrink-0">
                      {cat.words.length} haseł
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                    {cat.description}
                  </p>
                  <p className="mt-3 text-xs text-slate-300">
                    {cat.words.slice(0, 4).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
