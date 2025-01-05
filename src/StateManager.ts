import { Camera, TileData } from "./type";

export default class StateManager {
  private camera: Camera;
  private tilesInView: { x: number; y: number; zoom: number }[];
  private tileData: TileData;

  constructor() {
    this.camera = { x: 0, y: 0, zoom: 0 };
    this.tilesInView = [];
    this.tileData = {};
  }

  getCamera() {
    return this.camera;
  }

  setCamera(camera: Camera) {
    this.camera = camera;
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

  setTileData(data: TileData) {
    this.tileData = data;
  }

  clearTileData() {
    this.tileData = {};
  }
}
