import fs from 'node:fs';
import path from 'node:path';
import {
  RgbaRaster,
  VectorEngineBackend,
  VectorEngineResult,
} from './types';
import { parseSvgString } from '../vectorizer/svgParser';

export interface GoldenCaseStats {
  paths: number;
  subpaths: number;
  anchors: number;
  holes: number;
  compoundPaths: number;
  svgSize: number;
}

export interface GoldenCaseRecord {
  caseId: string;
  displayName: string;
  inputHash: string; // SHA-256
  inputFile: string; // relative to manifest dir or baseDir
  approvedSvgPath: string; // relative to manifest dir or baseDir
  approvedAt: string | null;
  humanApproved: boolean; // MUST be explicit boolean, never auto-approved
  route: VectorEngineBackend;
  backendUsed: 'REGION_GRAPH' | 'DIRECT_VECTO';
  wramp: number;
  cpoly: number;
  stats: GoldenCaseStats;
  notes?: string;
}

export interface GoldenManifest {
  version: string;
  description?: string;
  cases: GoldenCaseRecord[];
}

export type RegressionVerdict = 'PASS' | 'REVIEW_REQUIRED' | 'FAIL';

export interface RegressionDiffs {
  pathDelta: number;
  subpathDelta: number;
  anchorDelta: number;
  holeDelta: number;
  compoundPathDelta: number;
  svgSizeDelta: number;
  byteIdentical: boolean;
}

export interface RegressionResult {
  caseId: string;
  displayName: string;
  verdict: RegressionVerdict;
  reasons: string[];
  candidateBackend?: 'REGION_GRAPH' | 'DIRECT_VECTO';
  candidateStats?: GoldenCaseStats;
  expectedBackend: 'REGION_GRAPH' | 'DIRECT_VECTO';
  expectedStats: GoldenCaseStats;
  humanApproved: boolean;
  durationMs?: number;
  diffs?: RegressionDiffs;
  reviewArtifacts?: {
    caseDir?: string;
    originalImage?: string;
    approvedSvg?: string;
    candidateSvg?: string;
    diffReport?: string;
  };
}

export interface RegressionSummary {
  timestamp: string;
  totalCases: number;
  passed: number;
  reviewRequired: number;
  failed: number;
  overallVerdict: RegressionVerdict;
  results: RegressionResult[];
}

/**
 * Accurately analyzes an SVG string to compute path, anchor, hole, and compound path metrics.
 */
export function analyzeSvgStats(svgString: string): GoldenCaseStats {
  if (!svgString || typeof svgString !== 'string' || svgString.trim().length === 0) {
    return {
      paths: 0,
      subpaths: 0,
      anchors: 0,
      holes: 0,
      compoundPaths: 0,
      svgSize: 0,
    };
  }

  try {
    const parsed = parseSvgString(svgString);
    let pathCount = parsed.paths.length;
    let subpathCount = 0;
    let anchorCount = 0;
    let holes = 0;
    let compoundPaths = 0;

    for (const p of parsed.paths) {
      const d = p.d || '';
      const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
      anchorCount += commands.length;

      const mMatches = d.match(/[Mm]/g) || [];
      subpathCount += mMatches.length;
      if (mMatches.length > 1) {
        compoundPaths++;
        holes += mMatches.length - 1;
      }
    }

    return {
      paths: pathCount,
      subpaths: subpathCount,
      anchors: anchorCount,
      holes,
      compoundPaths,
      svgSize: Buffer.byteLength(svgString, 'utf-8'),
    };
  } catch {
    // Fallback regex analysis if xml parser encounters irregular tags
    const pathRegex = /<path\b([^>]*)\s*\/?>/gi;
    let match: RegExpExecArray | null;
    let pathCount = 0;
    let subpathCount = 0;
    let anchorCount = 0;
    let holes = 0;
    let compoundPaths = 0;

    while ((match = pathRegex.exec(svgString)) !== null) {
      const attrString = match[1];
      const dMatch = attrString.match(/\bd\s*=\s*["']([^"']+)["']/i);
      if (!dMatch || !dMatch[1].trim()) continue;

      pathCount++;
      const d = dMatch[1].trim();
      const commands = d.match(/[MmLlHhVvCcSsQqTtAaZz]/g) || [];
      anchorCount += commands.length;

      const mMatches = d.match(/[Mm]/g) || [];
      subpathCount += mMatches.length;
      if (mMatches.length > 1) {
        compoundPaths++;
        holes += mMatches.length - 1;
      }
    }

    return {
      paths: pathCount,
      subpaths: subpathCount,
      anchors: anchorCount,
      holes,
      compoundPaths,
      svgSize: Buffer.byteLength(svgString, 'utf-8'),
    };
  }
}

