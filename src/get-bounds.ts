import { TILE_SIZE } from "./constants";
import MercatorCoordinate from "./mercator-coordinate";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function getBounds(camera: Camera, canvas: HTMLCanvasElement) {
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
    MercatorCoordinate.lngFromMercatorX(x1), // left
    MercatorCoordinate.latFromMercatorY(y1), // bottom
    MercatorCoordinate.lngFromMercatorX(x2), // right
    MercatorCoordinate.latFromMercatorY(y2), // top
  ];

  return bbox;
}
