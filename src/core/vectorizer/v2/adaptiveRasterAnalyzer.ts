export interface RgbaBitmap {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ArtworkAnalysis {
  width: number;
  height: number;
  pixelCount: number;
  alphaPresence: boolean;
  approximateColorPressure: number;
  edgeDensity: number;
  noiseIndicator: number;
}

export function analyzeArtwork(bitmap: RgbaBitmap): ArtworkAnalysis {
  const colors = new Set<string>();
  let alphaPresence = false;
  let strongEdges = 0;
  let midContrastTransitions = 0;

  for (let index = 0; index < bitmap.width * bitmap.height; index++) {
    const offset = index * 4;
    const alpha = bitmap.data[offset + 3];
    if (alpha === 0) continue;
    if (alpha < 255) alphaPresence = true;
    colors.add(`${bitmap.data[offset] >> 4},${bitmap.data[offset + 1] >> 4},${bitmap.data[offset + 2] >> 4}`);

    if (index % bitmap.width !== 0) {
      const difference = Math.abs(bitmap.data[offset] - bitmap.data[offset - 4])
        + Math.abs(bitmap.data[offset + 1] - bitmap.data[offset - 3])
        + Math.abs(bitmap.data[offset + 2] - bitmap.data[offset - 2]);
      if (difference > 60) strongEdges++;
      else if (difference > 15) midContrastTransitions++;
    }
  }

  const pixelCount = bitmap.width * bitmap.height;
  const denominator = Math.max(1, pixelCount);
  return {
    width: bitmap.width,
    height: bitmap.height,
    pixelCount,
    alphaPresence,
    approximateColorPressure: colors.size,
    edgeDensity: strongEdges / denominator,
    noiseIndicator: midContrastTransitions / denominator,
  };
}
