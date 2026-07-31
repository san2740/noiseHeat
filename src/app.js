import { AudioMeter } from "./audio-meter.js";
import { SourceEstimator } from "./source-estimator.js";
import { WebGLOverlay } from "./webgl-overlay.js";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const flipButton = document.querySelector("#flipButton");
const startPanel = document.querySelector("#startPanel");
const levelText = document.querySelector("#levelText");
const meterFill = document.querySelector("#meterFill");
const status = document.querySelector("#status");
const confidenceText = document.querySelector("#confidenceText");
const directionText = document.querySelector("#directionText");
const errorBox = document.querySelector("#errorBox");

let stream = null;
let meter = null;
let estimator = null;
let estimatorFrameId = 0;
let facingMode = "environment";

let latestAudio = {
  level: 0,
  balance: 0,
  stereoConfidence: 0,
  reportedChannelCount: 1
};

const overlay = new WebGLOverlay(canvas);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setError(message) {
  errorBox.textContent = message;
}

function stopEstimator() {
  cancelAnimationFrame(estimatorFrameId);
  estimatorFrameId = 0;
  estimator = null;
}

function describeDirection(balance, confidence) {
  if (confidence < 0.18) return "방향 정보 없음";
  if (balance < -0.14) return "왼쪽 추정";
  if (balance > 0.14) return "오른쪽 추정";
  return "정면 추정";
}

function startEstimator() {
  stopEstimator();
  estimator = new SourceEstimator(video);

  const tick = now => {
    if (!estimator) return;

    const motion = estimator.estimate(latestAudio.level, now);
    const stereoUsable = latestAudio.stereoConfidence >= 0.18;
    const motionUsable = motion.confidence >= 0.18;

    let x = window.innerWidth * 0.5;
    let y = window.innerHeight * 0.5;
    let confidence = 0.05;
    let sourceLabel = "위치 불명";

    if (stereoUsable) {
      // 좌우 음향 정보는 X축에 반영합니다. 과도한 끝단 이동을 막기 위해 12~88%로 제한합니다.
      const audioX = window.innerWidth * (0.5 + latestAudio.balance * 0.38);
      x = clamp(audioX, window.innerWidth * 0.12, window.innerWidth * 0.88);

      // Y축은 음향 2채널만으로 알 수 없으므로 움직임이 있으면 그 값을 사용합니다.
      y = motionUsable ? motion.y : window.innerHeight * 0.5;

      confidence = clamp(
        latestAudio.stereoConfidence * 0.72 +
        (motionUsable ? motion.confidence * 0.28 : 0),
        0,
        1
      );
      sourceLabel = motionUsable ? "오디오 좌우 + 영상 높이" : "오디오 좌우 추정";
    } else if (motionUsable) {
      x = motion.x;
      y = motion.y;
      confidence = motion.confidence * 0.72;
      sourceLabel = "영상 움직임 추정";
    }

    overlay.setSourcePosition(x, y, confidence);

    confidenceText.textContent =
      confidence >= 0.55 ? `${sourceLabel} · 신뢰 높음` :
      confidence >= 0.25 ? `${sourceLabel} · 신뢰 보통` :
      `${sourceLabel} · 신뢰 낮음`;

    directionText.textContent = describeDirection(
      latestAudio.balance,
      latestAudio.stereoConfidence
    );

    estimatorFrameId = requestAnimationFrame(tick);
  };

  estimatorFrameId = requestAnimationFrame(tick);
}

async function stopStream() {
  stopEstimator();

  await meter?.stop();
  meter = null;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;

  latestAudio = {
    level: 0,
    balance: 0,
    stereoConfidence: 0,
    reportedChannelCount: 1
  };
  overlay.setNoise(0);
}

async function startMedia() {
  setError("");

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "카메라 API를 사용할 수 없습니다.\nHTTPS 주소 또는 localhost에서 실행해 주세요."
    );
  }

  await stopStream();

  stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: {
      channelCount: { ideal: 2 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  video.srcObject = stream;
  await video.play();

  meter = new AudioMeter(stream, sample => {
    latestAudio = sample;
    overlay.setNoise(sample.level);

    const percent = Math.round(sample.level * 100);
    levelText.textContent = `소음 강도 ${percent}%`;
    meterFill.style.width = `${percent}%`;
    status.textContent =
      percent < 25 ? "조용함" :
      percent < 60 ? "보통" : "시끄러움";
  });

  await meter.start();
  startEstimator();

  startPanel.classList.add("started");
  flipButton.hidden = false;
}

startButton.addEventListener("click", async () => {
  try {
    await startMedia();
  } catch (error) {
    console.error(error);
    setError(
      `${error.name || "Error"}: ${error.message}\n` +
      "브라우저 설정에서 카메라·마이크 권한을 확인해 주세요."
    );
  }
});

flipButton.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";

  try {
    await startMedia();
  } catch (error) {
    setError(`카메라 전환 실패: ${error.message}`);
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    await meter?.context?.suspend();
  } else if (meter?.context?.state === "suspended") {
    await meter.context.resume();
  }
});

if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