/**
 * Compares candidate execution output against a Golden Case record.
 * Classifies the outcome strictly into PASS, REVIEW_REQUIRED, or FAIL.
 */
export function compareCandidateToGolden(
  candidateSvg: string,
  candidateBackend: 'REGION_GRAPH' | 'DIRECT_VECTO',
  golden: GoldenCaseRecord,
  approvedSvgContent?: string,
  options?: {
    maxAnchorGrowthMultiplier?: number;
    maxPathGrowthMultiplier?: number;
    anchorTolerancePercent?: number;
  }
): {
  verdict: RegressionVerdict;
  reasons: string[];
  diffs: RegressionDiffs;
  candidateStats: GoldenCaseStats;
} {
  const maxAnchorGrowth = options?.maxAnchorGrowthMultiplier ?? 3.0;
  const maxPathGrowth = options?.maxPathGrowthMultiplier ?? 3.0;
  const anchorTolerancePct = options?.anchorTolerancePercent ?? 5.0;

  const candidateStats = analyzeSvgStats(candidateSvg);
  const expectedStats = golden.stats;

  const byteIdentical = approvedSvgContent !== undefined
    ? candidateSvg.trim() === approvedSvgContent.trim()
    : false;

  const diffs: RegressionDiffs = {
    pathDelta: candidateStats.paths - expectedStats.paths,
    subpathDelta: candidateStats.subpaths - expectedStats.subpaths,
    anchorDelta: candidateStats.anchors - expectedStats.anchors,
    holeDelta: candidateStats.holes - expectedStats.holes,
    compoundPathDelta: candidateStats.compoundPaths - expectedStats.compoundPaths,
    svgSizeDelta: candidateStats.svgSize - expectedStats.svgSize,
    byteIdentical,
  };

  const failReasons: string[] = [];
  const reviewReasons: string[] = [];

  // --- 1. FAIL Conditions (Execution/structural breakdown) ---
  if (!candidateSvg || candidateSvg.trim().length < 10 || candidateStats.paths === 0) {
    failReasons.push('Empty or invalid candidate SVG with 0 paths.');
  }

  if (candidateBackend !== golden.backendUsed) {
    failReasons.push(
      `Backend mismatch: candidate executed via '${candidateBackend}', but golden record expected '${golden.backendUsed}'.`
    );
  }

  if (expectedStats.holes > 0 && candidateStats.holes === 0) {
    failReasons.push(
      `Severe topology loss: golden reference had ${expectedStats.holes} holes, but candidate has 0 holes.`
    );
  }

  if (expectedStats.anchors > 10 && candidateStats.anchors > expectedStats.anchors * maxAnchorGrowth) {
    failReasons.push(
      `Anchor explosion: candidate anchor count (${candidateStats.anchors}) exceeded golden (${expectedStats.anchors}) by >${((maxAnchorGrowth - 1) * 100).toFixed(0)}%.`
    );
  }

  if (expectedStats.paths > 10 && candidateStats.paths > expectedStats.paths * maxPathGrowth) {
    failReasons.push(
      `Path explosion: candidate path count (${candidateStats.paths}) exceeded golden (${expectedStats.paths}) by >${((maxPathGrowth - 1) * 100).toFixed(0)}%.`
    );
  }

  if (failReasons.length > 0) {
    return {
      verdict: 'FAIL',
      reasons: failReasons,
      diffs,
      candidateStats,
    };
  }

  // --- 2. REVIEW_REQUIRED Conditions (Material changes needing human eyes) ---
  if (!golden.humanApproved) {
    reviewReasons.push('Golden case is not flagged as humanApproved: true (pending human sign-off).');
  }

  if (!byteIdentical) {
    if (diffs.pathDelta !== 0) {
      reviewReasons.push(
        `Path count changed: ${expectedStats.paths} -> ${candidateStats.paths} (delta: ${diffs.pathDelta > 0 ? '+' : ''}${diffs.pathDelta}).`
      );
    }

    if (diffs.holeDelta !== 0) {
      reviewReasons.push(
        `Hole count changed: ${expectedStats.holes} -> ${candidateStats.holes} (delta: ${diffs.holeDelta > 0 ? '+' : ''}${diffs.holeDelta}).`
      );
    }

    if (expectedStats.anchors > 0) {
      const anchorPctChange = (Math.abs(diffs.anchorDelta) / expectedStats.anchors) * 100;
      if (anchorPctChange > anchorTolerancePct) {
        reviewReasons.push(
          `Anchor count changed by ${anchorPctChange.toFixed(1)}% (${expectedStats.anchors} -> ${candidateStats.anchors}).`
        );
      }
    }

    if (reviewReasons.length === 0) {
      reviewReasons.push(
        'SVG representation differs from approved golden reference (visual/CorelDRAW review required).'
      );
    }
  }

  if (reviewReasons.length > 0) {
    return {
      verdict: 'REVIEW_REQUIRED',
      reasons: reviewReasons,
      diffs,
      candidateStats,
    };
  }

  // --- 3. PASS Condition ---
  return {
    verdict: 'PASS',
    reasons: ['Output matches approved golden reference within tolerance and is human-approved.'],
    diffs,
    candidateStats,
  };
}

