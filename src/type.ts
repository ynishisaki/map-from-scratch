export type Camera = {
  x: number;
  y: number;
  zoom: number;
};
export type TileData = {
  [key: string]: { layer: string; vertices: Float32Array }[];
};
