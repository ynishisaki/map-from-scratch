export default function getClipSpacePosition(
  // e: MouseEvent | HammerInput | WheelEvent,
  e: any,
  canvas: HTMLCanvasElement
) {
  const [x, y] = [
    e.center?.x || e.clientX, //
    e.center?.y || e.clientY,
  ];

  const rect = canvas.getBoundingClientRect();
  const cssX = x - rect.left;
  const cssY = y - rect.top;

  const normalizedX = cssX / canvas.clientWidth;
  const normalizedY = cssY / canvas.clientHeight;

  const clipX = normalizedX * 2 - 1;
  const clipY = normalizedY * -2 + 1;

  return [clipX, clipY];
}
