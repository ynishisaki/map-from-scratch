import * as tilebelt from "@mapbox/tilebelt";
import { MAX_TILE_ZOOM } from "./constants";
import getBounds from "./get-bounds";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function getTilesInView(
  camera: Camera,
  canvas: HTMLCanvasElement
) {
  const bbox = getBounds(camera, canvas);

  const z = Math.min(Math.trunc(camera.zoom), MAX_TILE_ZOOM);
  const minTile = tilebelt.pointToTile(bbox[0], bbox[3], z); // top-left
  const maxTile = tilebelt.pointToTile(bbox[2], bbox[1], z); // bottom-right

  const tilesInView = [];
  const [minX, maxX] = [Math.max(minTile[0], 0), maxTile[0]];
  const [minY, maxY] = [Math.max(minTile[1], 0), maxTile[1]];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tilesInView.push([x, y, z]);
    }
  }

  return tilesInView;
}
