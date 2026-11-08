import { Music } from './music';
import { SOUNDS, type SoundId, type SoundCtx } from './sounds';

/**
 * Moteur audio : AudioContext créé au premier geste utilisateur (politique d'autoplay),
 * sons synthétisés à la volée (aucun fichier). Remplaçable par des samples : même interface `play`.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;
  private active = 0;
  /** Volumes réglables (0..1). */
  private sfxVolume = 0.8;
  private musicVolume = 0.4;
  private music = new Music(() => this.ctx, () => this.master);
  /** Exposé pour les tests navigateur. */
  get running(): boolean { return this.ctx?.state === 'running'; }

  /** À appeler depuis un geste utilisateur (clic, touche) pour (re)lancer l'audio. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        this.music.setVolume(this.musicVolume);
        // Bruit blanc partagé (1 s), généré une fois.
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        let seed = 1234567;
        for (let i = 0; i < len; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; d[i] = seed / 2147483648 - 1; }
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.music.setVolume(this.musicVolume));
    } catch { /* audio indisponible : le jeu continue en silence */ }
  }

  /** Volume des effets et de la musique (réglages). */
  setVolumes(sound: number, music: number): void {
    this.sfxVolume = sound;
    this.musicVolume = music;
    this.music.setVolume(music);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.6;
  }

  /** Joue un son ; `volume` ∈ [0,1] (atténuation par la distance à la caméra, taille de l'explosion…). */
  play(id: SoundId, volume = 1): void {
    const ctx = this.ctx, master = this.master, noise = this.noise;
    if (!ctx || !master || !noise || ctx.state !== 'running' || this.muted || volume * this.sfxVolume <= 0.01 || this.active > 24) return;
    const sc: SoundCtx = { ctx, out: master, noise, volume: volume * this.sfxVolume, t0: ctx.currentTime };
    this.active++;
    const dur = SOUNDS[id](sc);
    setTimeout(() => { this.active--; }, dur * 1000 + 50);
  }
}
