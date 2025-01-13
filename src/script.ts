import * as tilebelt from "@mapbox/tilebelt";
import { VectorTile } from "@mapbox/vector-tile";
import axios from "axios";
import { mat3, vec3 } from "gl-matrix";
import Hammer from "hammerjs";
import Protobuf from "pbf";
import Stats from "stats.js";
import atLimits from "./at-limites";
import {
  INITIAL_SETTINGS,
  LAYERS,
  MAX_TILE_ZOOM,
  MAX_ZOOM,
  MIN_TILE_ZOOM,
  MIN_ZOOM,
  TILE_ATTRIBUTION,
  TILE_BUFFER,
  TILE_SIZE,
  TILE_URL,
} from "./constants";
import geometryToVertices from "./geometry-to-vertices";
import getBounds from "./get-bounds";
import getClipSpacePosition from "./get-clip-space-position";
import MercatorCoordinate from "./mercator-coordinate";
import { Camera, TileData, TileLayerData } from "./type";
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
  private cacheStats: { cacheHits: number; tilesLoaded: number };
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

    this.cacheStats = { cacheHits: 0, tilesLoaded: 0 };
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

  private addAttribution() {
    const attribution = document.createElement("div");
    attribution.className = "attribution";
    attribution.innerHTML = TILE_ATTRIBUTION;
    attribution.style.position = "absolute";
    attribution.style.bottom = "0";
    attribution.style.right = "0";
    attribution.style.backgroundColor = "white";
    attribution.style.padding = "4px";

    document.getElementById("canvas-wrapper")?.appendChild(attribution);
  }

  private resizeCanvas() {
    if (this.canvas) {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
      const gl = this.canvas.getContext("webgl");
      if (gl) {
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      }
      this.updateMatrix();
    }
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

    const { tileData: newTileData } = await this.updateTiles(
      this.canvas,
      this.camera,
      this.tileData
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

    const { tileData: newTileData } = await this.updateTiles(
      this.canvas,
      this.camera,
      this.tileData
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

    window.addEventListener("resize", this.resizeCanvas.bind(this));
    this.resizeCanvas();

    this.addAttribution();

    this.overlay = document.getElementById(`${canvasId}-overlay`);

    this.updateMatrix();

    const { tileData: newTileData } = await this.updateTiles(
      this.canvas,
      this.camera,
      this.tileData
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

      const { tileData: newTileData } = await this.updateTiles(
        this.canvas,
        this.camera,
        this.tileData
      );
      this.tileData = newTileData;

      Object.keys(this.tileData).forEach((tile) => {
        (this.tileData[tile] as any[]).forEach((tileLayer) => {
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
        const tileCoordinates = (
          tilebelt.tileToGeoJSON(tile as unknown as tilebelt.Tile) as any
        ).coordinates;
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

  private async updateTiles(
    canvas: HTMLCanvasElement,
    camera: Camera,
    prevTileData: TileData
  ) {
    const tileData: { [key: string]: TileLayerData | undefined } = prevTileData;

    const tilesToLoad = this.getTilesToLoad(canvas, camera);

    tilesToLoad.forEach(async (tile) => {
      if (tileData[tile]) {
        this.cacheStats.cacheHits++;
        return;
      } else {
        this.tileData[tile] = [];
      }

      try {
        const [x, y, z] = tile.split("/").map(Number);

        const reqStart = Date.now();
        const res = await axios.get(`${TILE_URL}/${z}/${x}/${y}.pbf`, {
          responseType: "arraybuffer",
        });
        this.cacheStats.tilesLoaded++;

        const pbf = new Protobuf(res.data);
        const vectorTile = new VectorTile(pbf);

        const layers: { layer: string; vertices: Float32Array }[] = [];
        Object.keys(LAYERS).forEach((layer) => {
          if (vectorTile?.layers?.[layer]) {
            const numFeatures =
              vectorTile.layers[layer]?._features?.length || 0;

            const vertices = [];
            for (let i = 0; i < numFeatures; i++) {
              const geojson = vectorTile.layers[layer]
                .feature(i)
                .toGeoJSON(x, y, z);
              vertices.push(...geometryToVertices(geojson.geometry));
            }
            layers.push({ layer, vertices: Float32Array.from(vertices) });
          }
        });
        this.tileData[tile] = layers;
      } catch (e) {
        console.warn(`Tile ${tile} request failed.`, e);
        this.tileData[tile] = undefined;
      }
    });

    return {
      tileData,
    };
  }

  private getTilesToLoad(canvas: HTMLCanvasElement, camera: Camera) {
    const bbox = getBounds(canvas, camera);

    const z = Math.max(
      MIN_TILE_ZOOM,
      Math.min(Math.trunc(camera.zoom), MAX_TILE_ZOOM)
    );
    const minTile = tilebelt.pointToTile(bbox[0], bbox[3], z); // top-left
    const maxTile = tilebelt.pointToTile(bbox[2], bbox[1], z); // bottom-right

    const [minX, maxX] = [Math.max(minTile[0], 0), maxTile[0]];
    const [minY, maxY] = [Math.max(minTile[1], 0), maxTile[1]];

    let tilesToLoad: tilebelt.Tile[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        tilesToLoad.push([x, y, z]);
      }
    }

    const bufferedTiles: tilebelt.Tile[] = [];
    for (let bufX = minX - TILE_BUFFER; bufX <= maxX + TILE_BUFFER; bufX++) {
      for (let bufY = minY - TILE_BUFFER; bufY <= maxY + TILE_BUFFER; bufY++) {
        bufferedTiles.push([bufX, bufY, z]);

        // 2 levels of parent tiles
        bufferedTiles.push(tilebelt.getParent([bufX, bufY, z]));
        bufferedTiles.push(
          tilebelt.getParent(tilebelt.getParent([bufX, bufY, z]))
        );
      }
    }

    return [
      ...new Set([
        ...tilesToLoad.map((tile) => tile.join("/")),
        ...bufferedTiles.map((tile) => tile.join("/")),
      ]),
    ].filter((tile) => {
      const [x, y, z] = tile.split("/").map(Number);
      const N = Math.pow(2, z);
      const isValidX = x >= 0 && x < N;
      const isValidY = y >= 0 && y < N;
      const isValidZ = z >= 0 && z <= MAX_TILE_ZOOM;

      return isValidX && isValidY && isValidZ;
    });
  }
}

const map = new CreateMap();
map.run("canvas", false, () => {});
