import getBounds from "./get-bounds";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function atLimits(canvas: HTMLCanvasElement, camera: Camera) {
  const bbox = getBounds(canvas, camera);
  return (
    bbox[0] === -180 ||
    bbox[1] === -85.05 ||
    bbox[2] === 180 ||
    bbox[3] === 85.05
  );
}
