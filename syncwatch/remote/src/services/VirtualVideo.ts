/**
 * VirtualVideo - A mock for the HTMLVideoElement API
 * Used on the Web Remote to simulate a video playing.
 */
export class VirtualVideo {
  public currentTime: number = 0;
  public paused: boolean = true;
  public duration: number = 0;
  public playbackRate: number = 1.0;
  private lastTick: number = 0;
  private listeners: { [key: string]: Function[] } = {};

  constructor() {
    this.lastTick = performance.now();
    this.tick = this.tick.bind(this);
    requestAnimationFrame(this.tick);
  }

  private tick() {
    const now = performance.now();
    const delta = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (!this.paused) {
      this.currentTime += delta * this.playbackRate;
      if (this.duration > 0 && this.currentTime > this.duration) {
        this.currentTime = this.duration;
        this.pause();
      }
    }

    requestAnimationFrame(this.tick);
  }

  // --- API ---
  public play() {
    if (this.paused) {
      this.paused = false;
      this.emit('play');
    }
  }

  public pause() {
    if (!this.paused) {
      this.paused = true;
      this.emit('pause');
    }
  }

  public addEventListener(event: string, callback: Function) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  public removeEventListener(event: string, callback: Function) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  private emit(event: string) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb());
    }
  }
}
