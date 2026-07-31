import { AudioMeter } from "./audio-meter.js";
import { WebGLOverlay } from "./webgl-overlay.js";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const flipButton = document.querySelector("#flipButton");
const startPanel = document.querySelector("#startPanel");
const positionGuide = document.querySelector("#positionGuide");
const levelText = document.querySelector("#levelText");
const meterFill = document.querySelector("#meterFill");
const status = document.querySelector("#status");
const errorBox = document.querySelector("#errorBox");

let stream = null;
let meter = null;
let facingMode = "environment";
let hasSelectedPosition = false;

const overlay = new WebGLOverlay(canvas);

function setError(message) {
  errorBox.textContent = message;
}

function setSourceFromPointer(event) {
  // HUD와 버튼 조작은 음원 위치 변경에서 제외합니다.
  if (event.target.closest(".hud, .start-panel")) return;

  overlay.setSourcePosition(event.clientX, event.clientY);
  hasSelectedPosition = true;
  positionGuide.classList.add("hidden");
}

async function stopStream() {
  await meter?.stop();
  meter = null;

  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
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
    overlay.setNoise(level);

    const percent = Math.round(level * 100);
    levelText.textContent = `소음 강도 ${percent}%`;
    meterFill.style.width = `${percent}%`;
    status.textContent =
      percent < 25 ? "조용함" :
      percent < 60 ? "보통" :
      "시끄러움";
  });

  await meter.start();
  startPanel.classList.add("started");
  flipButton.hidden = false;

  if (!hasSelectedPosition) {
    positionGuide.classList.remove("hidden");
  }
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
    console.error(error);
    setError(`카메라 전환 실패: ${error.message}`);
  }
});

// 화면을 누르거나 드래그한 위치를 음원 위치로 사용합니다.
document.addEventListener("pointerdown", setSourceFromPointer);
document.addEventListener("pointermove", event => {
  if (event.buttons === 1 || event.pointerType === "touch") {
    setSourceFromPointer(event);
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    await meter?.context?.suspend();
  } else if (meter?.context?.state === "suspended") {
    await meter.context.resume();
  }
});

window.addEventListener("beforeunload", () => {
  stream?.getTracks().forEach(track => track.stop());
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(console.error);
  });
}
