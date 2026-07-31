export class AudioMeter {
  constructor(stream, onSample) {
    this.stream = stream;
    this.onSample = onSample;

    this.context = null;
    this.source = null;
    this.splitter = null;
    this.monoAnalyser = null;
    this.leftAnalyser = null;
    this.rightAnalyser = null;

    this.monoBuffer = null;
    this.leftBuffer = null;
    this.rightBuffer = null;

    this.frameId = 0;
    this.smoothedLevel = 0;
    this.smoothedBalance = 0;
    this.smoothedStereoConfidence = 0;
    this.reportedChannelCount = 1;
  }

  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("이 브라우저는 Web Audio API를 지원하지 않습니다.");
    }

    this.context = new AudioContextClass({ latencyHint: "interactive" });
    await this.context.resume();

    this.source = this.context.createMediaStreamSource(this.stream);

    const audioTrack = this.stream.getAudioTracks()[0];
    this.reportedChannelCount = audioTrack?.getSettings?.().channelCount || 1;

    this.monoAnalyser = this.context.createAnalyser();
    this.monoAnalyser.fftSize = 2048;
    this.monoAnalyser.smoothingTimeConstant = 0;
    this.source.connect(this.monoAnalyser);
    this.monoBuffer = new Float32Array(this.monoAnalyser.fftSize);

    this.splitter = this.context.createChannelSplitter(2);
    this.leftAnalyser = this.context.createAnalyser();
    this.rightAnalyser = this.context.createAnalyser();
    this.leftAnalyser.fftSize = 1024;
    this.rightAnalyser.fftSize = 1024;
    this.leftAnalyser.smoothingTimeConstant = 0;
    this.rightAnalyser.smoothingTimeConstant = 0;

    this.source.connect(this.splitter);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);

    this.leftBuffer = new Float32Array(this.leftAnalyser.fftSize);
    this.rightBuffer = new Float32Array(this.rightAnalyser.fftSize);

    this.tick();
  }

  calculateRms(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = buffer[i];
      sum += sample * sample;
    }
    return Math.sqrt(sum / buffer.length);
  }

  calculateCorrelation(a, b) {
    let dot = 0;
    let energyA = 0;
    let energyB = 0;

    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      energyA += a[i] * a[i];
      energyB += b[i] * b[i];
    }

    const denominator = Math.sqrt(energyA * energyB) + 1e-12;
    return dot / denominator;
  }

  tick = () => {
    this.monoAnalyser.getFloatTimeDomainData(this.monoBuffer);
    this.leftAnalyser.getFloatTimeDomainData(this.leftBuffer);
    this.rightAnalyser.getFloatTimeDomainData(this.rightBuffer);

    const monoRms = this.calculateRms(this.monoBuffer);
    const dbfs = 20 * Math.log10(Math.max(monoRms, 1e-7));

    // -60 dBFS 이하 0, -10 dBFS 이상 1
    const rawLevel = Math.min(1, Math.max(0, (dbfs + 60) / 50));
    const levelFactor = rawLevel > this.smoothedLevel ? 0.35 : 0.08;
    this.smoothedLevel += (rawLevel - this.smoothedLevel) * levelFactor;

    const leftRms = this.calculateRms(this.leftBuffer);
    const rightRms = this.calculateRms(this.rightBuffer);
    const channelEnergy = leftRms + rightRms;
    const rawBalance = (rightRms - leftRms) / (channelEnergy + 1e-8);
    const correlation = this.calculateCorrelation(this.leftBuffer, this.rightBuffer);

    const levelEnough = this.smoothedLevel > 0.08;
    const bothChannelsAlive = Math.min(leftRms, rightRms) > 1e-5;
    const differenceEvidence = Math.min(1, Math.abs(rawBalance) / 0.18);
    const decorrelationEvidence = Math.min(1, Math.max(0, (0.9995 - correlation) / 0.08));
    const channelCountEvidence = this.reportedChannelCount >= 2 ? 1 : 0.35;

    let rawStereoConfidence = 0;
    if (levelEnough && bothChannelsAlive) {
      rawStereoConfidence = Math.max(differenceEvidence, decorrelationEvidence * 0.7);
      rawStereoConfidence *= channelCountEvidence;
    }

    this.smoothedBalance += (rawBalance - this.smoothedBalance) * 0.18;
    this.smoothedStereoConfidence +=
      (rawStereoConfidence - this.smoothedStereoConfidence) *
      (rawStereoConfidence > this.smoothedStereoConfidence ? 0.22 : 0.06);

    this.onSample({
      level: this.smoothedLevel,
      dbfs,
      balance: Math.min(1, Math.max(-1, this.smoothedBalance)),
      stereoConfidence: Math.min(1, Math.max(0, this.smoothedStereoConfidence)),
      leftRms,
      rightRms,
      correlation,
      reportedChannelCount: this.reportedChannelCount
    });

    this.frameId = requestAnimationFrame(this.tick);
  };

  async stop() {
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;

    try { this.source?.disconnect(); } catch {}
    try { this.splitter?.disconnect(); } catch {}
    try { this.monoAnalyser?.disconnect(); } catch {}
    try { this.leftAnalyser?.disconnect(); } catch {}
    try { this.rightAnalyser?.disconnect(); } catch {}

    await this.context?.close();
  }
}
