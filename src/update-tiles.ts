import * as tilebelt from "@mapbox/tilebelt";
import { VectorTile } from "@mapbox/vector-tile";
import axios from "axios";
import Protobuf from "pbf";
import { LAYERS, MAX_TILE_ZOOM } from "./constants";
import geometryToVertices from "./geometry-to-vertices";
import getBounds from "./get-bounds";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

let tileKey: string = "";
let tilesInView = [];
let tileData: {
  [key: string]: {
    [key: string]: Float32Array[];
  };
} = {};

export default async function updateTiles(
  camera: Camera,
  canvas: HTMLCanvasElement
) {
  const tilesInView = getTilesInView(camera, canvas);

  const key = tilesInView.map((t) => t.join("/")).join(":");
  if (tileKey !== key) {
    tileData = {};

    const tileReqs = tilesInView.map(async (tile) => {
      const [x, y, z] = tile;

      const url = process.env.TILE_BASE_URL;
      console.log("url", url);
      const res = await axios.get(`${url}/${z}/${x}/${y}.pbf`, {
        responseType: "arraybuffer",
      });

      const pbf = new Protobuf(res.data);
      const vectorTile = new VectorTile(pbf);

      const layers: { [key: string]: Float32Array<ArrayBufferLike>[] } = {};
      Object.keys(LAYERS).forEach((layer) => {
        if (vectorTile?.layers?.[layer]) {
          const numFeatures = vectorTile.layers[layer]?._features?.length || 0;

          const features = [];
          for (let i = 0; i < numFeatures; i++) {
            const geojson = vectorTile.layers[layer]
              .feature(i)
              .toGeoJSON(x, y, z);

            const vertices = geometryToVertices(geojson.geometry);

            features.push(vertices);
          }

          layers[layer] = features;
        }
      });
      tileData[tile.join(".")] = layers;
    });

    await Promise.all(tileReqs);
    tileKey = key;
  }

  return {
    tilesInView,
    tileData,
    tileKey,
  };
}

function getTilesInView(camera: Camera, canvas: HTMLCanvasElement) {
  const bbox = getBounds(camera, canvas);

  const z = Math.min(Math.trunc(camera.zoom), MAX_TILE_ZOOM);
  const minTile = tilebelt.pointToTile(bbox[0], bbox[3], z); // top-left
  const maxTile = tilebelt.pointToTile(bbox[2], bbox[1], z); // bottom-right

  const [minX, maxX] = [Math.max(minTile[0], 0), maxTile[0]];
  const [minY, maxY] = [Math.max(minTile[1], 0), maxTile[1]];

  // const tilesInView: tilebelt.Tile = [];
  // for (let x = minX; x <= maxX; x++) {
  //   for (let y = minY; y <= maxY; y++) {
  //     tilesInView.push([x, y, z]);
  //   }
  // }
  const tilesInView = Array.from({ length: maxX - minX + 1 }, (_, i) =>
    Array.from({ length: maxY - minY + 1 }, (_, j) => [minX + i, minY + j, z])
  ).flat() as tilebelt.Tile[];

  return tilesInView;
}
