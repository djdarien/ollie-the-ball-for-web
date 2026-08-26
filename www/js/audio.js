const SFX = {
  coin: "assets/audio/coin.wav",
  jump: "assets/audio/jump.wav",
  hit: "assets/audio/hit.wav",
  destroy: "assets/audio/destroy.wav",
  won: "assets/audio/won.wav",
  gameover: "assets/audio/gameover.mp3",
  jumpBooster: "assets/audio/jump-booster.wav",
  speedBooster: "assets/audio/speed-booster.wav",
  teleporter: "assets/audio/teleporter.wav",
  select: "assets/audio/select.wav",
  selectDown: "assets/audio/select-down.wav",
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.buffers = new Map();
    this.musicTimer = null;
    this.musicStep = 0;
    this.unlocked = false;
    this.musicVol = 0.55;
    this.sfxVol = 0.85;
    this.theme = "day";
    this.musicOn = false;
  }

  async unlock() {
    if (this.unlocked) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol;
    this.sfxGain.gain.value = this.sfxVol;
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.ctx.resume().catch(() => {});
    this.unlocked = true;
    Object.entries(SFX).forEach(async ([key, url]) => {
      try {
        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        this.buffers.set(key, await this.ctx.decodeAudioData(arr));
      } catch {
        /* missing clip is non-fatal */
      }
    });
  }

  setMusic(v) {
    this.musicVol = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  setSfx(v) {
    this.sfxVol = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  play(name, { volume = 1, playbackRate = 1 } = {}) {
    if (!this.unlocked) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;
    g.gain.value = volume;
    src.connect(g);
    g.connect(this.sfxGain);
    src.start();
  }

  beep(freq, dur = 0.12, type = "square", vol = 0.08) {
    if (!this.unlocked) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.musicGain);
    o.start();
    o.stop(this.ctx.currentTime + dur);
  }

  startMusic(theme = "day") {
    this.theme = theme;
    this.stopMusic();
    this.musicOn = true;
    if (!this.unlocked) return;
    const moods = {
      day: [262, 330, 392, 523, 392, 330],
      village: [294, 349, 440, 349, 392, 294],
      canyon: [196, 247, 294, 392, 294, 247],
      rain: [220, 262, 330, 262, 196, 165],
      forest: [196, 247, 294, 247, 330, 392],
      hamlet: [262, 311, 392, 466, 392, 311],
      sky: [330, 392, 494, 587, 494, 392],
      citadel: [175, 220, 262, 330, 392, 330],
    };
    const notes = moods[theme] || moods.day;
    const tick = () => {
      if (!this.musicOn) return;
      const n = notes[this.musicStep % notes.length];
      this.beep(n, 0.22, this.musicStep % 2 ? "triangle" : "square", 0.05);
      if (this.musicStep % 4 === 0) this.beep(n / 2, 0.35, "sine", 0.04);
      this.musicStep++;
      this.musicTimer = setTimeout(tick, 320);
    };
    tick();
  }

  pauseMusic() {
    this.musicOn = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  resumeMusic() {
    if (this.musicOn) return;
    this.startMusic(this.theme);
  }

  stopMusic() {
    this.musicOn = false;
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
}
