const TRACK_URL = '/assets/chronicle/music/enchanted-festival-loop.mp3';
const LOOP_START_SECONDS = 1;
const LOOP_LENGTH_SECONDS = 102.524_263;
const VOLUME = 0.26;
const FADE_SECONDS = 1.4;

export class ChronicleMusic {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private playing = false;

  public get isPlaying(): boolean {
    return this.playing;
  }

  public async play(): Promise<void> {
    this.playing = true;
    if (!this.context) await this.load();
    if (!this.playing || !this.context || !this.gain) return;
    await this.context.resume();
    this.rampTo(VOLUME);
  }

  public pause(): void {
    this.playing = false;
    if (!this.context) return;
    this.rampTo(0);
    const context = this.context;
    globalThis.setTimeout(() => {
      if (!this.playing && context.state === 'running') void context.suspend();
    }, FADE_SECONDS * 1000);
  }

  public suspendWhileHidden(hidden: boolean): void {
    if (!this.context || !this.playing) return;
    void (hidden ? this.context.suspend() : this.context.resume());
  }

  public destroy(): void {
    this.playing = false;
    this.source?.stop();
    void this.context?.close();
    this.context = null;
  }

  private async load(): Promise<void> {
    const context = new AudioContext();
    this.context = context;
    const response = await fetch(TRACK_URL);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    this.gain = context.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(context.destination);
    this.source = context.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.source.loopStart = LOOP_START_SECONDS;
    this.source.loopEnd = LOOP_START_SECONDS + LOOP_LENGTH_SECONDS;
    this.source.connect(this.gain);
    this.source.start(0, LOOP_START_SECONDS);
  }

  private rampTo(volume: number): void {
    if (!this.context || !this.gain) return;
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now);
    this.gain.gain.linearRampToValueAtTime(volume, now + FADE_SECONDS);
  }
}
