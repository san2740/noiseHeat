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
const errorBox = document.querySelector("#errorBox");

let stream = null;
let meter = null;
let estimator = null;
let estimatorFrameId = 0;
let latestLevel = 0;
let facingMode = "environment";

const overlay = new WebGLOverlay(canvas);

function setError(message) {
  errorBox.textContent = message;
}

function stopEstimator() {
  cancelAnimationFrame(estimatorFrameId);
  estimatorFrameId = 0;
  estimator = null;
}

function startEstimator() {
  stopEstimator();
  estimator = new SourceEstimator(video);

  const tick = now => {
    if (!estimator) return;

    const position = estimator.estimate(latestLevel, now);
    overlay.setSourcePosition(
      position.x,
      position.y,
      position.confidence
    );

    confidenceText.textContent =
      position.confidence >= 0.55 ? "위치 추정 높음" :
      position.confidence >= 0.25 ? "위치 추정 보통" :
      "위치 추정 낮음";

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
  latestLevel = 0;
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
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  video.srcObject = stream;
  await video.play();

  meter = new AudioMeter(stream, level => {
    latestLevel = level;
    overlay.setNoise(level);

    const percent = Math.round(level * 100);
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

flipButton.addEventListener("click", async event => {
  event.stopPropagation();
  facingMode = facingMode === "environment" ? "user" : "environment";

  try {
    await startMedia();
  } catch (error) {
    setError(`카메라 전환 실패: ${error.message}`);
  }
});

// 자동 추정이 틀렸을 때 사용자가 화면을 누르면 즉시 해당 위치로 보정할 수 있습니다.
document.addEventListener("pointerdown", event => {
  if (!startPanel.classList.contains("started")) return;
  if (event.target.closest("button, .hud")) return;

  estimator.lastX = event.clientX;
  estimator.lastY = event.clientY;
  estimator.confidence = 1;
  overlay.setSourcePosition(event.clientX, event.clientY, 1);
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
