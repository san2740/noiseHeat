export class AudioMeter {
  constructor(stream, onLevel) {
    this.stream = stream;
    this.onLevel = onLevel;
    this.context = null;
    this.source = null;
    this.analyser = null;
    this.buffer = null;
    this.frameId = 0;
    this.smoothed = 0;
  }

  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("이 브라우저는 Web Audio API를 지원하지 않습니다.");
    }

    this.context = new AudioContextClass();
    await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;

    this.source.connect(this.analyser);
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.tick();
  }

  tick = () => {
    this.analyser.getFloatTimeDomainData(this.buffer);

    let sum = 0;
    for (const sample of this.buffer) sum += sample * sample;
    const rms = Math.sqrt(sum / this.buffer.length);
    const dbfs = 20 * Math.log10(Math.max(rms, 1e-7));

    // -60dBFS 이하 0, -10dBFS 이상 1
    const raw = Math.min(1, Math.max(0, (dbfs + 60) / 50));
    const factor = raw > this.smoothed ? 0.35 : 0.08;
    this.smoothed += (raw - this.smoothed) * factor;

    this.onLevel(this.smoothed, dbfs);
    this.frameId = requestAnimationFrame(this.tick);
  };

  async stop() {
    cancelAnimationFrame(this.frameId);
    this.source?.disconnect();
    await this.context?.close();
  }
}
