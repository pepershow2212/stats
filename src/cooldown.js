export class Cooldown {
  constructor(ms = 60_000, now = Date.now) {
    this.ms = ms;
    this.now = now;
    this.used = new Map();
  }

  remaining(id) {
    const last = this.used.get(String(id)) || 0;
    return Math.max(0, last + this.ms - this.now());
  }

  hit(id) {
    this.used.set(String(id), this.now());
  }
}
