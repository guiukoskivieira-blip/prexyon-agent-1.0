import type { LabColor, RegionGraphMetrics, RgbaRaster } from './types';

interface SeedComponent {
  id: number;
  pixelCount: number;
  nominalColor: [number, number, number];
  nominalLab: LabColor;
  centerX: number;
  centerY: number;
  neighborComponentIds: number[];
}

export interface RegionGraphRasterResult {
  rgba: Uint8Array;
  metrics: RegionGraphMetrics;
}

const f = Math.fround;

function rgbToLabV61(r: number, g: number, b: number): LabColor {
  let num = f(f(r) / 255);
  let num2 = f(f(g) / 255);
  let num3 = f(f(b) / 255);

  num = num > 0.04045 ? f(Math.pow(f(f(num + 0.055) / 1.055), 2.4)) : f(num / 12.92);
  num2 = num2 > 0.04045 ? f(Math.pow(f(f(num2 + 0.055) / 1.055), 2.4)) : f(num2 / 12.92);
  num3 = num3 > 0.04045 ? f(Math.pow(f(f(num3 + 0.055) / 1.055), 2.4)) : f(num3 / 12.92);

  const num4 = f(f(f(f(num * 0.4124564) + f(num2 * 0.3575761)) + f(num3 * 0.1804375)) / 0.95047);
  const num5 = f(f(f(num * 0.2126729) + f(num2 * 0.7151522)) + f(num3 * 0.072175));
  const num6 = f(f(f(f(num * 0.0193339) + f(num2 * 0.119192)) + f(num3 * 0.9503041)) / 1.08883);

  const num7 = num4 > 0.008856 ? f(Math.pow(num4, 1.0 / 3.0)) : f(f(7.787 * num4) + 0.13793103);
  const num8 = num5 > 0.008856 ? f(Math.pow(num5, 1.0 / 3.0)) : f(f(7.787 * num5) + 0.13793103);
  const num9 = num6 > 0.008856 ? f(Math.pow(num6, 1.0 / 3.0)) : f(f(7.787 * num6) + 0.13793103);

  return {
    L: f(f(116 * num8) - 16),
    a: f(500 * f(num7 - num8)),
    b: f(200 * f(num8 - num9)),
  };
}

function deltaEV61(c1L: number, c1a: number, c1b: number, c2L: number, c2a: number, c2b: number): number {
  const num = f(c1L - c2L);
  const num2 = f(c1a - c2a);
  const num3 = f(c1b - c2b);
  return f(Math.sqrt(f(f(f(num * num) + f(num2 * num2)) + f(num3 * num3))));
}

class FastQueue {
  private buffer: Int32Array;
  private head = 0;
  private tail = 0;
  private mask: number;

  constructor(initialCapacity = 1048576) {
    let cap = 1;
    while (cap < initialCapacity) cap <<= 1;
    this.buffer = new Int32Array(cap);
    this.mask = cap - 1;
  }

  push(val: number) {
    this.buffer[this.tail] = val;
    this.tail = (this.tail + 1) & this.mask;
    if (this.tail === this.head) {
      this.grow();
    }
  }

  pop(): number {
    const val = this.buffer[this.head];
    this.head = (this.head + 1) & this.mask;
    return val;
  }

  get empty(): boolean {
    return this.head === this.tail;
  }

  clear() {
    this.head = 0;
    this.tail = 0;
  }

  private grow() {
    const oldCap = this.buffer.length;
    const newCap = oldCap << 1;
    const newBuf = new Int32Array(newCap);
    for (let i = 0; i < oldCap; i++) {
      newBuf[i] = this.buffer[(this.head + i) & this.mask];
    }
    this.head = 0;
    this.tail = oldCap;
    this.mask = newCap - 1;
    this.buffer = newBuf;
  }
}

