import * as tilebelt from "@mapbox/tilebelt";
import { VectorTile } from "@mapbox/vector-tile";
import axios from "axios";
import Protobuf from "pbf";
import { LAYERS, MAX_TILE_ZOOM, TILE_URL } from "./constants";
import geometryToVertices from "./geometry-to-vertices";
import getBounds from "./get-bounds";
import { Camera, TileData } from "./type";

let tileKey: string = "";

export default async function updateTiles(
  canvas: HTMLCanvasElement,
  camera: Camera,
  tileData: TileData
) {
  const tilesInView = getTilesInView(canvas, camera);

  const key = tilesInView.map((t) => t.join("/")).join(";");
  console.log("key", key);
  if (tileKey !== key) {
    tileData = {};

    tilesInView.forEach(async (tile) => {
      const [x, y, z] = tile;

      const reqStart = Date.now();
      const res = await axios.get(`${TILE_URL}/${z}/${x}/${y}.pbf`, {
        responseType: "arraybuffer",
      });

      const pbf = new Protobuf(res.data);
      const vectorTile = new VectorTile(pbf);

      const layers: { layer: string; vertices: Float32Array }[] = [];
      Object.keys(LAYERS).forEach((layer) => {
        if (vectorTile?.layers?.[layer]) {
          const numFeatures = vectorTile.layers[layer]?._features?.length || 0;

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
      tileData[tile.join("/")] = layers;
    });
    tileKey = key;
  }

  return {
    tilesInView,
    tileData,
    tileKey,
  };
}

function getTilesInView(canvas: HTMLCanvasElement, camera: Camera) {
  const bbox = getBounds(canvas, camera);

  const z = Math.min(Math.trunc(camera.zoom), MAX_TILE_ZOOM);
  const minTile = tilebelt.pointToTile(bbox[0], bbox[3], z); // top-left
  const maxTile = tilebelt.pointToTile(bbox[2], bbox[1], z); // bottom-right

  const [minX, maxX] = [Math.max(minTile[0], 0), maxTile[0]];
  const [minY, maxY] = [Math.max(minTile[1], 0), maxTile[1]];

  const tilesInView: tilebelt.Tile[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tilesInView.push([x, y, z]);
    }
  }

  return tilesInView;
}
