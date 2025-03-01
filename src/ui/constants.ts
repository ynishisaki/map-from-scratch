export const INITIAL_SETTINGS = {
  lnglat: [139.763275, 35.638126] as const,
  zoom: 10,
} as const;

export const TILE_BBOX = [
  122.440567, // left
  22.546489, // bottom
  149.346256, // right
  45.418094, // top
];

export const TILE_URL = process.env.TILE_BASE_URL || "";
export const TILE_ATTRIBUTION = `<a href="https://github.com/gsi-cyberjapan/gsimaps-vector-experiment?tab=readme-ov-file">国土地理院ベクトルタイル提供実験</a>`;
export const TILE_SIZE = 512;
export const TILE_BUFFER = 1;

export const MIN_TILE_ZOOM = 7;
export const MAX_TILE_ZOOM = 16;

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 18;

export const LAYERS = {
  waterarea: [190, 210, 255, 255],
} as const;
