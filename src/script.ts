import * as tilebelt from "@mapbox/tilebelt";
import { Feature, Polygon } from "geojson";
import { mat3, vec3 } from "gl-matrix";
import Hammer from "hammerjs";
import atLimits from "./at-limites";
import { LAYERS } from "./constants";
import geometryToVertices from "./geometry-to-vertices";
import getClipSpacePosition from "./get-clip-space-position";
import MercatorCoordinate from "./mercator-coordinate";
import updateTiles from "./update-tiles";
import { createProgram, createShader } from "./webgl-utils";

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
  
  uniform vec4 u_color;
  
  void main() {
    gl_FragColor = u_color;
  }
`;

const camera = {
  x: 0,
  y: 0,
  zoom: 0,
};

camera.x = -0.41101919888888894;
camera.y = 0.2478952993354263;
camera.zoom = 13;

let canvas;
let overlay: HTMLElement | null = null;

// define update tilies

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

const run = (canvasId: string) => {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error(`No canvas element with id ${canvasId}`);
  }

  const gl = canvas.getContext("webgl");
  if (!gl) {
    throw new Error("No WebGL context found");
  }

  overlay = document.getElementById(`${canvasId}-overlay`);

  updateMatrix();

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

  const draw = async () => {
    const { tilesInView, tileData, tileKey } = await updateTiles(
      camera,
      canvas
    );

    const matrixLocation = gl.getUniformLocation(program, "u_matrix");
    gl.uniformMatrix3fv(matrixLocation, false, matrix);

    Object.keys(tileData).forEach((tile) => {
      Object.keys(LAYERS).forEach((layer) => {
        const features = tileData[tile][layer] ?? [];
        // RGBA to WebGL color
        const color = LAYERS[layer as keyof typeof LAYERS].map((n) => n / 255);

        const colorLocation = gl.getUniformLocation(program, "u_color");
        gl.uniform4fv(colorLocation, color);

        (features ?? []).forEach((feature) => {
          const positionBuffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, feature, gl.STATIC_DRAW);

          const positionAttributeLocation = gl.getAttribLocation(
            program,
            "a_position"
          );
          gl.enableVertexAttribArray(positionAttributeLocation);

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
          const count = feature.length / 2;
          gl.drawArrays(primitiveType, offset, count);
        });
      });
    });

    overlay?.replaceChildren();

    tilesInView.forEach((tile) => {
      const colorLocation = gl.getUniformLocation(program, "u_color");
      gl.uniform4fv(colorLocation, [1, 0, 0, 1]);

      const positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

      const tileVertices = geometryToVertices(tilebelt.tileToGeoJSON(tile));
      gl.bufferData(gl.ARRAY_BUFFER, tileVertices, gl.STATIC_DRAW);

      const positionAttributeLocation = gl.getAttribLocation(
        program,
        "a_position"
      );
      gl.enableVertexAttribArray(positionAttributeLocation);

      // tell the attribute how to get data out of positionBuffer (ARRAY_BUFFER)
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

      // draw
      const primitiveType = gl.LINES;
      offset = 0;
      const count = tileVertices.length / 2;
      gl.drawArrays(primitiveType, offset, count);

      // draw tile labels
      const tileCoordinates = (
        tilebelt.tileToGeoJSON(tile) as unknown as Feature<Polygon>
      ).geometry.coordinates;
      const topLeft = tileCoordinates[0][0];
      const [x, y] = MercatorCoordinate.fromLngLat(topLeft as [number, number]);

      const [clipX, clipY] = vec3.transformMat3(
        [] as unknown as vec3,
        [x, y, 1],
        matrix
      );

      const wx = ((1 + clipX) / 2) * canvas.width;
      const wy = ((1 - clipY) / 2) * canvas.height;
      const div = document.createElement("div");
      div.className = "tile-label";
      div.style.left = wx + 8 + "px";
      div.style.top = wy + 8 + "px";
      div.style.position = "absolute";
      div.style.zIndex = "1000";
      div.appendChild(document.createTextNode(tile.join("/")));
      overlay?.appendChild(div);
    });
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

    updateMatrix();

    if (atLimits(camera, canvas)) {
      camera.x -= deltaX;
      camera.y -= deltaY;
      updateMatrix();
      return;
    }

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

    const prevZoom = camera.zoom;
    const zoomDelta = -wheelEvent.deltaY * (1 / 500);
    camera.zoom += zoomDelta;
    camera.zoom = Math.max(MIN_ZOOM, Math.min(camera.zoom, MAX_ZOOM));
    updateMatrix();

    if (atLimits(camera, canvas)) {
      camera.zoom = prevZoom;
      updateMatrix();
      return;
    }

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
