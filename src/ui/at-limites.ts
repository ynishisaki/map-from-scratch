import { TILE_BBOX } from "./constants";
import getBounds from "./get-bounds";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function atLimits(canvas: HTMLCanvasElement, camera: Camera) {
  const bbox = getBounds(canvas, camera);
  return (
    bbox[0] === TILE_BBOX[0] ||
    bbox[1] === TILE_BBOX[1] ||
    bbox[2] === TILE_BBOX[2] ||
    bbox[3] === TILE_BBOX[3]
  );
}
