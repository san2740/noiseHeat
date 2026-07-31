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

vec3 heatPalette(float t) {
  vec3 whiteColor  = vec3(1.00, 1.00, 1.00);
  vec3 redColor    = vec3(1.00, 0.04, 0.01);
  vec3 yellowColor = vec3(1.00, 0.78, 0.02);
  vec3 greenColor  = vec3(0.02, 0.82, 0.20);
  vec3 cyanColor   = vec3(0.00, 0.76, 1.00);
  vec3 blueColor   = vec3(0.02, 0.12, 1.00);

  if (t < 0.08) {
    return mix(whiteColor, redColor, t / 0.08);
  }
  if (t < 0.30) {
    return mix(redColor, yellowColor, (t - 0.08) / 0.22);
  }
  if (t < 0.52) {
    return mix(yellowColor, greenColor, (t - 0.30) / 0.22);
  }
  if (t < 0.74) {
    return mix(greenColor, cyanColor, (t - 0.52) / 0.22);
  }
  return mix(cyanColor, blueColor, (t - 0.74) / 0.26);
}

void main() {
  // gl_FragCoord의 Y축은 아래에서 위로 증가합니다.
  vec2 source = vec2(
    uSourcePosition.x,
    uResolution.y - uSourcePosition.y
  );

  float distancePx = distance(gl_FragCoord.xy, source);

  // 음량이 커질수록 히트맵 반경과 밝기가 증가합니다.
  float baseRadius = mix(70.0, 250.0, uNoise);
  float pulseSpeed = 2.0 + uNoise * 7.0;
  float pulse = 0.94 + 0.06 * sin(uTime * pulseSpeed);
  float radius = baseRadius * pulse;

  float normalizedDistance = distancePx / radius;
  float t = clamp(normalizedDistance, 0.0, 1.0);
  vec3 color = heatPalette(t);

  // 바깥 테두리를 부드럽게 투명하게 만듭니다.
  float circleMask = 1.0 - smoothstep(0.84, 1.0, normalizedDistance);

  // 중앙부를 강조하고, 낮은 음량에서는 전체 투명도를 낮춥니다.
  float centerGlow = 1.0 - smoothstep(0.0, 0.65, normalizedDistance);
  float noiseVisibility = smoothstep(0.025, 0.16, uNoise);
  float alpha = circleMask
              * noiseVisibility
              * (0.20 + 0.58 * uNoise)
              * (0.62 + 0.38 * centerGlow);

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
    this.sourceX = window.innerWidth * 0.5;
    this.sourceY = window.innerHeight * 0.42;
    this.startTime = performance.now();

    this.program = this.createProgram(
      vertexShaderSource,
      fragmentShaderSource
    );

    this.positionLocation = this.gl.getAttribLocation(
      this.program,
      "aPosition"
    );
    this.noiseLocation = this.gl.getUniformLocation(this.program, "uNoise");
    this.timeLocation = this.gl.getUniformLocation(this.program, "uTime");
    this.resolutionLocation = this.gl.getUniformLocation(
      this.program,
      "uResolution"
    );
    this.sourcePositionLocation = this.gl.getUniformLocation(
      this.program,
      "uSourcePosition"
    );

    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);

    this.buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      vertices,
      this.gl.STATIC_DRAW
    );

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(
      this.gl.SRC_ALPHA,
      this.gl.ONE_MINUS_SRC_ALPHA
    );

    window.addEventListener("resize", this.resize);
    this.resize();
    requestAnimationFrame(this.render);
  }

  setNoise(value) {
    this.noise = Math.min(1, Math.max(0, value));
  }

  setSourcePosition(x, y) {
    this.sourceX = Math.min(window.innerWidth, Math.max(0, x));
    this.sourceY = Math.min(window.innerHeight, Math.max(0, y));
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
    gl.vertexAttribPointer(
      this.positionLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );

    gl.uniform1f(this.noiseLocation, this.displayedNoise);
    gl.uniform1f(this.timeLocation, (now - this.startTime) / 1000);
    gl.uniform2f(
      this.resolutionLocation,
      this.canvas.width,
      this.canvas.height
    );
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
      throw new Error(`셰이더 컴파일 실패: ${message}`);
    }

    return shader;
  }

  createProgram(vertexSource, fragmentSource) {
    const vertex = this.createShader(
      this.gl.VERTEX_SHADER,
      vertexSource
    );
    const fragment = this.createShader(
      this.gl.FRAGMENT_SHADER,
      fragmentSource
    );
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
