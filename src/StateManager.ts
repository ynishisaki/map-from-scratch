export default class StateManager {
  private camera: { x: number; y: number; zoom: number };
  private tileKey: string;
  private tilesInView: { x: number; y: number; zoom: number }[];
  private tileData: {
    [key: string]: {
      [key: string]: Float32Array[];
    };
  };

  constructor() {
    this.camera = { x: 0, y: 0, zoom: 0 };
    this.tileKey = "";
    this.tilesInView = [];
    this.tileData = {};
  }

  getCamera() {
    return this.camera;
  }

  setCamera(x: number, y: number, zoom: number) {
    this.camera = { x, y, zoom };
  }

  getTileKey() {
    return this.tileKey;
  }

  setTileKey(key: string) {
    this.tileKey = key;
  }

  getTilesInView() {
    return this.tilesInView;
  }

  setTilesInView(tiles: { x: number; y: number; zoom: number }[]) {
    this.tilesInView = tiles;
  }

  getTileData() {
    return this.tileData;
  }

  setTileData(data: { [key: string]: { [key: string]: Float32Array[] } }) {
    this.tileData = data;
  }

  clearTileData() {
    this.tileData = {};
  }
}
