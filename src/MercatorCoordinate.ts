class MercatorCoordinate {
  static mercatorXfromLng(lng: number): number {
    return (180 + lng) / 360;
  }

  static mercatorYfromLat(lat: number): number {
    return (
      (180 -
        (180 / Math.PI) *
          Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) /
      360
    );
  }

  static fromLngLat(lngLat) {
    let x = MercatorCoordinate.mercatorXfromLng(lngLat[0]);
    let y = MercatorCoordinate.mercatorYfromLat(lngLat[1]);

    // adjust so relative to origin at center of viewport, instead of top-left
    x = -1 + x * 2;
    y = 1 - y * 2;

    return [x, y];
  }
}

// test
const lngLat: [number, number] = [139.6917, 35.6895]; // 東京の緯度経度
const mercatorXY = MercatorCoordinate.fromLngLat(lngLat);
console.log(mercatorXY); // [0.5547547222222222, 0.3542760416666667]
