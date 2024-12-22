import earcut, { flatten } from "earcut";
import { Geometry, Position } from "geojson";
import MercatorCoordinate from "./mercator-coordinate";

export default function geometryToVertices(geometry: Geometry) {
  const verticesFromPolygon = (
    coordinates: Position[][],
    n?: number
  ): Float32Array => {
    const data = flatten(coordinates);
    const triangles = earcut(data.vertices, data.holes, 2);

    const vertices = new Float32Array(triangles.length * 2);
    for (let i = 0; i < triangles.length; i++) {
      const point = triangles[i];
      const lng = data.vertices[point * 2];
      const lat = data.vertices[point * 2 + 1];
      const [x, y] = MercatorCoordinate.fromLngLat([lng, lat]);
      vertices[i * 2] = x;
      vertices[i * 2 + 1] = y;
    }
    return vertices;
  };

  if (geometry.type === "Polygon") {
    return verticesFromPolygon(geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    const positions: Float32Array[] = [];
    geometry.coordinates.forEach((polygon, i) => {
      const coordinates = [polygon[0]];
      const vertices = verticesFromPolygon(coordinates, i);

      vertices.forEach((vertex) => {
        positions[0][positions.length] = vertex;
      });
    });
    return Float32Array.from(positions as any);
  }

  return new Float32Array();
}
