import * as tilebelt from "@mapbox/tilebelt";
import { mat3, vec3 } from "gl-matrix";
import Hammer from "hammerjs";
import Stats from "stats.js";
import atLimits from "./at-limites";
import {
  INITIAL_SETTINGS,
  LAYERS,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SIZE,
} from "./constants";
import geometryToVertices from "./geometry-to-vertices";
import getClipSpacePosition from "./get-clip-space-position";
import MercatorCoordinate from "./mercator-coordinate";
import { Camera, TileData } from "./type";
import updateTiles from "./update-tiles";
import { createProgram, createShader } from "./webgl-utils";

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

class CreateMap {
  private camera: Camera;
  private tilesInView: tilebelt.Tile[];
  private tileData: TileData;
  private matrix: mat3;
  private timestamp: number;
  private slowCount: number;
  private frameStats: {
    drawCalls: number;
    vertices: number;
    features: number;
  };
  private startX: number;
  private startY: number;
  private canvas: HTMLCanvasElement | null;
  private hammer: HammerManager | null;
  private loopRunning: boolean;
  private overlay: HTMLElement | null;
  private statsWidget: HTMLElement | null;

  constructor() {
    const [initialX, initialY] = MercatorCoordinate.fromLngLat([
      ...INITIAL_SETTINGS.lnglat,
    ]);
    this.camera = { x: initialX, y: initialY, zoom: INITIAL_SETTINGS.zoom };

    this.tilesInView = [];
    this.tileData = {};
    this.matrix = mat3.create();
    this.timestamp = 0;
    this.slowCount = 0;
    this.frameStats = { drawCalls: 0, vertices: 0, features: 0 };
    this.startX = 0;
    this.startY = 0;
    this.canvas = null;
    this.hammer = null;
    this.loopRunning = true;
    this.overlay = null;
    this.statsWidget = null;
  }

  private updateMatrix() {
    if (!this.canvas) return;

    const cameraMat = mat3.create();

    mat3.translate(cameraMat, cameraMat, [this.camera.x, this.camera.y]);

    const zoomScale = 1 / Math.pow(2, this.camera.zoom);
    const widthScale = TILE_SIZE / this.canvas.width;
    const heightScale = TILE_SIZE / this.canvas.height;
    mat3.scale(cameraMat, cameraMat, [
      zoomScale / widthScale,
      zoomScale / heightScale,
    ]);

    this.matrix = mat3.multiply(
      [] as unknown as mat3,
      mat3.create(),
      mat3.invert([] as unknown as mat3, cameraMat)
    );
  }

  private async handleMove(moveEvent: MouseEvent | HammerInput) {
    if (!this.canvas) return;

    const [x, y] = getClipSpacePosition(moveEvent, this.canvas);

    const [preX, preY] = vec3.transformMat3(
      [] as unknown as vec3,
      [this.startX, this.startY, 0],
      mat3.invert([] as unknown as mat3, this.matrix)
    );

    const [postX, postY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, this.matrix)
    );

    const deltaX = preX - postX;
    const deltaY = preY - postY;
    if (isNaN(deltaX) || isNaN(deltaY)) {
      return;
    }

    this.camera.x += deltaX;
    this.camera.y += deltaY;

    this.updateMatrix();

    if (atLimits(this.canvas, this.camera)) {
      this.camera.x -= deltaX;
      this.camera.y -= deltaY;
      this.updateMatrix();
      return;
    }

    this.startX = x;
    this.startY = y;

    this.updateMatrix();

