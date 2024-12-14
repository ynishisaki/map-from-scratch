import earcut, { flatten } from "earcut";
import { Polygon, Position } from "geojson";
import { mat3, vec3 } from "gl-matrix";
import Hammer from "hammerjs";
import MercatorCoordinate from "./mercator-coordinate";
import { createProgram, createShader } from "./webgl-utils";

import WASHINGTON from "../assets/washington";

const MIN_ZOOM = 0;
const MAX_ZOOM = 16;

const vertexShaderSource = `
  attribute vec2 a_position;
  
  uniform mat3 u_matrix;
  
  void main() {
    vec2 position = (u_matrix * vec3(a_position, 1)).xy;
    gl_Position = vec4(position, 0, 1);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  
  void main() {
    gl_FragColor = vec4(1, 0, 0.5, 0.5);
  }
`;

const camera = {
  x: 0,
  y: 0,
  zoom: 0,
};

camera.x = -0.6718187712249346;
camera.y = 0.29662864586475735;
camera.zoom = 5;

let matrix: mat3;
function updateMatrix() {
  const cameraMat = mat3.create();

  mat3.translate(cameraMat, cameraMat, [camera.x, camera.y]);

  const zoomScale = 1 / Math.pow(2, camera.zoom);
  mat3.scale(cameraMat, cameraMat, [zoomScale, zoomScale]);

  matrix = mat3.multiply(
    [] as unknown as mat3,
    mat3.create(),
    mat3.invert([] as unknown as mat3, cameraMat)
  );
}
updateMatrix();

function getClipSpacePosition(
  // e: MouseEvent | HammerInput | WheelEvent,
  e: any,
  canvas: HTMLCanvasElement
) {
  const [x, y] = [
    e.center?.x || e.clientX, //
    e.center?.y || e.clientY,
  ];

  const rect = canvas.getBoundingClientRect();
  const cssX = x - rect.left;
  const cssY = y - rect.top;

  const normalizedX = cssX / canvas.clientWidth;
  const normalizedY = cssY / canvas.clientHeight;

  const clipX = normalizedX * 2 - 1;
  const clipY = normalizedY * -2 + 1;

  return [clipX, clipY];
}

function geometryToVertices(geometry: Polygon) {
  const verticesFromPolygon = (
    coordinates: Position[][],
    n?: number
  ): Float32Array => {
    const data = flatten(coordinates);
    const triangles = earcut(data.vertices, data.holes, 2);

    const vertices = new Float32Array(triangles.length * 2);
    for (let i = 0; i < triangles.length; i++) {
      const point = triangles[i];
      const lng = data.vertices[point * 2];
      const lat = data.vertices[point * 2 + 1];
      const [x, y] = MercatorCoordinate.fromLngLat([lng, lat]);
      vertices[i * 2] = x;
      vertices[i * 2 + 1] = y;
    }
    return vertices;
  };

  if (geometry.type === "Polygon") {
    return verticesFromPolygon(geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    const positions: Float32Array[] = [];
    geometry.coordinates.forEach((polygon, i) => {
      const coordinates = [[polygon[0]]];
      const vertices = verticesFromPolygon(coordinates, i);

      vertices.forEach((vertex) => {
        positions[0][positions.length] = vertex;
      });
    });
    return Float32Array.from(positions as any);
  }

  return new Float32Array();
}

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
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource
  );

  if (!vertexShader || !fragmentShader) {
    console.error("Failed to create shaders");
    return;
  }
  const program = createProgram(gl, vertexShader, fragmentShader);
  if (!program) {
    console.error("Failed to create program");
    return;
  }
  gl.clearColor(0, 0, 0, 0);
  gl.useProgram(program);

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  const vertices = geometryToVertices(WASHINGTON);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  const positionAttributeLocation = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(positionAttributeLocation);

  const draw = () => {
    const matrixLocation = gl.getUniformLocation(program, "u_matrix");
    gl.uniformMatrix3fv(matrixLocation, false, matrix);

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
    const count = vertices.length / 2;
    gl.drawArrays(primitiveType, offset, count);
  };
  draw();

  const hammer = new Hammer(canvas);
  hammer.get("pan").set({ direction: Hammer.DIRECTION_ALL });
  hammer.get("pinch").set({ enable: true });

  let startX: number;
  let startY: number;

  const handleMove = (moveEvent: MouseEvent | HammerInput) => {
    const [x, y] = getClipSpacePosition(moveEvent, canvas);

    const [preX, preY] = vec3.transformMat3(
      [] as unknown as vec3,
      [startX, startY, 0],
      mat3.invert([] as unknown as mat3, matrix)
    );

    const [postX, postY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, matrix)
    );

    const deltaX = preX - postX;
    const deltaY = preY - postY;
    if (isNaN(deltaX) || isNaN(deltaY)) {
      return;
    }

    camera.x += deltaX;
    camera.y += deltaY;

    startX = x;
    startY = y;

    updateMatrix();
    draw();
  };

  const handlePan = (startEvent: MouseEvent | HammerInput) => {
    [startX, startY] = getClipSpacePosition(startEvent, canvas);
    canvas.style.cursor = "grabbing";

    window.addEventListener("mousemove", handleMove);
    hammer.on("pan", handleMove);

    const clear = (event: MouseEvent | HammerInput) => {
      canvas.style.cursor = "grab";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", clear);
      hammer.off("pan", handleMove);
      hammer.off("panend", clear);
    };
    window.addEventListener("mouseup", clear);
    hammer.on("panend", clear);
  };
  canvas.addEventListener("mousedown", handlePan);
  hammer.on("panstart", handlePan);

  const handleZoom = (wheelEvent: WheelEvent | HammerInput) => {
    wheelEvent.preventDefault();
    const [x, y] = getClipSpacePosition(wheelEvent, canvas);

    const [preZoomX, preZoomY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, matrix)
    );

    const zoomDelta = -wheelEvent.deltaY * (1 / 300);
    camera.zoom += zoomDelta;
    camera.zoom = Math.max(MIN_ZOOM, Math.min(camera.zoom, MAX_ZOOM));
    updateMatrix();

    const [postZoomX, postZoomY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, matrix)
    );

    camera.x += preZoomX - postZoomX;
    camera.y += preZoomY - postZoomY;
    updateMatrix();
    draw();
  };
  canvas.addEventListener("wheel", handleZoom);
  hammer.on("pinch", handleZoom);
};

// export default run;
run("canvas");
