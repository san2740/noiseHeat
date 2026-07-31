const vertexShaderSource = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

uniform vec2 uResolution;
uniform float uNoise;
uniform float uTime;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 centered = uv - 0.5;
  centered.x *= uResolution.x / uResolution.y;

  float dist = length(centered);
  float edge = smoothstep(0.12, 0.72, dist);

  float pulseSpeed = 2.0 + uNoise * 8.0;
  float pulse = 0.88 + 0.12 * sin(uTime * pulseSpeed);
  float intensity = edge * uNoise * pulse;

  vec3 quietColor = vec3(0.04, 0.35, 1.0);
  vec3 midColor   = vec3(1.0, 0.78, 0.05);
  vec3 loudColor  = vec3(1.0, 0.04, 0.01);

  vec3 heatColor =
    uNoise < 0.5
      ? mix(quietColor, midColor, uNoise * 2.0)
      : mix(midColor, loudColor, (uNoise - 0.5) * 2.0);

  float alpha = intensity * (0.14 + 0.58 * uNoise);
  gl_FragColor = vec4(heatColor, alpha);
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
    this.program = this.createProgram(vertexShaderSource, fragmentShaderSource);

    this.positionLocation = this.gl.getAttribLocation(this.program, "aPosition");
    this.noiseLocation = this.gl.getUniformLocation(this.program, "uNoise");
    this.timeLocation = this.gl.getUniformLocation(this.program, "uTime");
    this.resolutionLocation = this.gl.getUniformLocation(this.program, "uResolution");

    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);

    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
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

  resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(innerWidth * dpr);
    const height = Math.round(innerHeight * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
  };

  render = now => {
    this.displayedNoise += (this.noise - this.displayedNoise) * 0.12;

    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(this.noiseLocation, this.displayedNoise);
    gl.uniform1f(this.timeLocation, (now - this.startTime) / 1000);
    gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);

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
      throw new Error(`WebGL 프로그램 연결 실패: ${message}`);
    }

    this.gl.deleteShader(vertex);
    this.gl.deleteShader(fragment);
    return program;
  }
}