    const tileData = this.tileData;
    const { tileData: newTileData } = await updateTiles(
      this.canvas,
      this.camera,
      tileData
    );
    this.tileData = newTileData;
  }

  private handlePan(startEvent: MouseEvent | HammerInput) {
    if (!this.canvas) return;

    [this.startX, this.startY] = getClipSpacePosition(startEvent, this.canvas);
    this.canvas.style.cursor = "grabbing";

    const handleMoveBound = this.handleMove.bind(this);
    const clear = (event: MouseEvent | HammerInput) => {
      if (!this.canvas) return;

      this.canvas.style.cursor = "grab";
      window.removeEventListener("mousemove", handleMoveBound);
      window.removeEventListener("mouseup", clear);
      this.hammer?.off("pan", handleMoveBound);
      this.hammer?.off("panend", clear);
    };

    window.addEventListener("mousemove", handleMoveBound);
    window.addEventListener("mouseup", clear);
    this.hammer?.on("pan", handleMoveBound);
    this.hammer?.on("panend", clear);
  }

  private async handleZoom(wheelEvent: WheelEvent | HammerInput) {
    if (!this.canvas) return;

    wheelEvent.preventDefault();
    const [x, y] = getClipSpacePosition(wheelEvent, this.canvas);

    const [preZoomX, preZoomY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, this.matrix)
    );

    const prevZoom = this.camera.zoom;
    const zoomDelta = -wheelEvent.deltaY * (1 / 500);
    this.camera.zoom = Math.max(
      MIN_ZOOM,
      Math.min(this.camera.zoom + zoomDelta, MAX_ZOOM)
    );
    this.updateMatrix();

    if (atLimits(this.canvas, this.camera)) {
      this.camera.zoom = prevZoom;
      this.updateMatrix();
      return;
    }

    const [postZoomX, postZoomY] = vec3.transformMat3(
      [] as unknown as vec3,
      [x, y, 0],
      mat3.invert([] as unknown as mat3, this.matrix)
    );

    this.camera.x += preZoomX - postZoomX;
    this.camera.y += preZoomY - postZoomY;
    this.updateMatrix();

    const tileData = this.tileData;
    const { tileData: newTileData } = await updateTiles(
      this.canvas,
      this.camera,
      tileData
    );
    this.tileData = newTileData;
  }

  public async run(
    canvasId: string,
    mobile: boolean = false,
    abort: (() => void) | null = null
  ) {
    this.loopRunning = true;
    this.timestamp = 0;
    this.slowCount = 0;

    const stats = new Stats();

    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!this.canvas) {
      throw new Error(`No canvas element with id ${canvasId}`);
    }

    const gl = this.canvas.getContext("webgl");
    if (!gl) {
      throw new Error("No WebGL context found");
    }

    this.overlay = document.getElementById(`${canvasId}-overlay`);

    this.updateMatrix();

    const tileData = this.tileData;
    const { tileData: newTileData } = await updateTiles(
      this.canvas,
      this.camera,
      tileData
    );
    this.tileData = newTileData;

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

    const draw = async () => {
      if (!this.canvas) return;

      this.frameStats = { drawCalls: 0, vertices: 0, features: 0 };
      stats.begin();

      const matrixLocation = gl.getUniformLocation(program, "u_matrix");
      gl.uniformMatrix3fv(matrixLocation, false, this.matrix);

      const tileData = this.tileData;
      const { tilesInView: newTilesInView, tileData: newTileData } =
        await updateTiles(this.canvas, this.camera, tileData);
      this.tilesInView = newTilesInView;
      this.tileData = newTileData;

      Object.keys(tileData).forEach((tile) => {
        (tileData[tile] as any[]).forEach((tileLayer) => {
          const { layer, vertices } = tileLayer;

          if (LAYERS[layer as keyof typeof LAYERS]) {
            // RGBA to WebGL color
            const color = LAYERS[layer as keyof typeof LAYERS].map(
              (n) => n / 255
            );

            const colorLocation = gl.getUniformLocation(program, "u_color");
            gl.uniform4fv(colorLocation, color);

            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

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
            const count = vertices.length / 2;
            gl.drawArrays(primitiveType, offset, count);

            this.frameStats.drawCalls++;
            this.frameStats.vertices += vertices.length;
          }
        });
      });

      this.overlay?.replaceChildren();

      this.tilesInView.forEach((tile) => {
        if (!this.canvas) return;

        const colorLocation = gl.getUniformLocation(program, "u_color");
        gl.uniform4fv(colorLocation, [1, 0, 0, 1]);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

        const tileVertices = geometryToVertices(tilebelt.tileToGeoJSON(tile));
        gl.bufferData(gl.ARRAY_BUFFER, tileVertices, gl.STATIC_DRAW);

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

        // draw
        const primitiveType = gl.LINES;
        offset = 0;
        const count = tileVertices.length / 2;
        gl.drawArrays(primitiveType, offset, count);

        // draw tile labels
        const tileCoordinates = (tilebelt.tileToGeoJSON(tile) as any)
          .coordinates;
        const topLeft = tileCoordinates[0][0];
        const [x, y] = MercatorCoordinate.fromLngLat(
          topLeft as [number, number]
        );

        const [clipX, clipY] = vec3.transformMat3(
          [] as unknown as vec3,
          [x, y, 1],
          this.matrix
        );

        const wx = ((1 + clipX) / 2) * this.canvas.width;
        const wy = ((1 - clipY) / 2) * this.canvas.height;
        const div = document.createElement("div");
        div.className = "tile-label";
        div.style.left = `${wx + 8}px`;
        div.style.top = `${wy + 8}px`;
        div.style.position = "absolute";
        div.style.zIndex = "1000";
        div.appendChild(document.createTextNode(tile.join("/")));
        this.overlay?.appendChild(div);
      });

      const now = performance.now();
      const fps = 1 / ((now - this.timestamp) / 1000);
      if (fps < 10) {
        this.slowCount++;

        if (this.slowCount > 10) {
          console.warn(`Too slow. Killing loop for ${canvasId}.`);
          this.stop(this.canvas, this.statsWidget);
          if (abort) {
            abort();
          }
        }
      }
      this.timestamp = now;

      stats.end();
      if (this.loopRunning) {
        window.requestAnimationFrame(draw);
      }
    };
    // start loop
    window.requestAnimationFrame(draw);

    this.hammer = new Hammer(this.canvas);
    this.hammer.get("pan").set({ direction: Hammer.DIRECTION_ALL });
    this.hammer.get("pinch").set({ enable: true });

    this.canvas.addEventListener("mousedown", this.handlePan.bind(this));
    this.hammer.on("panstart", this.handlePan.bind(this));

    this.canvas.addEventListener("wheel", this.handleZoom.bind(this));
    this.hammer.on("pinch", this.handleZoom.bind(this));

    // setup stats widget
    stats.showPanel(0);
    this.statsWidget = stats.dom;
    this.statsWidget.style.position = "absolute";
    this.statsWidget.style.zIndex = "0";
    this.canvas.parentElement?.appendChild(this.statsWidget);
  }

  public stop(
    canvas: HTMLCanvasElement | null,
    statsWidget: HTMLElement | null
  ) {
    this.loopRunning = false;

    if (!canvas) return;
    if (!statsWidget) return;

    canvas.removeEventListener("wheel", this.handleZoom.bind(this));
    canvas.removeEventListener("mousedown", this.handlePan.bind(this));
    this.overlay?.replaceChildren();
    statsWidget.remove();
  }

  public getFrameStats() {
    return this.frameStats;
  }
}

const map = new CreateMap();
map.run("canvas", false, () => {});
