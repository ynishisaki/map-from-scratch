import { VectorTile } from "@mapbox/vector-tile";
import axios from "axios";
import Protobuf from "pbf";
import geometryToVertices from "../ui/geometry-to-vertices";
import { TileLayerData } from "../ui/type";

type FetchTile = {
  tile: string;
  layers: { [key: string]: [number, number, number, number] };
  url: string;
};
export const fetchTile = async ({ tile, layers, url }: FetchTile) => {
  const [x, y, z] = tile.split("/").map(Number);

  const res = await axios.get(getTileURL({ url, x, y, z }), {
    responseType: "arraybuffer",
  });

  const pbf = new Protobuf(res.data);
  const vectorTile = new VectorTile(pbf);

  const tileData: TileLayerData = [];
  Object.keys(layers).forEach((layer) => {
    if (vectorTile?.layers?.[layer]) {
      const numFeatures = vectorTile.layers[layer]?._features?.length || 0;

      const vertices = [];
      for (let i = 0; i < numFeatures; i++) {
        const geojson = vectorTile.layers[layer].feature(i).toGeoJSON(x, y, z);
        vertices.push(...geometryToVertices(geojson.geometry));
      }
      tileData.push({ layer, vertices: Float32Array.from(vertices) });
    }
  });
  return tileData;
};

type GetTileURL = { url: string; x: number; y: number; z: number };
const getTileURL = ({ url, x, y, z }: GetTileURL) => {
  return url
    .replace("{x}", x.toString())
    .replace("{y}", y.toString())
    .replace("{z}", z.toString());
};

export default fetchTile;
