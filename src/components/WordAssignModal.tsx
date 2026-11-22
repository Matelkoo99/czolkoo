import { useEffect, useState } from 'react';
import { Dices, Send, X } from 'lucide-react';
import type { RoomPlayerView } from '../shared/types.ts';
import { WORD_CATEGORIES, pickRandomWord } from '../shared/words.ts';

interface WordAssignModalProps {
  open: boolean;
  players: RoomPlayerView[];
  myPlayerId: string;
  initialTargetId: string | null;
  selectedCategories: string[];
  onClose: () => void;
  onSubmit: (targetPlayerId: string, word: string, category: string) => void;
}

export function WordAssignModal({
  open,
  players,
  myPlayerId,
  initialTargetId,
  selectedCategories,
  onClose,
  onSubmit,
}: WordAssignModalProps) {
  const eligibleTargets = players.filter((p) => p.id !== myPlayerId && p.isPlaying);
  const [targetId, setTargetId] = useState<string>(initialTargetId || eligibleTargets[0]?.id || '');
  const [word, setWord] = useState('');
  const [category, setCategory] = useState('Własne hasło');

  useEffect(() => {
    if (!open) return;
    const nextTarget =
      initialTargetId && eligibleTargets.some((p) => p.id === initialTargetId)
        ? initialTargetId
        : eligibleTargets[0]?.id || '';
    setTargetId(nextTarget);
    setWord('');
    setCategory('Własne hasło');
  }, [open, initialTargetId]);

  if (!open) return null;

  const handleRandomFill = (catId?: string) => {
    const picked = pickRandomWord(catId ? [catId] : selectedCategories);
    setWord(picked.word);
    setCategory(picked.categoryName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || !word.trim()) return;
    onSubmit(targetId, word.trim(), category.trim() || 'Własne hasło');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Wpisz hasło graczowi"
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#181C24] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-white">
              Wpisz hasło na czoło gracza
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Wybrany gracz nie zobaczy swojego hasła — pojawi się ono tylko u pozostałych osób.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {eligibleTargets.length === 0 ? (
          <div className="mt-6 rounded-xl border border-white/10 bg-[#12161E] p-5 text-sm text-slate-300">
            Nie ma innych aktywnych graczy w pokoju, którym mógłbyś wpisać hasło. Zaproś znajomych
            linkiem pokoju!
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {/* Target player selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-2">
                Dla którego gracza wpisujesz hasło?
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {eligibleTargets.map((p) => {
                  const selected = p.id === targetId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setTargetId(p.id)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors cursor-pointer ${
                        selected
                          ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                          : 'border-white/10 bg-[#12161E] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: p.avatarColor }}
                      />
                      <span className="truncate">{p.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Word input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="custom-word-input" className="text-xs font-semibold text-slate-300">
                  Hasło na czoło
                </label>
                <button
                  type="button"
                  onClick={() => handleRandomFill()}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
                >
                  <Dices className="h-3.5 w-3.5" />
                  Podpowiedz losowe
                </button>
              </div>
              <input
                id="custom-word-input"
                type="text"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                maxLength={48}
                placeholder="np. Robert Makłowicz, Shrek, Kapibara..."
                autoFocus
                className="w-full rounded-lg border border-white/15 bg-[#10131A] px-3.5 py-2.5 text-base font-semibold text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>

            {/* Optional category / hint */}
            <div>
              <label htmlFor="custom-cat-input" className="block text-xs font-semibold text-slate-300 mb-1.5">
                Kategoria / podpowiedź (opcjonalnie)
              </label>
              <input
                id="custom-cat-input"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                maxLength={32}
                placeholder="np. Polski YouTuber, Postać z bajki..."
                className="w-full rounded-lg border border-white/15 bg-[#10131A] px-3.5 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WORD_CATEGORIES.slice(0, 4).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleRandomFill(cat.id)}
                    className="rounded-md border border-white/10 bg-[#12161E] px-2.5 py-1 text-xs text-slate-300 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer"
                  >
                    Losuj: {cat.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 transition-colors cursor-pointer whitespace-nowrap"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={!targetId || !word.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Send className="h-4 w-4" />
                Przyklej na czoło
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
