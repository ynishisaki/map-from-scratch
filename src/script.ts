import MercatorCoordinate from "./mercator-coordinate";
import { createProgram, createShader } from "./webgl-utils";

const USA_BBOX = [
  [-126.03515625, 23.079731762449878],
  [-60.1171875, 23.079731762449878],
  [-60.1171875, 50.233151832472245],
  [-126.03515625, 50.233151832472245],
] satisfies [
  [number, number],
  [number, number],
  [number, number],
  [number, number]
];

const vertexShaderSource = `
  attribute vec2 a_position;
  
  void main() {
    gl_Position = vec4(a_position, 0, 1);
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

  const [nw_x, nw_y] = MercatorCoordinate.fromLngLat(USA_BBOX[0]);
  const [ne_x, ne_y] = MercatorCoordinate.fromLngLat(USA_BBOX[1]);
  const [se_x, se_y] = MercatorCoordinate.fromLngLat(USA_BBOX[2]);
  const [sw_x, sw_y] = MercatorCoordinate.fromLngLat(USA_BBOX[3]);

  const positions = [
    nw_x,
    nw_y,
    ne_x,
    ne_y,
    se_x,
    se_y,

    se_x,
    se_y,
    sw_x,
    sw_y,
    nw_x,
    nw_y,
  ];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionAttributeLocation);

  const draw = () => {
    const size = 2;
    const type = gl.FLOAT;
    const normalize = false;
    const stride = 0;
    let offset = 0;
    gl.vertexAttribPointer(
      positionAttributeLocation,
      size,
      type,
      normalize,
      stride,
      offset
    );

    const primitiveType = gl.TRIANGLES;
    offset = 0;
    const count = 6;
    gl.drawArrays(primitiveType, offset, count);
  };

  draw();
};

// export default run;
run("canvas");
