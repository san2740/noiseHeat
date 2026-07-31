import { AudioMeter } from "./audio-meter.js";
import { WebGLOverlay } from "./webgl-overlay.js";

const video = document.querySelector("#camera");
const canvas = document.querySelector("#overlay");
const startButton = document.querySelector("#startButton");
const flipButton = document.querySelector("#flipButton");
const startPanel = document.querySelector("#startPanel");
const levelText = document.querySelector("#levelText");
const meterFill = document.querySelector("#meterFill");
const status = document.querySelector("#status");
const errorBox = document.querySelector("#errorBox");

let stream = null;
let meter = null;
let facingMode = "environment";
const overlay = new WebGLOverlay(canvas);

function setError(message) {
  errorBox.textContent = message;
}

function updateOverlayPositionFromEvent(event) {
  const point = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
  overlay.setSourcePosition(point.clientX, point.clientY);
}

async function stopStream() {
  await meter?.stop();
  meter = null;
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
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
    levelText.textContent = \`소음 강도 \${percent}%\`;
    meterFill.style.width = \`\${percent}%\`;
    status.textContent =
      percent < 25 ? "조용함" :
      percent < 60 ? "보통" : "시끄러움";
  });

  await meter.start();
  startPanel.classList.add("started");
  flipButton.hidden = false;
}

startButton.addEventListener("click", async () => {
  try {
    await startMedia();
  } catch (error) {
    console.error(error);
    setError(
      \`\${error.name || "Error"}: \${error.message}\n\` +
      "브라우저 설정에서 카메라·마이크 권한을 확인해 주세요."
    );
  }
});

flipButton.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  try {
    await startMedia();
  } catch (error) {
    setError(\`카메라 전환 실패: \${error.message}\`);
  }
});

document.addEventListener("pointerdown", updateOverlayPositionFromEvent);
document.addEventListener("pointermove", event => {
  if (event.buttons === 1) {
    updateOverlayPositionFromEvent(event);
  }
});

document.addEventListener("touchstart", updateOverlayPositionFromEvent, { passive: true });
document.addEventListener("touchmove", updateOverlayPositionFromEvent, { passive: true });

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