/**
 * Loads and validates a Golden Manifest from disk.
 */
export function loadGoldenManifest(manifestPath: string): GoldenManifest {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Golden manifest file not found at: ${manifestPath}`);
  }

  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as GoldenManifest;

  if (!manifest.version || !Array.isArray(manifest.cases)) {
    throw new Error(`Invalid golden manifest schema at ${manifestPath}: missing version or cases array.`);
  }

  for (const c of manifest.cases) {
    if (!c.caseId || typeof c.humanApproved !== 'boolean') {
      throw new Error(
        `Invalid case entry in manifest (${c.caseId ?? 'unknown'}): caseId and explicit boolean humanApproved are required.`
      );
    }
  }

  return manifest;
}

/**
 * Saves a Golden Manifest to disk.
 */
export function saveGoldenManifest(manifestPath: string, manifest: GoldenManifest): void {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

export interface UpdateGoldenCaseOptions {
  candidateSvg: string;
  backendUsed: 'REGION_GRAPH' | 'DIRECT_VECTO';
  features?: { wramp: number; cpoly: number };
  route?: VectorEngineBackend;
  humanApproved: boolean;
  force: boolean;
  notes?: string;
}

/**
 * Updates or creates a golden case record.
 * SAFETY RULE: Throws an error if force !== true or humanApproved !== true.
 * NEVER allows silent/unauthorized auto-updating of golden references!
 */
export function updateGoldenCase(
  manifestPath: string,
  caseId: string,
  options: UpdateGoldenCaseOptions
): GoldenCaseRecord {
  if (!options.force) {
    throw new Error(
      `SAFETY GUARD: Cannot update golden case '${caseId}' without explicit 'force: true'.`
    );
  }

  if (!options.humanApproved) {
    throw new Error(
      `SAFETY GUARD: Cannot approve golden reference for '${caseId}' without explicit 'humanApproved: true'.`
    );
  }

  const manifestDir = path.dirname(manifestPath);
  const manifest = fs.existsSync(manifestPath)
    ? loadGoldenManifest(manifestPath)
    : { version: '1.0.0', cases: [] };

  const stats = analyzeSvgStats(options.candidateSvg);
  if (stats.paths === 0) {
    throw new Error(`Cannot save golden case '${caseId}': Candidate SVG has 0 valid paths.`);
  }

  const approvedSvgRelative = path.join('cases', caseId, 'approved.svg');
  const approvedSvgAbsolute = path.resolve(manifestDir, approvedSvgRelative);
  fs.mkdirSync(path.dirname(approvedSvgAbsolute), { recursive: true });
  fs.writeFileSync(approvedSvgAbsolute, options.candidateSvg, 'utf-8');

  const existingIndex = manifest.cases.findIndex((c) => c.caseId === caseId);
  const existing = existingIndex >= 0 ? manifest.cases[existingIndex] : null;

  const updatedRecord: GoldenCaseRecord = {
    caseId,
    displayName: existing?.displayName || caseId,
    inputHash: existing?.inputHash || '',
    inputFile: existing?.inputFile || path.join('cases', caseId, 'original.png').replace(/\\/g, '/'),
    approvedSvgPath: approvedSvgRelative.replace(/\\/g, '/'),
    approvedAt: new Date().toISOString(),
    humanApproved: true,
    route: options.route || existing?.route || options.backendUsed,
    backendUsed: options.backendUsed,
    wramp: options.features?.wramp ?? existing?.wramp ?? 0,
    cpoly: options.features?.cpoly ?? existing?.cpoly ?? 0,
    stats,
    notes: options.notes ?? existing?.notes,
  };

  if (existingIndex >= 0) {
    manifest.cases[existingIndex] = updatedRecord;
  } else {
    manifest.cases.push(updatedRecord);
  }

  saveGoldenManifest(manifestPath, manifest);
  return updatedRecord;
}

export interface RunGoldenRegressionOptions {
  manifestPath: string;
  baseDir?: string;
  outDir?: string;
  vectorizeFn: (raster: RgbaRaster) => Promise<VectorEngineResult>;
  decodeFn: (imagePath: string) => Promise<RgbaRaster> | RgbaRaster;
}

/**
 * Runs the complete Golden Vector Regression suite across all cases in the manifest.
 * Produces structured results and outputs CorelDRAW review artifacts when changes occur.
 */
export async function runGoldenRegression(
  options: RunGoldenRegressionOptions
): Promise<RegressionSummary> {
  const manifestDir = path.dirname(path.resolve(options.manifestPath));
  const baseDir = options.baseDir ? path.resolve(options.baseDir) : manifestDir;
  const outDir = options.outDir
    ? path.resolve(options.outDir)
    : path.resolve(baseDir, 'scratch/vector-golden-regression');
  const reviewDir = path.join(outDir, 'review');

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(reviewDir, { recursive: true });

  const manifest = loadGoldenManifest(options.manifestPath);
  const results: RegressionResult[] = [];

  for (const c of manifest.cases) {
    const inputFilePath = path.isAbsolute(c.inputFile)
      ? c.inputFile
      : path.resolve(manifestDir, c.inputFile);

    const approvedSvgPath = path.isAbsolute(c.approvedSvgPath)
      ? c.approvedSvgPath
      : path.resolve(manifestDir, c.approvedSvgPath);

    let approvedSvgContent: string | undefined;
    if (fs.existsSync(approvedSvgPath)) {
      approvedSvgContent = fs.readFileSync(approvedSvgPath, 'utf-8');
    }

    if (!fs.existsSync(inputFilePath)) {
      results.push({
        caseId: c.caseId,
        displayName: c.displayName,
        verdict: 'FAIL',
        reasons: [`Input image file not found: ${inputFilePath}`],
        expectedBackend: c.backendUsed,
        expectedStats: c.stats,
        humanApproved: c.humanApproved,
      });
      continue;
    }

    try {
      const t0 = Date.now();
      const raster = await options.decodeFn(inputFilePath);
      const engineResult = await options.vectorizeFn(raster);
      const durationMs = Date.now() - t0;

      const comparison = compareCandidateToGolden(
        engineResult.svg,
        engineResult.backend,
        c,
        approvedSvgContent
      );

      const caseReviewDir = path.join(reviewDir, c.caseId);
      const reviewArtifacts: RegressionResult['reviewArtifacts'] = {};

      if (comparison.verdict === 'REVIEW_REQUIRED' || comparison.verdict === 'FAIL') {
        fs.mkdirSync(caseReviewDir, { recursive: true });

        const candidateSvgOut = path.join(caseReviewDir, 'candidate.svg');
        fs.writeFileSync(candidateSvgOut, engineResult.svg, 'utf-8');
        reviewArtifacts.candidateSvg = candidateSvgOut;

        if (approvedSvgContent) {
          const approvedSvgOut = path.join(caseReviewDir, 'approved.svg');
          fs.writeFileSync(approvedSvgOut, approvedSvgContent, 'utf-8');
          reviewArtifacts.approvedSvg = approvedSvgOut;
        }

        const ext = path.extname(inputFilePath);
        const originalCopy = path.join(caseReviewDir, `original${ext}`);
        if (fs.existsSync(inputFilePath)) {
          fs.copyFileSync(inputFilePath, originalCopy);
          reviewArtifacts.originalImage = originalCopy;
        }

        const diffReportPath = path.join(caseReviewDir, 'diff-report.json');
        const diffReport = {
          caseId: c.caseId,
          displayName: c.displayName,
          verdict: comparison.verdict,
          reasons: comparison.reasons,
          diffs: comparison.diffs,
          expectedBackend: c.backendUsed,
          candidateBackend: engineResult.backend,
          expectedStats: c.stats,
          candidateStats: comparison.candidateStats,
          humanApproved: c.humanApproved,
          durationMs,
        };
        fs.writeFileSync(diffReportPath, JSON.stringify(diffReport, null, 2), 'utf-8');
        reviewArtifacts.diffReport = diffReportPath;
        reviewArtifacts.caseDir = caseReviewDir;
      }

      results.push({
        caseId: c.caseId,
        displayName: c.displayName,
        verdict: comparison.verdict,
        reasons: comparison.reasons,
        candidateBackend: engineResult.backend,
        candidateStats: comparison.candidateStats,
        expectedBackend: c.backendUsed,
        expectedStats: c.stats,
        humanApproved: c.humanApproved,
        durationMs,
        diffs: comparison.diffs,
        reviewArtifacts: Object.keys(reviewArtifacts).length > 0 ? reviewArtifacts : undefined,
      });
    } catch (err: any) {
      results.push({
        caseId: c.caseId,
        displayName: c.displayName,
        verdict: 'FAIL',
        reasons: [`Execution crash: ${err?.message || String(err)}`],
        expectedBackend: c.backendUsed,
        expectedStats: c.stats,
        humanApproved: c.humanApproved,
      });
    }
  }

  const passed = results.filter((r) => r.verdict === 'PASS').length;
  const reviewRequired = results.filter((r) => r.verdict === 'REVIEW_REQUIRED').length;
  const failed = results.filter((r) => r.verdict === 'FAIL').length;

  let overallVerdict: RegressionVerdict = 'PASS';
  if (failed > 0) {
    overallVerdict = 'FAIL';
  } else if (reviewRequired > 0) {
    overallVerdict = 'REVIEW_REQUIRED';
  }

  const summary: RegressionSummary = {
    timestamp: new Date().toISOString(),
    totalCases: results.length,
    passed,
    reviewRequired,
    failed,
    overallVerdict,
    results,
  };

  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  return summary;
}