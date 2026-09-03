import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrateProbability, classifyMarketRegime, scoreBucket, type CalibrationObservation } from '../lib/probability-calibration';

test('score bucket keeps score 100 inside the final bucket', () => {
  assert.deepEqual(scoreBucket(100), { low: 90, high: 101 });
});

test('calibration isolates model version, regime, and score bucket', () => {
  const wanted = Array.from({ length: 30 }, (_, index): CalibrationObservation => ({
    score: 75, modelVersion: 'v2', marketRegime: 'bull', return10d: index < 18 ? 2 : -1,
  }));
  const noise: CalibrationObservation[] = [
    ...Array.from({ length: 20 }, (): CalibrationObservation => ({ score: 75, modelVersion: 'v1', marketRegime: 'bull', return10d: -5 })),
    ...Array.from({ length: 20 }, (): CalibrationObservation => ({ score: 75, modelVersion: 'v2', marketRegime: 'bear', return10d: -5 })),
    ...Array.from({ length: 20 }, (): CalibrationObservation => ({ score: 65, modelVersion: 'v2', marketRegime: 'bull', return10d: -5 })),
  ];
  const result = calibrateProbability([...wanted, ...noise], 72, 'v2', 'bull');
  assert.equal(result?.sampleSize, 30);
  assert.equal(result?.probability, 0.6);
});

test('calibration returns null for an undersized cohort', () => {
  const rows = Array.from({ length: 29 }, (): CalibrationObservation => ({ score: 50, modelVersion: 'v2', marketRegime: 'sideways', return10d: 1 }));
  assert.equal(calibrateProbability(rows, 55, 'v2', 'sideways'), null);
});

test('market regime uses price and momentum breadth', () => {
  assert.equal(classifyMarketRegime(Array.from({ length: 10 }, (_, index) => ({ aboveSma20: index < 7, return5d: index < 6 ? 1 : -1 }))), 'bull');
  assert.equal(classifyMarketRegime(Array.from({ length: 10 }, (_, index) => ({ aboveSma20: index < 3, return5d: index < 4 ? 1 : -1 }))), 'bear');
  assert.equal(classifyMarketRegime(Array.from({ length: 10 }, (_, index) => ({ aboveSma20: index < 5, return5d: index < 5 ? 1 : -1 }))), 'sideways');
});