export function reconstructRegionGraphV61(raster: RgbaRaster): RegionGraphRasterResult {
  const width = raster.width;
  const height = raster.height;
  const total = width * height;
  const rawRgba = raster.data;

  if (rawRgba.length !== total * 4) {
    throw new Error('Raster RGBA inválido para Region Graph.');
  }

  // 1. Flatten RGB and compute Lab (Float32Array)
  const rArr = new Uint8Array(total);
  const gArr = new Uint8Array(total);
  const bArr = new Uint8Array(total);
  const labL = new Float32Array(total);
  const labA = new Float32Array(total);
  const labB = new Float32Array(total);

  for (let i = 0; i < total; i++) {
    const r = rawRgba[i * 4];
    const g = rawRgba[i * 4 + 1];
    const b = rawRgba[i * 4 + 2];
    rArr[i] = r;
    gArr[i] = g;
    bArr[i] = b;
    const lab = rgbToLabV61(r, g, b);
    labL[i] = lab.L;
    labA[i] = lab.a;
    labB[i] = lab.b;
  }

  // 2. Seed Detection
  const isSeed = new Uint8Array(total);
  const num6 = 1;
  for (let y = num6; y < height - num6; y++) {
    const yOff = y * width;
    for (let x = num6; x < width - num6; x++) {
      const num7 = yOff + x;
      const cL = labL[num7];
      const ca = labA[num7];
      const cb = labB[num7];
      let num8 = 0;

      for (let k = -num6; k <= num6; k++) {
        const nyOff = (y + k) * width;
        for (let l = -num6; l <= num6; l++) {
          const num9 = nyOff + (x + l);
          const num10 = deltaEV61(cL, ca, cb, labL[num9], labA[num9], labB[num9]);
          if (num10 > num8) {
            num8 = num10;
          }
        }
      }

      if (num8 < 3.8) {
        isSeed[num7] = 1;
      }
    }
  }

  // 3. Connected Component Labeling of Seeds (Two-Phase exact C# translation)
  const seedCompMap = new Int32Array(total);
  let currentCompId = 0;
  const compPixelLists: Int32Array[] = [new Int32Array(0)]; // index 0 unused
  const ccQueue = new Int32Array(total);

  const dx4 = [1, -1, 0, 0];
  const dy4 = [0, 0, 1, -1];

  for (let m = 0; m < total; m++) {
    if (!isSeed[m] || seedCompMap[m] !== 0) {
      continue;
    }

    currentCompId++;
    let qHead = 0;
    let qTail = 0;
    ccQueue[qTail++] = m;
    seedCompMap[m] = currentCompId;

    const rootL = labL[m];
    const rootA = labA[m];
    const rootB = labB[m];

    while (qHead < qTail) {
      const num14 = ccQueue[qHead++];
      const cy = (num14 / width) | 0;
      const cx = num14 % width;

      for (let n = 0; n < 4; n++) {
        const nx = cx + dx4[n];
        const ny = cy + dy4[n];
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const num9 = ny * width + nx;
          if (isSeed[num9] && seedCompMap[num9] === 0) {
            if (deltaEV61(rootL, rootA, rootB, labL[num9], labA[num9], labB[num9]) < 5.0) {
              seedCompMap[num9] = currentCompId;
              ccQueue[qTail++] = num9;
            }
          }
        }
      }
    }

    compPixelLists.push(ccQueue.slice(0, qTail));
  }

  // Filter tiny seeds (< 40 pixels) and build SeedComponents
  const dictionary = new Map<number, SeedComponent>();
  let validCompCount = 0;
  const finalCompMap = new Int32Array(total);

  for (let num20 = 1; num20 <= currentCompId; num20++) {
    const list3 = compPixelLists[num20];
    if (list3.length < 40) {
      for (let j = 0; j < list3.length; j++) {
        seedCompMap[list3[j]] = 0;
      }
      continue;
    }

    validCompCount++;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumX = 0;
    let sumY = 0;

    for (let j = 0; j < list3.length; j++) {
      const item3 = list3[j];
      finalCompMap[item3] = validCompCount;
      sumR += rArr[item3];
      sumG += gArr[item3];
      sumB += bArr[item3];
      sumX += (item3 % width);
      sumY += (item3 / width) | 0;
    }

    const b3 = Math.floor(sumR / list3.length);
    const b4 = Math.floor(sumG / list3.length);
    const b5 = Math.floor(sumB / list3.length);

    dictionary.set(validCompCount, {
      id: validCompCount,
      pixelCount: list3.length,
      nominalColor: [b3, b4, b5],
      nominalLab: rgbToLabV61(b3, b4, b5),
      centerX: sumX / list3.length,
      centerY: sumY / list3.length,
      neighborComponentIds: [],
    });
  }

  // 4. RAG Construction via Geodesic Multi-Source Expansion
  const ownerRegion = new Int32Array(total);
  const costField = new Float32Array(total);
  const queue = new FastQueue(262144);

  for (let m = 0; m < total; m++) {
    if (finalCompMap[m] > 0) {
      ownerRegion[m] = finalCompMap[m];
      costField[m] = 0;
    } else {
      costField[m] = Infinity;
    }
  }

  for (let m = 0; m < total; m++) {
    if (ownerRegion[m] > 0) {
      const cy = (m / width) | 0;
      const cx = m % width;
      if (
        (cx > 0 && finalCompMap[m - 1] === 0) ||
        (cx < width - 1 && finalCompMap[m + 1] === 0) ||
        (cy > 0 && finalCompMap[m - width] === 0) ||
        (cy < height - 1 && finalCompMap[m + width] === 0)
      ) {
        queue.push(m);
      }
    }
  }

  const hashSet = new Set<string>();

  while (!queue.empty) {
    const num14 = queue.pop();
    const num26 = ownerRegion[num14]; // cReg
    const num27 = costField[num14]; // cCost
    const num15 = (num14 / width) | 0;
    const num16 = num14 % width;
    const nominalLab = dictionary.get(num26)!.nominalLab;

    for (let n = 0; n < 4; n++) {
      const num17 = num16 + dx4[n];
      const num18 = num15 + dy4[n];
      if (num17 < 0 || num17 >= width || num18 < 0 || num18 >= height) {
        continue;
      }

      const num9 = num18 * width + num17;
      const num28 = ownerRegion[num9]; // nReg

      if (num28 === 0) {
        const num29 = deltaEV61(labL[num9], labA[num9], labB[num9], nominalLab.L, nominalLab.a, nominalLab.b);
        const num30 = f(1 + f(0.05 * num29));
        const nextCost = f(num27 + num30);
        if (nextCost < costField[num9]) {
          costField[num9] = nextCost;
          ownerRegion[num9] = num26;
          queue.push(num9);
        }
      } else if (num28 !== num26) {
        const num31 = Math.min(num26, num28);
        const num32 = Math.max(num26, num28);
        const item = num31 + '-' + num32;
        if (!hashSet.has(item)) {
          hashSet.add(item);
          const compA = dictionary.get(num26)!;
          const compB = dictionary.get(num28)!;
          if (compA.neighborComponentIds.indexOf(num28) === -1) {
            compA.neighborComponentIds.push(num28);
          }
          if (compB.neighborComponentIds.indexOf(num26) === -1) {
            compB.neighborComponentIds.push(num26);
          }
        }
      }
    }
  }

  // 5. Boundary Assignment (Strict Pair)
  const v61AssignedRegion = new Int32Array(total);

  for (let m = 0; m < total; m++) {
    if (finalCompMap[m] > 0) {
      v61AssignedRegion[m] = finalCompMap[m];
      continue;
    }

    const num33 = ownerRegion[m];
    const seedComponent2 = dictionary.get(num33)!;
    let num34 = num33;
    const cy = (m / width) | 0;
    const cx = m % width;

    for (let num35 = 1; num35 <= 3; num35++) {
      if (num34 !== num33) break;
      for (let k = -num35; k <= num35; k++) {
        if (num34 !== num33) break;
        for (let l = -num35; l <= num35; l++) {
          const num17 = cx + l;
          const num18 = cy + k;
          if (num17 >= 0 && num17 < width && num18 >= 0 && num18 < height) {
            const num28 = ownerRegion[num18 * width + num17];
            if (num28 > 0 && num28 !== num33 && seedComponent2.neighborComponentIds.indexOf(num28) !== -1) {
              num34 = num28;
              break;
            }
          }
        }
      }
    }

    if (num34 === num33 && seedComponent2.neighborComponentIds.length > 0) {
      num34 = seedComponent2.neighborComponentIds[0];
    }

    const seedComponent3 = dictionary.get(num34)!;
    const pL = labL[m];
    const pa = labA[m];
    const pb = labB[m];

    let num36 = 0.5;
    const num37 = f(seedComponent2.nominalLab.L - seedComponent3.nominalLab.L);
    const num38 = f(seedComponent2.nominalLab.a - seedComponent3.nominalLab.a);
    const num39 = f(seedComponent2.nominalLab.b - seedComponent3.nominalLab.b);
    const num40 = f(f(f(num37 * num37) + f(num38 * num38)) + f(num39 * num39));

    if (num40 > 0.0001) {
      const num41 = f(
        f(f(pL - seedComponent3.nominalLab.L) * num37) +
        f(f(pa - seedComponent3.nominalLab.a) * num38) +
        f(f(pb - seedComponent3.nominalLab.b) * num39)
      );
      num36 = Math.max(0, Math.min(1, f(num41 / num40)));
    }

    v61AssignedRegion[m] = num36 >= 0.5 ? num33 : num34;
  }

  // 6. Spatial Smoothness (3 iterations of ICM majority voting)
  let cleanedRegionMap = new Int32Array(v61AssignedRegion);
  const neighborOffsets = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  const uKeys = new Int32Array(8);
  const uCounts = new Int32Array(8);

  for (let num42 = 0; num42 < 3; num42++) {
    const nextArray = new Int32Array(cleanedRegionMap);
    for (let cy = 1; cy < height - 1; cy++) {
      const rowOff = cy * width;
      for (let cx = 1; cx < width - 1; cx++) {
        const num4 = rowOff + cx;
        if (finalCompMap[num4] > 0) {
          continue;
        }

        const num43 = cleanedRegionMap[num4];

        let uLen = 0;
        for (let k = 0; k < 8; k++) {
          const val = cleanedRegionMap[num4 + neighborOffsets[k]];
          let found = false;
          for (let u = 0; u < uLen; u++) {
            if (uKeys[u] === val) {
              uCounts[u]++;
              found = true;
              break;
            }
          }
          if (!found) {
            uKeys[uLen] = val;
            uCounts[uLen] = 1;
            uLen++;
          }
        }

        let maxCount = 0;
        let bestKey = num43;
        for (let u = 0; u < uLen; u++) {
          if (uCounts[u] > maxCount) {
            maxCount = uCounts[u];
            bestKey = uKeys[u];
          }
        }

        if (maxCount >= 5 && bestKey !== num43) {
          nextArray[num4] = bestKey;
        }
      }
    }
    cleanedRegionMap = nextArray;
  }

  // 7. Measure Micro-Islands
  let num47 = 0;
  const seen = new Uint8Array(total);
  queue.clear();

  for (let m = 0; m < total; m++) {
    if (seen[m]) {
      continue;
    }

    const num48 = cleanedRegionMap[m];
    let num49 = 0;
    let flag = false;

    queue.push(m);
    seen[m] = 1;

    while (!queue.empty) {
      const num14 = queue.pop();
      num49++;
      if (finalCompMap[num14] > 0) {
        flag = true;
      }
      const cy = Math.floor(num14 / width);
      const cx = num14 % width;

      for (let n = 0; n < 4; n++) {
        const num17 = cx + dx4[n];
        const num18 = cy + dy4[n];
        if (num17 >= 0 && num17 < width && num18 >= 0 && num18 < height) {
          const num9 = num18 * width + num17;
          if (!seen[num9] && cleanedRegionMap[num9] === num48) {
            seen[num9] = 1;
            queue.push(num9);
          }
        }
      }
    }

    if (num49 < 30 && !flag) {
      num47++;
    }
  }

  // 8. Build Output RGBA Buffer
  const outRgba = new Uint8Array(total * 4);
  for (let m = 0; m < total; m++) {
    const regId = cleanedRegionMap[m];
    const comp = dictionary.get(regId);
    if (comp) {
      outRgba[m * 4] = comp.nominalColor[0];
      outRgba[m * 4 + 1] = comp.nominalColor[1];
      outRgba[m * 4 + 2] = comp.nominalColor[2];
      outRgba[m * 4 + 3] = rawRgba[m * 4 + 3];
    } else {
      outRgba[m * 4] = 255;
      outRgba[m * 4 + 1] = 255;
      outRgba[m * 4 + 2] = 255;
      outRgba[m * 4 + 3] = rawRgba[m * 4 + 3];
    }
  }

  return {
    rgba: outRgba,
    metrics: {
      ragNodes: dictionary.size,
      ragEdges: hashSet.size,
      microIslands: num47,
      unsupportedHoles: 0,
    },
  };
}

