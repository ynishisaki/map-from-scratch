type CreateShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string
) => WebGLShader | undefined;

export const createShader: CreateShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error("Failed to create shader");
    return;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  let success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) {
    return shader;
  }
  console.error(gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
};

type CreateProgram = (
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
) => WebGLProgram | undefined;
export const createProgram: CreateProgram = (
  gl,
  vertexShader,
  fragmentShader
) => {
  const program = gl.createProgram();
  if (!program) {
    console.error("Failed to create program");
    return;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  let success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (success) {
    return program;
  }
  console.error(gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
};
