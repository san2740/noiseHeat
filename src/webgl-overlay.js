const vertexShaderSource = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 uResolution;
uniform vec2 uSourcePosition;
uniform float uNoise;
uniform float uConfidence;
uniform float uTime;
uniform float uContourCount;
uniform float uContourStrength;

vec3 noiseColor(float t) {
  vec3 blue   = vec3(0.02, 0.10, 1.00);
  vec3 cyan   = vec3(0.00, 0.85, 1.00);
  vec3 green  = vec3(0.00, 0.85, 0.20);
  vec3 yellow = vec3(1.00, 0.95, 0.00);
  vec3 orange = vec3(1.00, 0.42, 0.00);
  vec3 red    = vec3(1.00, 0.00, 0.00);

  if (t < 0.15) {
    return mix(blue, cyan, t / 0.15);
  }
  if (t < 0.35) {
    return mix(cyan, green, (t - 0.15) / 0.20);
  }
  if (t < 0.60) {
    return mix(green, yellow, (t - 0.35) / 0.25);
  }
  if (t < 0.80) {
    return mix(yellow, orange, (t - 0.60) / 0.20);
  }
  return mix(orange, red, (t - 0.80) / 0.20);
}

void main() {
  // gl_FragCoord는 왼쪽 아래 원점, JS 좌표는 왼쪽 위 원점입니다.
  vec2 sourcePixel = vec2(
    uSourcePosition.x,
    uResolution.y - uSourcePosition.y
  );

  float distPx = distance(gl_FragCoord.xy, sourcePixel);

  // 소리가 커지면 반경도 커집니다.
  float radius = mix(58.0, 285.0, pow(uNoise, 0.72));
  float pulseSpeed = 2.0 + uNoise * 6.0;
  float pulse = 0.95 + 0.05 * sin(uTime * pulseSpeed);
  radius *= pulse;

  float normalizedDistance = distPx / max(radius, 1.0);
  float radial = 1.0 - smoothstep(0.0, 1.0, normalizedDistance);
  float mask = 1.0 - smoothstep(0.84, 1.0, normalizedDistance);

  // 중심은 현재 소리값에 가깝고 바깥으로 갈수록 파란색으로 낮아집니다.
  float localNoise = clamp(pow(uNoise, 0.72) * pow(radial, 0.72), 0.0, 1.0);
  vec3 color = noiseColor(localNoise);

  // 중심부가 영상 위에서 조금 더 또렷하게 보이도록 밝기를 보정합니다.
  color *= 0.82 + radial * 0.32;

  if (uContourCount > 0.0 && uContourStrength > 0.0) {
    float iso = localNoise * uContourCount;
    float phase = fract(iso);
    float edgeDistance = min(phase, 1.0 - phase);
    // WebGL 1에서는 fwidth()가 기본 지원되지 않는 기기가 있으므로
    // 고정 폭을 사용합니다. 등고선 개수와 무관하게 안정적으로 컴파일됩니다.
    float width = 0.055;
    float contour = 1.0 - smoothstep(0.0, width, edgeDistance);
    vec3 contourColor = vec3(0.03, 0.03, 0.05);
    color = mix(color, contourColor, contour * uContourStrength);
  }

  // 위치 신뢰도가 낮아도 완전히 사라지지는 않되 훨씬 희미하게 표현합니다.
  float confidenceAlpha = mix(0.28, 1.0, uConfidence);
  float noiseAlpha = smoothstep(0.004, 0.12, uNoise);
  float alpha = mask * (0.12 + 0.66 * radial) * noiseAlpha * confidenceAlpha;

  gl_FragColor = vec4(color, alpha);
}
`;

export class WebGLOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true
    });

    if (!this.gl) throw new Error("WebGL을 사용할 수 없습니다.");

    this.noise = 0;
    this.displayedNoise = 0;
    this.confidence = 0;
    this.displayedConfidence = 0;
    this.sourceX = window.innerWidth * 0.5;
    this.sourceY = window.innerHeight * 0.5;
    this.displayedX = this.sourceX;
    this.displayedY = this.sourceY;
    this.startTime = performance.now();

    this.program = this.createProgram(vertexShaderSource, fragmentShaderSource);

    this.positionLocation = this.gl.getAttribLocation(this.program, "aPosition");
    this.noiseLocation = this.gl.getUniformLocation(this.program, "uNoise");
    this.confidenceLocation = this.gl.getUniformLocation(this.program, "uConfidence");
    this.timeLocation = this.gl.getUniformLocation(this.program, "uTime");
    this.resolutionLocation = this.gl.getUniformLocation(this.program, "uResolution");
    this.sourcePositionLocation = this.gl.getUniformLocation(this.program, "uSourcePosition");
    this.contourCountLocation = this.gl.getUniformLocation(this.program, "uContourCount");
    this.contourStrengthLocation = this.gl.getUniformLocation(this.program, "uContourStrength");

    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);

    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    window.addEventListener("resize", this.resize);
    this.resize();
    requestAnimationFrame(this.render);
  }

  setNoise(value) {
    this.noise = Math.min(1, Math.max(0, value));
  }

  setSourcePosition(x, y, confidence = 1) {
    this.sourceX = Math.min(window.innerWidth, Math.max(0, x));
    this.sourceY = Math.min(window.innerHeight, Math.max(0, y));
    this.confidence = Math.min(1, Math.max(0, confidence));
  }

  resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  };

  render = now => {
    this.displayedNoise += (this.noise - this.displayedNoise) * 0.12;
    this.displayedConfidence += (this.confidence - this.displayedConfidence) * 0.10;
    this.displayedX += (this.sourceX - this.displayedX) * 0.18;
    this.displayedY += (this.sourceY - this.displayedY) * 0.18;

    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(this.noiseLocation, this.displayedNoise);
    gl.uniform1f(this.confidenceLocation, this.displayedConfidence);
    gl.uniform1f(this.timeLocation, (now - this.startTime) / 1000);
    gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
    gl.uniform2f(
      this.sourcePositionLocation,
      this.displayedX * dpr,
      this.displayedY * dpr
    );
    gl.uniform1f(this.contourCountLocation, 8.0);
    gl.uniform1f(this.contourStrengthLocation, 0.16);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(this.render);
  };

  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader);
      this.gl.deleteShader(shader);
      throw new Error(`셰이더 컴파일 실패: ${message}`);
    }
    return shader;
  }

  createProgram(vertexSource, fragmentSource) {
    const vertex = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragment = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();

    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);

    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const message = this.gl.getProgramInfoLog(program);
      this.gl.deleteProgram(program);
      throw new Error(`WebGL 프로그램 연결 실패: ${message}`);
    }

    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);
    return program;
  }
}
