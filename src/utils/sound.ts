// Web Audio API synthesized sound effects for Czółko game events

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private getContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.09,
    delay = 0,
  ) {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playCardDeal() {
    this.playTone(380, 0.09, 'triangle', 0.08, 0);
    this.playTone(540, 0.12, 'triangle', 0.08, 0.06);
  }

  public playTurnSwitch() {
    this.playTone(520, 0.08, 'sine', 0.07, 0);
    this.playTone(660, 0.11, 'sine', 0.07, 0.07);
  }

  public playSolved() {
    this.playTone(523.25, 0.14, 'triangle', 0.1, 0);
    this.playTone(659.25, 0.14, 'triangle', 0.1, 0.09);
    this.playTone(783.99, 0.18, 'triangle', 0.11, 0.18);
    this.playTone(1046.5, 0.34, 'sine', 0.1, 0.28);
  }

  public playReaction(kind: 'TAK' | 'NIE' | 'BLISKO' | 'NIE_WIEM') {
    if (kind === 'TAK') {
      this.playTone(620, 0.09, 'sine', 0.06, 0);
      this.playTone(840, 0.12, 'sine', 0.06, 0.05);
    } else if (kind === 'NIE') {
      this.playTone(300, 0.1, 'sawtooth', 0.04, 0);
      this.playTone(230, 0.14, 'sawtooth', 0.04, 0.06);
    } else if (kind === 'BLISKO') {
      this.playTone(500, 0.09, 'triangle', 0.07, 0);
      this.playTone(580, 0.09, 'triangle', 0.07, 0.07);
    } else {
      this.playTone(420, 0.1, 'sine', 0.05, 0);
    }
  }

  public playTimerTick() {
    this.playTone(780, 0.045, 'square', 0.03, 0);
  }

  public playTimerEnd() {
    this.playTone(260, 0.2, 'sawtooth', 0.06, 0);
    this.playTone(210, 0.32, 'sawtooth', 0.06, 0.18);
  }
}

export const soundEngine = new SoundEngine();
