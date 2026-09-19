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

const TRACKS = {
  menu: "assets/audio/menu.mp3",
  day: "assets/audio/level-day.mp3",
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.buffers = new Map();
    this.tracks = new Map();
    this.trackSrc = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.unlocked = false;
    this.musicVol = 0.55;
    this.sfxVol = 0.85;
    this.theme = "menu";
    this.musicOn = false;
    this.usingTrack = false;
  }

  async unlock() {
    if (this.unlocked) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
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
    await Promise.all([
      ...Object.entries(SFX).map(([key, url]) => this.loadBuffer(this.buffers, key, url)),
      this.loadBuffer(this.tracks, "menu", TRACKS.menu),
    ]);
    this.loadBuffer(this.tracks, "day", TRACKS.day);
  }

  async loadBuffer(map, key, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      map.set(key, await this.ctx.decodeAudioData(arr));
    } catch {
      /* missing clip is non-fatal */
    }
  }

  setMusic(v) {
    this.musicVol = v;
    if (this.musicGain) this.musicGain.gain.value = this.musicOn ? v : 0;
  }

  setSfx(v) {
    this.sfxVol = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  play(name, { volume = 1, playbackRate = 1 } = {}) {
    if (!this.unlocked || !this.ctx) return;
    const buf = this.buffers.get(name);
    if (!buf) return;
    try {
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = playbackRate;
      g.gain.value = volume;
      src.connect(g);
      g.connect(this.sfxGain);
      src.start();
    } catch {
      /* ignore play races */
    }
  }

  beep(freq, dur = 0.12, type = "square", vol = 0.08) {
    if (!this.unlocked || !this.ctx) return;
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

  stopTrack() {
    if (this.trackSrc) {
      try { this.trackSrc.stop(); } catch { /* already stopped */ }
      this.trackSrc = null;
    }
    this.usingTrack = false;
  }

  playTrack(name) {
    const buf = this.tracks.get(name);
    if (!buf || !this.ctx) return false;
    this.stopTrack();
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.trackSrc = src;
    this.usingTrack = true;
    src.onended = () => {
      if (this.trackSrc === src) this.trackSrc = null;
    };
    return true;
  }

  startMusic(theme = "day") {
    this.theme = theme;
    this.stopMusic();
    this.musicOn = true;
    if (!this.unlocked) return;
    if (this.musicGain) this.musicGain.gain.value = this.musicVol;

    if (theme === "menu" || theme === "credits" || theme === "levels") {
      if (this.playTrack("menu")) return;
    }
    if (["day", "village", "forest", "hamlet"].includes(theme)) {
      if (this.playTrack("day")) return;
    }

    const moods = {
      day: [262, 330, 392, 523, 392, 330],
      village: [294, 349, 440, 349, 392, 294],
      canyon: [196, 247, 294, 392, 294, 247],
      rain: [220, 262, 330, 262, 196, 165],
      forest: [196, 247, 294, 247, 330, 392],
      hamlet: [262, 311, 392, 466, 392, 311],
      sky: [330, 392, 494, 587, 494, 392],
      citadel: [175, 220, 262, 330, 392, 330],
      menu: [330, 392, 494, 392, 330, 262],
    };
    const notes = moods[theme] || moods.day;
    const tick = () => {
      if (!this.musicOn || this.usingTrack) return;
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
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    }
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }

  resumeMusic() {
    this.musicOn = true;
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(this.musicVol, this.ctx.currentTime, 0.08);
    }
    if (!this.usingTrack) this.startMusic(this.theme);
  }

  stopMusic() {
    this.musicOn = false;
    this.stopTrack();
    if (this.musicTimer) clearTimeout(this.musicTimer);
    this.musicTimer = null;
  }
}
