import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  analyzeSvgStats,
  compareCandidateToGolden,
  loadGoldenManifest,
  saveGoldenManifest,
  updateGoldenCase,
  runGoldenRegression,
  GoldenCaseRecord,
  GoldenManifest,
} from '../src/core/vector-engine/goldenHarness';
import { RgbaRaster, VectorEngineResult } from '../src/core/vector-engine/types';

describe('PRYX ETAPA 8.4 — Golden Vector Regression Harness', () => {
  const sampleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <path fill="#FF0000" d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z" />
    <path fill="#0000FF" d="M 40 40 L 60 40 L 60 60 L 40 60 Z" />
  </svg>`;

  it('accurately parses and calculates SVG structural metrics', () => {
    const stats = analyzeSvgStats(sampleSvg);
    expect(stats.paths).toBe(2);
    expect(stats.subpaths).toBe(3); // 2 subpaths in 1st path + 1 subpath in 2nd path
    expect(stats.compoundPaths).toBe(1);
    expect(stats.holes).toBe(1);
    expect(stats.anchors).toBe(15); // 10 commands in 1st path + 5 in 2nd path
    expect(stats.svgSize).toBeGreaterThan(0);
  });

  it('handles empty or malformed SVGs gracefully in analyzeSvgStats', () => {
    const emptyStats = analyzeSvgStats('');
    expect(emptyStats.paths).toBe(0);
    expect(emptyStats.anchors).toBe(0);
    expect(emptyStats.holes).toBe(0);
  });

  const baseGoldenCase: GoldenCaseRecord = {
    caseId: 'test-case-01',
    displayName: 'Test Fixture Case',
    inputHash: 'ABCDEF123456',
    inputFile: 'cases/test-case-01/original.png',
    approvedSvgPath: 'cases/test-case-01/approved.svg',
    approvedAt: '2026-09-15T00:00:00.000Z',
    humanApproved: true,
    route: 'REGION_GRAPH',
    backendUsed: 'REGION_GRAPH',
    wramp: 12.0,
    cpoly: 500,
    stats: {
      paths: 2,
      subpaths: 3,
      anchors: 15,
      holes: 1,
      compoundPaths: 1,
      svgSize: Buffer.byteLength(sampleSvg, 'utf-8'),
    },
  };

  it('classifies identical approved execution as PASS', () => {
    const comparison = compareCandidateToGolden(
      sampleSvg,
      'REGION_GRAPH',
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('PASS');
    expect(comparison.reasons.length).toBe(1);
    expect(comparison.diffs.byteIdentical).toBe(true);
    expect(comparison.diffs.pathDelta).toBe(0);
    expect(comparison.diffs.holeDelta).toBe(0);
    expect(comparison.diffs.anchorDelta).toBe(0);
  });

  it('classifies non-human-approved golden case as REVIEW_REQUIRED', () => {
    const unapprovedCase: GoldenCaseRecord = {
      ...baseGoldenCase,
      humanApproved: false,
    };

    const comparison = compareCandidateToGolden(
      sampleSvg,
      'REGION_GRAPH',
      unapprovedCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('REVIEW_REQUIRED');
    expect(comparison.reasons).toContain(
      'Golden case is not flagged as humanApproved: true (pending human sign-off).'
    );
  });

  it('classifies modified SVG or altered topology as REVIEW_REQUIRED', () => {
    // Modified SVG with slight path/anchor adjustment
    const alteredSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path fill="#FF0000" d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z" />
      <path fill="#0000FF" d="M 40 40 L 50 40 L 60 40 L 60 60 L 40 60 Z" />
    </svg>`;

    const comparison = compareCandidateToGolden(
      alteredSvg,
      'REGION_GRAPH',
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('REVIEW_REQUIRED');
    expect(comparison.diffs.byteIdentical).toBe(false);
  });

  it('classifies execution with backend mismatch as FAIL', () => {
    const comparison = compareCandidateToGolden(
      sampleSvg,
      'DIRECT_VECTO', // Mismatched backend
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('FAIL');
    expect(comparison.reasons[0]).toContain("Backend mismatch: candidate executed via 'DIRECT_VECTO'");
  });

  it('classifies empty or 0-path SVG as FAIL', () => {
    const emptySvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>`;
    const comparison = compareCandidateToGolden(
      emptySvg,
      'REGION_GRAPH',
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('FAIL');
    expect(comparison.reasons[0]).toContain('Empty or invalid candidate SVG with 0 paths.');
  });

  it('classifies severe hole loss as FAIL', () => {
    // SVG missing inner hole (compound path eliminated)
    const holeLossSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path fill="#FF0000" d="M 10 10 L 90 10 L 90 90 L 10 90 Z" />
      <path fill="#0000FF" d="M 40 40 L 60 40 L 60 60 L 40 60 Z" />
    </svg>`;

    const comparison = compareCandidateToGolden(
      holeLossSvg,
      'REGION_GRAPH',
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('FAIL');
    expect(comparison.reasons[0]).toContain('Severe topology loss: golden reference had 1 holes, but candidate has 0 holes.');
  });

  it('classifies anchor explosion (>300%) as FAIL', () => {
    // Huge anchor list
    const manyCommands = 'M 0 0 ' + 'L 1 1 '.repeat(60) + 'Z';
    const explodedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path fill="#FF0000" d="${manyCommands} M 30 30 L 70 30 L 70 70 L 30 70 Z" />
      <path fill="#0000FF" d="M 40 40 L 60 40 L 60 60 L 40 60 Z" />
    </svg>`;

    const comparison = compareCandidateToGolden(
      explodedSvg,
      'REGION_GRAPH',
      baseGoldenCase,
      sampleSvg
    );

    expect(comparison.verdict).toBe('FAIL');
    expect(comparison.reasons[0]).toContain('Anchor explosion: candidate anchor count');
  });

  it('enforces safety guards against unauthorized/silent updating of golden references', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden_test_'));
    const manifestFile = path.join(tempDir, 'manifest.json');

    const manifest: GoldenManifest = {
      version: '1.0.0',
      cases: [baseGoldenCase],
    };
    saveGoldenManifest(manifestFile, manifest);

    // 1. Rejects update when force is false
    expect(() => {
      updateGoldenCase(manifestFile, 'test-case-01', {
        candidateSvg: sampleSvg,
        backendUsed: 'REGION_GRAPH',
        humanApproved: true,
        force: false,
      });
    }).toThrow(/SAFETY GUARD: Cannot update golden case/);

    // 2. Rejects update when humanApproved is false
    expect(() => {
      updateGoldenCase(manifestFile, 'test-case-01', {
        candidateSvg: sampleSvg,
        backendUsed: 'REGION_GRAPH',
        humanApproved: false,
        force: true,
      });
    }).toThrow(/SAFETY GUARD: Cannot approve golden reference/);

    // 3. Successfully updates when both flags are explicitly true
    const updated = updateGoldenCase(manifestFile, 'test-case-01', {
      candidateSvg: sampleSvg,
      backendUsed: 'REGION_GRAPH',
      humanApproved: true,
      force: true,
      notes: 'Human verified in CorelDRAW 2024',
    });

    expect(updated.humanApproved).toBe(true);
    expect(updated.notes).toBe('Human verified in CorelDRAW 2024');
    expect(fs.existsSync(path.join(tempDir, updated.approvedSvgPath))).toBe(true);
  });

  it('runs complete regression runner and generates CorelDRAW review package on changes', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden_run_'));
    const manifestFile = path.join(tempDir, 'manifest.json');

    // Create a dummy image file
    const caseDir = path.join(tempDir, 'cases', 'case-01');
    fs.mkdirSync(caseDir, { recursive: true });
    const dummyPng = path.join(caseDir, 'original.png');
    fs.writeFileSync(dummyPng, Buffer.from('FAKE_IMAGE_BYTES'));

    const approvedSvgPath = path.join(caseDir, 'approved.svg');
    fs.writeFileSync(approvedSvgPath, sampleSvg, 'utf-8');

    const manifest: GoldenManifest = {
      version: '1.0.0',
      cases: [
        {
          caseId: 'case-01',
          displayName: 'Test Logo 1',
          inputHash: 'HASH123',
          inputFile: 'cases/case-01/original.png',
          approvedSvgPath: 'cases/case-01/approved.svg',
          approvedAt: '2026-09-15T00:00:00.000Z',
          humanApproved: true,
          route: 'REGION_GRAPH',
          backendUsed: 'REGION_GRAPH',
          wramp: 10.0,
          cpoly: 300,
          stats: analyzeSvgStats(sampleSvg),
        },
      ],
    };
    saveGoldenManifest(manifestFile, manifest);

    // Mock decodeFn and vectorizeFn returning an altered SVG (triggers REVIEW_REQUIRED)
    const alteredSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
      <path fill="#FF0000" d="M 10 10 L 90 10 L 90 90 L 10 90 Z M 30 30 L 70 30 L 70 70 L 30 70 Z" />
      <path fill="#0000FF" d="M 40 40 L 50 40 L 60 40 L 60 60 L 40 60 Z" />
    </svg>`;

    const mockDecode = async () => ({ width: 10, height: 10, data: new Uint8Array(400) } as RgbaRaster);
    const mockVectorize = async (): Promise<VectorEngineResult> => ({
      backend: 'REGION_GRAPH',
      svg: alteredSvg,
      fillFirst: true,
      validationRequired: false,
    });

    const outDir = path.join(tempDir, 'out');
    const summary = await runGoldenRegression({
      manifestPath: manifestFile,
      baseDir: tempDir,
      outDir,
      decodeFn: mockDecode,
      vectorizeFn: mockVectorize,
    });

    expect(summary.totalCases).toBe(1);
    expect(summary.reviewRequired).toBe(1);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.overallVerdict).toBe('REVIEW_REQUIRED');

    // Verify summary.json was created
    expect(fs.existsSync(path.join(outDir, 'summary.json'))).toBe(true);

    // Verify review package was created
    const reviewCaseDir = path.join(outDir, 'review', 'case-01');
    expect(fs.existsSync(reviewCaseDir)).toBe(true);
    expect(fs.existsSync(path.join(reviewCaseDir, 'approved.svg'))).toBe(true);
    expect(fs.existsSync(path.join(reviewCaseDir, 'candidate.svg'))).toBe(true);
    expect(fs.existsSync(path.join(reviewCaseDir, 'original.png'))).toBe(true);
    expect(fs.existsSync(path.join(reviewCaseDir, 'diff-report.json'))).toBe(true);
  });

  it('validates 08-logo-simples in real manifest as humanApproved: true and matching exact metrics', () => {
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = loadGoldenManifest(manifestPath);
    const logo1 = manifest.cases.find((c) => c.caseId === '08-logo-simples');
    expect(logo1).toBeDefined();
    expect(logo1!.humanApproved).toBe(true);
    expect(logo1!.backendUsed).toBe('DIRECT_VECTO');
    expect(logo1!.stats.paths).toBe(18);
    expect(logo1!.stats.subpaths).toBe(35);
    expect(logo1!.stats.anchors).toBe(274);
    expect(logo1!.stats.holes).toBe(17);
    expect(logo1!.stats.svgSize).toBe(9448);

    const approvedSvgPath = path.resolve(__dirname, 'vector-golden', logo1!.approvedSvgPath);
    expect(fs.existsSync(approvedSvgPath)).toBe(true);
    const approvedSvg = fs.readFileSync(approvedSvgPath, 'utf-8');

    const calculatedStats = analyzeSvgStats(approvedSvg);
    expect(calculatedStats.paths).toBe(logo1!.stats.paths);
    expect(calculatedStats.subpaths).toBe(logo1!.stats.subpaths);
    expect(calculatedStats.anchors).toBe(logo1!.stats.anchors);
    expect(calculatedStats.holes).toBe(logo1!.stats.holes);

    const comparison = compareCandidateToGolden(
      approvedSvg,
      'DIRECT_VECTO',
      logo1!,
      approvedSvg
    );

    expect(comparison.verdict).toBe('PASS');
    expect(comparison.diffs.byteIdentical).toBe(true);
  });

  it('validates 09-logo-lettering in real manifest as humanApproved: true and matching exact metrics', () => {
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = loadGoldenManifest(manifestPath);
    const logo2 = manifest.cases.find((c) => c.caseId === '09-logo-lettering');
    expect(logo2).toBeDefined();
    expect(logo2!.humanApproved).toBe(true);
    expect(logo2!.backendUsed).toBe('DIRECT_VECTO');
    expect(logo2!.stats.paths).toBe(9);
    expect(logo2!.stats.subpaths).toBe(16);
    expect(logo2!.stats.anchors).toBe(265);
    expect(logo2!.stats.holes).toBe(7);
    expect(logo2!.stats.svgSize).toBe(8919);

    const approvedSvgPath = path.resolve(__dirname, 'vector-golden', logo2!.approvedSvgPath);
    expect(fs.existsSync(approvedSvgPath)).toBe(true);
    const approvedSvg = fs.readFileSync(approvedSvgPath, 'utf-8');

    const calculatedStats = analyzeSvgStats(approvedSvg);
    expect(calculatedStats.paths).toBe(logo2!.stats.paths);
    expect(calculatedStats.subpaths).toBe(logo2!.stats.subpaths);
    expect(calculatedStats.anchors).toBe(logo2!.stats.anchors);
    expect(calculatedStats.holes).toBe(logo2!.stats.holes);

    const comparison = compareCandidateToGolden(
      approvedSvg,
      'DIRECT_VECTO',
      logo2!,
      approvedSvg
    );

    expect(comparison.verdict).toBe('PASS');
    expect(comparison.diffs.byteIdentical).toBe(true);
  });

  it('validates 10-logo-colorida in real manifest as humanApproved: true and matching exact metrics', () => {
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);

    const logo3 = manifest.cases.find((c) => c.caseId === '10-logo-colorida');
    expect(logo3).toBeDefined();
    expect(logo3!.humanApproved).toBe(true);
    expect(logo3!.backendUsed).toBe('DIRECT_VECTO');
    expect(logo3!.stats.paths).toBe(16);
    expect(logo3!.stats.holes).toBe(15);

    const approvedSvgPath = path.resolve(__dirname, 'vector-golden', logo3!.approvedSvgPath);
    expect(fs.existsSync(approvedSvgPath)).toBe(true);
    const approvedSvg = fs.readFileSync(approvedSvgPath, 'utf-8');

    const calculatedStats = analyzeSvgStats(approvedSvg);
    expect(calculatedStats.paths).toBe(logo3!.stats.paths);
    expect(calculatedStats.subpaths).toBe(logo3!.stats.subpaths);
    expect(calculatedStats.anchors).toBe(logo3!.stats.anchors);
    expect(calculatedStats.holes).toBe(logo3!.stats.holes);

    const comparison = compareCandidateToGolden(
      approvedSvg,
      'DIRECT_VECTO',
      logo3!,
      approvedSvg
    );

    expect(comparison.verdict).toBe('PASS');
    expect(comparison.diffs.byteIdentical).toBe(true);
  });

  it('executes cumulative regression across all human-approved golden cases', () => {
    const manifestPath = path.resolve(__dirname, 'vector-golden/manifest.json');
    const manifest = loadGoldenManifest(manifestPath);

    const approvedCases = manifest.cases.filter((c) => c.humanApproved === true);
    expect(approvedCases.length).toBe(3); // Logo 1 (08-logo-simples) + Logo 2 (09-logo-lettering) + Logo 3 (10-logo-colorida)

    for (const goldenCase of approvedCases) {
      const svgPath = path.resolve(__dirname, 'vector-golden', goldenCase.approvedSvgPath);
      expect(fs.existsSync(svgPath)).toBe(true);
      const svg = fs.readFileSync(svgPath, 'utf-8');

      const comparison = compareCandidateToGolden(
        svg,
        goldenCase.backendUsed,
        goldenCase,
        svg
      );

      expect(comparison.verdict).toBe('PASS');
      expect(comparison.diffs.byteIdentical).toBe(true);
      expect(comparison.diffs.pathDelta).toBe(0);
      expect(comparison.diffs.anchorDelta).toBe(0);
      expect(comparison.diffs.holeDelta).toBe(0);
    }
  });
});


