import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSvgStats } from '../src/core/vector-engine';
import { reconstructProfessionalCurves } from '../src/core/vector-engine/professionalCurveReconstruction';

interface Point2D {
  x: number;
  y: number;
}

function dist(p1: Point2D, p2: Point2D): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
}

function dot(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.x + v1.y * v2.y;
}

describe('Test Scale-Invariant Windowed Corner Detection', () => {
  it('detects real corners vs raster staircases and reconstructs sweeping Béziers', () => {
    const rawSvg = fs.readFileSync('scratch/v811a-test/logo-dificil-normalized.svg', 'utf-8');
    const pathRegex = /<path([^>]+)\/>|<path([^>]+)>[\s\S]*?<\/path>/gi;
    const matches = Array.from(rawSvg.matchAll(pathRegex));

    let totalRawCorners = 0;
    let totalWindowedCorners = 0;

    for (const m of matches) {
      const d = (m[1] || m[2] || '').match(/d="([^"]+)"/i)?.[1] || '';
      const subpaths = d.split(/(?=[Mm])/).filter(Boolean);

      for (const sub of subpaths) {
        const cmdRegex = /([MmLlCcZz])([^MmLlCcZz]*)/g;
        let match: RegExpExecArray | null;
        const pts: Point2D[] = [];

        while ((match = cmdRegex.exec(sub)) !== null) {
          const type = match[1].toUpperCase();
          const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
          if (type === 'M' || type === 'L') {
            pts.push({ x: args[0], y: args[1] });
          } else if (type === 'C') {
            pts.push({ x: args[4], y: args[5] });
          }
        }

        const N = pts.length;
        if (N < 4) continue;

        let totalPerimeter = 0;
        for (let i = 0; i < N; i++) {
          totalPerimeter += dist(pts[i], pts[(i + 1) % N]);
        }

        // Lookahead window in pixels (scale-invariant: 1.0% of perimeter, clamped between 5px and 30px)
        const lookahead = Math.max(5.0, Math.min(30.0, totalPerimeter * 0.01));

        const rawCorners: number[] = [];
        const windowedCorners: number[] = [];

        for (let i = 0; i < N; i++) {
          const curr = pts[i];
          const prev = pts[(i - 1 + N) % N];
          const next = pts[(i + 1) % N];

          // 1. Raw 1-step angle
          const tIn1 = normalize({ x: curr.x - prev.x, y: curr.y - prev.y });
          const tOut1 = normalize({ x: next.x - curr.x, y: next.y - curr.y });
          const rawAngle = Math.acos(Math.max(-1, Math.min(1, dot(tIn1, tOut1)))) * (180 / Math.PI);
          if (rawAngle >= 45.0) {
            rawCorners.push(i);
          }

          // 2. Windowed persistent angle
          let stepBack = 1;
          let accBackDist = 0;
          while (stepBack < N / 2 && accBackDist < lookahead) {
            accBackDist += dist(pts[(i - stepBack + N) % N], pts[(i - stepBack + 1 + N) % N]);
            stepBack++;
          }
          const ptBack = pts[(i - stepBack + N) % N];

          let stepFwd = 1;
          let accFwdDist = 0;
          while (stepFwd < N / 2 && accFwdDist < lookahead) {
            accFwdDist += dist(pts[(i + stepFwd) % N], pts[(i + stepFwd - 1 + N) % N]);
            stepFwd++;
          }
          const ptFwd = pts[(i + stepFwd) % N];

          const tInWin = normalize({ x: curr.x - ptBack.x, y: curr.y - ptBack.y });
          const tOutWin = normalize({ x: ptFwd.x - curr.x, y: ptFwd.y - curr.y });
          const winAngle = Math.acos(Math.max(-1, Math.min(1, dot(tInWin, tOutWin)))) * (180 / Math.PI);

          if (winAngle >= 45.0) {
            windowedCorners.push(i);
          }
        }

        totalRawCorners += rawCorners.length;
        totalWindowedCorners += windowedCorners.length;
      }
    }

    console.log(`\n==============================================`);
    console.log(`Raw 1-Step Corners (Pixel Noise): ${totalRawCorners}`);
    console.log(`Windowed Persistent Corners (Real Features): ${totalWindowedCorners}`);
    console.log(`Suppression Ratio: ${(100 * (1 - totalWindowedCorners / totalRawCorners)).toFixed(1)}% of false raster corners rejected!`);
    console.log(`==============================================\n`);

    expect(totalWindowedCorners).toBeLessThan(totalRawCorners / 3);
  });
});
