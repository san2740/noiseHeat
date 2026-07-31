const vertexShaderSource = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform vec2 uResolution;
uniform vec2 uSourcePosition;
uniform float uNoise;
uniform float uTime;

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
  vec2 pixel = gl_FragCoord.xy;

  // 입력 좌표는 CSS 좌표계(왼쪽 위 원점), gl_FragCoord는 왼쪽 아래 원점
  vec2 sourcePixel = vec2(
    uSourcePosition.x,
    uResolution.y - uSourcePosition.y
  );

  float distPx = distance(pixel, sourcePixel);

  // 소리 클수록 반경 커짐
  float radius = mix(70.0, 260.0, uNoise);

  // 약간 맥동
  float pulseSpeed = 2.0 + uNoise * 6.0;
  float pulse = 0.94 + 0.06 * sin(uTime * pulseSpeed);
  radius *= pulse;

  // 중심 = 1, 바깥 = 0
  float radial = 1.0 - smoothstep(0.0, radius, distPx);

  // 가장자리 부드럽게 끊기
  float circleMask = 1.0 - smoothstep(radius * 0.92, radius, distPx);

  // 핵심:
  // 현재 소리값(uNoise)에 거리 감쇠(radial)를 곱해서
  // 각 픽셀의 체감 소음값을 만든다.
  float localNoise = clamp(uNoise * radial, 0.0, 1.0);

  vec3 color = noiseColor(localNoise);

  // 중심이 너무 허옇지 않게, 대신 더 밝게 보이도록 약간 증폭
  float brightness = 0.75 + 0.35 * radial;
  color *= brightness;

  // 등고선 비슷한 줄무늬를 넣고 싶으면 유지
  float contourCount = 8.0;
  float contourStrength = 0.18;

  if (uNoise > 0.01) {
    float iso = localNoise * contourCount;
    float phase = fract(iso);
    float edgeDistance = min(phase, 1.0 - phase);
    float width = max(fwidth(iso) * 1.5, 0.004);
    float contour = 1.0 - smoothstep(0.0, width, edgeDistance);

    vec3 contourColor = vec3(0.03, 0.03, 0.05);
    color = mix(color, contourColor, contour * contourStrength);
  }

  float alpha = circleMask * (0.12 + 0.72 * radial) * (0.25 + 0.75 * uNoise);

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
    this.startTime = performance.now();

    this.sourceX = window.innerWidth * 0.5;
    this.sourceY = window.innerHeight * 0.5;

    this.program = this.createProgram(vertexShaderSource, fragmentShaderSource);

    this.positionLocation = this.gl.getAttribLocation(this.program, "aPosition");
    this.noiseLocation = this.gl.getUniformLocation(this.program, "uNoise");
    this.timeLocation = this.gl.getUniformLocation(this.program, "uTime");
    this.resolutionLocation = this.gl.getUniformLocation(this.program, "uResolution");
    this.sourcePositionLocation = this.gl.getUniformLocation(this.program, "uSourcePosition");

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

  setSourcePosition(x, y) {
    this.sourceX = x;
    this.sourceY = y;
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

    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(this.noiseLocation, this.displayedNoise);
    gl.uniform1f(this.timeLocation, (now - this.startTime) / 1000.0);
    gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
    gl.uniform2f(
      this.sourcePositionLocation,
      this.sourceX * dpr,
      this.sourceY * dpr
    );

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
      throw new Error(\`셰이더 컴파일 실패: \${message}\`);
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
      throw new Error(\`WebGL 프로그램 연결 실패: \${message}\`);
    }

    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);

    return program;
  }
}
