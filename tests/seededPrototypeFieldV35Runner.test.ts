import { describe, expect, it } from 'vitest';
import { runV35SeededField } from '../scratch/run-v35-seeded-field';
describe('V3.5 scratch runner', () => { it('generates diagnostics from frozen snapshots', async () => { const metrics = await runV35SeededField(); expect(metrics.seedComponentCount).toBeGreaterThan(0); expect(metrics.finalComponentCount).toBe(metrics.seedComponentCount); }, 30_000); });
