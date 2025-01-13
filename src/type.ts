export type Camera = {
  x: number;
  y: number;
  zoom: number;
};
export type TileLayerData = { layer: string; vertices: Float32Array }[];
export type TileData = {
  [key: string]: TileLayerData | undefined;
};
