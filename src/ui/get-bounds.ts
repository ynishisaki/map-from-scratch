import { TILE_BBOX, TILE_SIZE } from "./constants";
import MercatorCoordinate from "./mercator-coordinate";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function getBounds(canvas: HTMLCanvasElement, camera: Camera) {
  const zoomScale = Math.pow(2, camera.zoom);

  const px = (1 + camera.x) / 2;
  const py = (1 - camera.y) / 2;

  const wx = px * TILE_SIZE;
  const wy = py * TILE_SIZE;

  const zx = wx * zoomScale;
  const zy = wy * zoomScale;

  let x1 = zx - canvas.width / 2;
  let y1 = zy + canvas.height / 2;
  let x2 = zx + canvas.width / 2;
  let y2 = zy - canvas.height / 2;

  x1 = x1 / zoomScale / TILE_SIZE;
  y1 = y1 / zoomScale / TILE_SIZE;
  x2 = x2 / zoomScale / TILE_SIZE;
  y2 = y2 / zoomScale / TILE_SIZE;

  const bbox = [
    Math.max(MercatorCoordinate.lngFromMercatorX(x1), TILE_BBOX[0]), // left
    Math.max(MercatorCoordinate.latFromMercatorY(y1), TILE_BBOX[1]), // bottom
    Math.min(MercatorCoordinate.lngFromMercatorX(x2), TILE_BBOX[2]), // right
    Math.min(MercatorCoordinate.latFromMercatorY(y2), TILE_BBOX[3]), // top
  ];

  return bbox;
}
