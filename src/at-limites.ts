import getBounds from "./get-bounds";

type Camera = {
  x: number;
  y: number;
  zoom: number;
};

export default function atLimits(camera: Camera, canvas: HTMLCanvasElement) {
  const bbox = getBounds(camera, canvas);
  return (
    bbox[0] === -180 ||
    bbox[1] === -85.05 ||
    bbox[2] === 180 ||
    bbox[3] === 85.05
  );
}
