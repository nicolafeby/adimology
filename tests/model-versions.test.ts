import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVE_MODEL_VERSION, isSupportedRankingModelVersion, rankingModelBadge } from '../lib/model-versions';

test('active ranking model remains readable and receives a current badge', () => {
  assert.equal(isSupportedRankingModelVersion(ACTIVE_MODEL_VERSION), true);
  assert.equal(rankingModelBadge(ACTIVE_MODEL_VERSION), 'Regime + RS · v6');
});

test('legacy ranking snapshots remain readable but unknown models are rejected', () => {
  assert.equal(isSupportedRankingModelVersion('multifactor-quality-v5'), true);
  assert.equal(isSupportedRankingModelVersion('untrusted-model'), false);
  assert.equal(rankingModelBadge('untrusted-model'), null);
});
