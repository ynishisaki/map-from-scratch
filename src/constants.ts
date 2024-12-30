export const TILE_URL = process.env.TILE_BASE_URL || "";
export const TILE_SIZE = 512;

// export const MAX_TILE_ZOOM = 14;

// export const LAYERS = {
//   water: [180, 240, 250, 255],
//   landcover: [202, 246, 193, 255],
//   park: [202, 255, 193, 255],
// } as const;

export const MAX_TILE_ZOOM = 2;

export const MIN_ZOOM = 0;
export const MAX_ZOOM = 16;

export const LAYERS = {
  centroids: [180, 240, 250, 255],
  countries: [202, 246, 193, 255],
  geolines: [202, 255, 193, 255],
} as const;
