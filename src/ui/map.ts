import * as tilebelt from "@mapbox/tilebelt";
import { mat3, vec3 } from "gl-matrix";
import Hammer from "hammerjs";
import Stats from "stats.js";
import fetchTile from "../source/fetch-tile";
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

export type MapOptions = {
  container: HTMLElement | string;
  center?: [number, number];
  zoom?: number;
};

export class Map {
  private camera: Camera;
  private cacheStats: { cacheHits: number; tilesLoaded: number };
  private tiles: TileData;
  private tilesInView: tilebelt.Tile[];
  private tileWorker: Worker;
  private matrix: mat3;
  private timestamp: number;
  private slowCount: number;
  private frameStats: {
    drawCalls: number;
    vertices: number;
  };
  private startX: number;
  private startY: number;
  private canvas: HTMLCanvasElement | null;
  private hammer: HammerManager | null;
  private loopRunning: boolean;
  private overlay: HTMLElement | null;
  private statsWidget: HTMLElement | null;

  constructor(options: MapOptions) {
    const resolvedOptions: Required<MapOptions> = {
      center: [0, 0],
      zoom: 0,
      ...options,
    };

    const [initialX, initialY] = MercatorCoordinate.fromLngLat(
      resolvedOptions.center
    );
    this.camera = { x: initialX, y: initialY, zoom: resolvedOptions.zoom };

    if (typeof resolvedOptions.container === "string") {
      this.canvas = document.getElementById(
        resolvedOptions.container
      ) as HTMLCanvasElement | null;
      if (!this.canvas) {
        throw new Error(`Container '${resolvedOptions.container}' not found.`);
      }
    } else if (resolvedOptions.container instanceof HTMLElement) {
      this.canvas = resolvedOptions.container.querySelector("canvas");
      if (!this.canvas) {
        throw new Error(
          "Invalid type: 'container' must be a String or HTMLElement."
        );
      }
    } else {
      throw new Error(
        "Invalid type: 'container' must be a String or HTMLElement."
      );
    }

    this.cacheStats = { cacheHits: 0, tilesLoaded: 0 };
    this.tiles = {};
    this.tilesInView = [];
    this.tileWorker = new Worker(new URL("worker.js", import.meta.url), {
      type: "module",
    });
    this.matrix = mat3.create();
    this.timestamp = 0;
    this.slowCount = 0;
    this.frameStats = { drawCalls: 0, vertices: 0 };
    this.startX = 0;
    this.startY = 0;

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

    this.tilesInView = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        this.tilesInView.push([x, y, z]);
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
        ...this.tilesInView.map((tile) => tile.join("/")),
        ...bufferedTiles.map((tile) => tile.join("/")),
      ]),
    ].filter((tile) => {
      const [x, y, z] = tile.split("/").map(Number);
      const N = Math.pow(2, z);
      const isValidX = x >= 0 && x < N;
      const isValidY = y >= 0 && y < N;
      const isValidZ = z >= MIN_TILE_ZOOM && z <= MAX_TILE_ZOOM;

      return isValidX && isValidY && isValidZ;
    });
  }

  private async updateTiles(canvas: HTMLCanvasElement, camera: Camera) {
    const tilesToLoad = this.getTilesToLoad(canvas, camera);

    const inView = this.tilesInView.map((t) => t.join("/"));
    tilesToLoad.forEach(async (tile) => {
      if (this.tiles[tile]) {
        return;
      }

      this.tiles[tile] = [];
      try {
        if (inView.includes(tile)) {
          const tileData = await fetchTile({
            tile,
            layers: {
              ...(LAYERS as unknown as {
                [key: string]: [number, number, number, number];
              }),
            },
            url: TILE_URL,
          });
          this.tiles[tile] = tileData;
        } else {
          this.tileWorker.postMessage({ tile, layers: LAYERS, url: TILE_URL });
        }
      } catch (e) {
        console.warn(`Error loaoting tile ${tile}`, e);
        this.tiles[tile] = undefined;
      }
    });

    return;
  }

  private getPlaceholderTile(tile: tilebelt.Tile) {
    const parent = tilebelt.getParent(tile)?.join("/");
    const parentFeatureSet = this.tiles[parent];
    if (parentFeatureSet && parentFeatureSet.length > 0) {
      return parentFeatureSet;
    }

    const childFeatureSets: TileLayerData[] = [];
    const children = (tilebelt.getChildren(tile) || []).map((t) => t.join("/"));
    children.forEach((child) => {
      const featureSet = this.tiles[child];
      if (featureSet && featureSet.length > 0) {
        childFeatureSets.push(featureSet);
      }
    });

    return childFeatureSets;
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

  public async run(
    canvasId: string,
    mobile: boolean = false,
    abort: (() => void) | null = null
  ) {
    this.loopRunning = true;
    this.timestamp = 0;
    this.slowCount = 0;

    const stats = new Stats();

    // this.canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    // if (!this.canvas) {
    //   throw new Error(`No canvas element with id ${canvasId}`);
    // }

    const gl = this.canvas.getContext("webgl");
    if (!gl) {
      throw new Error("No WebGL context found");
    }

    this.addAttribution();

    this.overlay = document.getElementById(`${canvasId}-overlay`);

    this.tileWorker.onmessage = (event) => {
      const { tile, tileData } = event.data;
      this.tiles[tile] = tileData;
    };
    this.tileWorker.onerror = (error) => {
      console.error("Uncaught worker error.", error);
    };

    window.addEventListener("resize", this.resizeCanvas.bind(this));
    this.resizeCanvas();

    this.updateMatrix();
    await this.updateTiles(this.canvas, this.camera);

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

      this.frameStats = { drawCalls: 0, vertices: 0 };
      stats.begin();

      const matrixLocation = gl.getUniformLocation(program, "u_matrix");
      gl.uniformMatrix3fv(matrixLocation, false, this.matrix);

      this.tilesInView.forEach((tile) => {
        if (!this.canvas) return;

        let tileData: any = this.tiles[tile.join("/")];

        if (tileData?.length === 0) {
          tileData = this.getPlaceholderTile(tile);
        }

        (tileData || []).forEach((tileLayer: any) => {
          const { layer, vertices } = tileLayer;

          if (LAYERS[layer as keyof typeof LAYERS]) {
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

        const tileVertices = geometryToVertices(tilebelt.tileToGeoJSON(tile));
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
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

    await this.updateTiles(this.canvas, this.camera);
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

    await this.updateTiles(this.canvas, this.camera);
  }
}
