/**
 * 카메라 프레임의 국소 움직임을 이용해 "소리가 났을 가능성이 있는 화면 위치"를 추정합니다.
 * 실제 음향 방향 측정이 아니라 영상 움직임과 소리 발생 시점을 결합한 휴리스틱입니다.
 */
export class SourceEstimator {
  constructor(video, options = {}) {
    this.video = video;
    this.width = options.width ?? 160;
    this.height = options.height ?? 90;
    this.diffThreshold = options.diffThreshold ?? 20;
    this.minLevel = options.minLevel ?? 0.045;
    this.minMotion = options.minMotion ?? 900;
    this.maxGlobalMotionRatio = options.maxGlobalMotionRatio ?? 0.42;

    this.canvas = document.createElement("canvas");
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.ctx = this.canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true
    });

    if (!this.ctx) {
      throw new Error("위치 추정용 Canvas 2D를 사용할 수 없습니다.");
    }

    this.previousGray = null;
    this.lastX = window.innerWidth * 0.5;
    this.lastY = window.innerHeight * 0.5;
    this.confidence = 0;
    this.lastEstimateAt = 0;
    this.intervalMs = 1000 / 15;
  }

  reset() {
    this.previousGray = null;
    this.lastX = window.innerWidth * 0.5;
    this.lastY = window.innerHeight * 0.5;
    this.confidence = 0;
    this.lastEstimateAt = 0;
  }

  estimate(level, now = performance.now()) {
    if (now - this.lastEstimateAt < this.intervalMs) {
      return this.currentResult();
    }
    this.lastEstimateAt = now;

    if (
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !this.video.videoWidth ||
      !this.video.videoHeight
    ) {
      return this.currentResult(0);
    }

    this.ctx.drawImage(this.video, 0, 0, this.width, this.height);
    const rgba = this.ctx.getImageData(0, 0, this.width, this.height).data;
    const gray = new Uint8Array(this.width * this.height);

    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      gray[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    }

    if (!this.previousGray) {
      this.previousGray = gray;
      return this.currentResult(0);
    }

    let weightSum = 0;
    let weightedX = 0;
    let weightedY = 0;
    let activePixels = 0;
    let totalDiff = 0;

    // 가장자리 2픽셀은 카메라 리사이즈/보간 노이즈를 줄이기 위해 제외합니다.
    for (let y = 2; y < this.height - 2; y++) {
      for (let x = 2; x < this.width - 2; x++) {
        const index = y * this.width + x;
        const diff = Math.abs(gray[index] - this.previousGray[index]);
        totalDiff += diff;

        if (diff <= this.diffThreshold) continue;

        // 작은 변화는 약하게, 큰 변화는 강하게 반영합니다.
        const weight = diff - this.diffThreshold;
        weightSum += weight;
        weightedX += x * weight;
        weightedY += y * weight;
        activePixels++;
      }
    }

    this.previousGray = gray;

    const validPixelCount = (this.width - 4) * (this.height - 4);
    const activeRatio = activePixels / validPixelCount;
    const averageDiff = totalDiff / validPixelCount;

    // 카메라 전체가 흔들리거나 이동하면 특정 음원 위치라고 보기 어렵습니다.
    const looksGlobal =
      activeRatio > this.maxGlobalMotionRatio ||
      averageDiff > 24;

    if (
      level < this.minLevel ||
      weightSum < this.minMotion ||
      looksGlobal
    ) {
      this.confidence *= 0.86;
      return this.currentResult(this.confidence);
    }

    const frameX = weightedX / weightSum;
    const frameY = weightedY / weightSum;
    const screenPoint = this.frameToScreen(frameX, frameY);

    // 소리가 클수록 새 위치를 조금 빠르게 따라갑니다.
    const follow = 0.16 + level * 0.24;
    this.lastX += (screenPoint.x - this.lastX) * follow;
    this.lastY += (screenPoint.y - this.lastY) * follow;

    const motionConfidence = Math.min(1, weightSum / 16000);
    const localization = Math.max(0, 1 - activeRatio / this.maxGlobalMotionRatio);
    const nextConfidence = motionConfidence * localization * Math.min(1, level * 2.4);
    this.confidence += (nextConfidence - this.confidence) * 0.35;

    return this.currentResult(this.confidence);
  }

  /**
   * 분석 캔버스 좌표를 object-fit: cover가 적용된 화면 좌표로 변환합니다.
   */
  frameToScreen(frameX, frameY) {
    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const videoWidth = this.video.videoWidth;
    const videoHeight = this.video.videoHeight;

    const scale = Math.max(screenWidth / videoWidth, screenHeight / videoHeight);
    const renderedWidth = videoWidth * scale;
    const renderedHeight = videoHeight * scale;
    const cropX = (renderedWidth - screenWidth) * 0.5;
    const cropY = (renderedHeight - screenHeight) * 0.5;

    const videoX = (frameX / this.width) * videoWidth;
    const videoY = (frameY / this.height) * videoHeight;

    return {
      x: Math.min(screenWidth, Math.max(0, videoX * scale - cropX)),
      y: Math.min(screenHeight, Math.max(0, videoY * scale - cropY))
    };
  }

  currentResult(confidence = this.confidence) {
    return {
      x: this.lastX,
      y: this.lastY,
      confidence: Math.min(1, Math.max(0, confidence))
    };
  }
}
