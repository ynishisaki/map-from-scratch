import MercatorCoordinate from "./mercator-coordinate";
import { createProgram, createShader } from "./webgl-utils";

const USA_BBOX = [
  [-126.03515625, 23.079731762449878],
  [-60.1171875, 23.079731762449878],
  [-60.1171875, 50.233151832472245],
  [-126.03515625, 50.233151832472245],
];

const vertexShaderSource = `
  attribute vec2 a_position;
  
  void main() {
    gl_Position = vec4(a_position, 0, 1)
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  
  void main() {
    gl_FragColor = vec4(1, 0, 0.5, 0.5);
  }
`;

const run = (canvasId: string) => {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error(`No canvas element with id ${canvasId}`);
  }
  // canvas: HTMLCanvasElement
  const gl = canvas.getContext("webgl");
  if (!gl) {
    throw new Error("No WebGL context found");
  }

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmendShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );

  if (!vertexShader || !fragmendShader) {
    console.error("Failed to create shaders");
    return;
  }
  const program = createProgram(gl, vertexShader, fragmendShader);
  if (!program) {
    console.error("Failed to create program");
    return;
  }
  gl.clearColor(0, 0, 0, 0);
  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
};

const [nw_x, nw_y] = MercatorCoordinate.fromLngLat(USA_BBOX[0]);
const [ne_x, ne_y] = MercatorCoordinate.fromLngLat(USA_BBOX[1]);
const [se_x, se_y] = MercatorCoordinate.fromLngLat(USA_BBOX[2]);
const [sw_x, sw_y] = MercatorCoordinate.fromLngLat(USA_BBOX[3]);

const positions = [
  // triangle 1
  nw_x,
  nw_y,
  ne_x,
  ne_y,
  se_x,
  se_y,

  // triangle 2
  se_x,
  se_y,
  sw_x,
  sw_y,
  nw_x,
  nw_y,
];

console.log("positions", positions);

// rendar vertices to a <canvas>

// Get a WebGL context from out canvas element
// Compile the shaders, and setup our program
// Convert out lng/lat's to clip-space vertices
// Tell WebGL to render the triangles
