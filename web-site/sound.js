// Wooden move sounds synthesised with Web Audio (no audio files to download).
export class Sound {
  constructor() { this.ctx = null; this.enabled = true; this.noise = null; }
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = Math.floor(this.ctx.sampleRate * 0.25);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  knock(t, { freq = 1700, q = 6, gain = 0.9, dur = 0.07, body = 190 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp).connect(g).connect(c.destination); src.start(t); src.stop(t + dur + 0.02);
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(body, t); o.frequency.exponentialRampToValueAtTime(body * 0.6, t + 0.08);
    const og = c.createGain(); og.gain.setValueAtTime(gain * 0.55, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(og).connect(c.destination); o.start(t); o.stop(t + 0.1);
  }
  tone(t, f, dur, gain = 0.18, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = f;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  play(kind) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + 0.005;
    switch (kind) {
      case 'move': this.knock(t); break;
      case 'capture': this.knock(t, { freq: 1300, gain: 1.2, dur: 0.09, body: 150 }); this.knock(t + 0.045, { freq: 2100, gain: 0.5, dur: 0.05 }); break;
      case 'castle': this.knock(t); this.knock(t + 0.11, { freq: 1500 }); break;
      case 'check': this.knock(t, { gain: 0.8 }); this.tone(t + 0.02, 880, 0.16, 0.12, 'triangle'); this.tone(t + 0.12, 1175, 0.22, 0.1, 'triangle'); break;
      case 'promote': this.knock(t); this.tone(t + 0.03, 660, 0.15, 0.1); this.tone(t + 0.1, 990, 0.25, 0.1); break;
      case 'illegal': this.tone(t, 180, 0.12, 0.12, 'square'); break;
      case 'start': this.tone(t, 523, 0.18, 0.08); this.tone(t + 0.09, 784, 0.3, 0.08); break;
      case 'rankup': [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.09, f, 0.32 + i * 0.08, 0.09, 'triangle')); this.tone(t + 0.36, 1319, 0.7, 0.06); break; // v1.9 promotion
      case 'end': this.tone(t, 523, 0.5, 0.1); this.tone(t + 0.12, 659, 0.5, 0.09); this.tone(t + 0.24, 784, 0.7, 0.09); break;
    }
  }
}
