export const INITIAL_SETTINGS = {
  lnglat: [139.763275, 35.638126] as const,
  zoom: 10,
} as const;

export const TILE_URL = process.env.TILE_BASE_URL || "";
export const TILE_SIZE = 512;

export const MAX_TILE_ZOOM = 16;

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 18;

export const LAYERS = {
  waterarea: [190, 210, 255, 255],
} as const;
