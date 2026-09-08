import assert from 'node:assert/strict';
import test from 'node:test';
import { screeningApiError } from '../lib/screener-api';
import { isScreeningUpdateRequired, ScreeningUpdateRequiredError, SCREENING_UPDATE_MESSAGE } from '../lib/screening-errors';

test('known missing screening schema produces safe 503 with stable update code', async () => {
 const errors = [
  { code:'42703', message:'column screening_runs.strategy_id does not exist' },
  { code:'42P01', message:'relation public.screening_enrichments does not exist' },
  { code:'42883', message:'function public.claim_screening_run(jsonb) does not exist' },
  { code:'PGRST202', message:'Could not find the function public.mark_stale_screening_runs(p_timeout_minutes) in the schema cache' },
  { code:'PGRST204', message:"Could not find the 'strategy_version' column of 'screening_runs' in the schema cache" },
  { code:'PGRST205', message:"Could not find the table 'public.strategy_outcome_archives' in the schema cache" },
  new ScreeningUpdateRequiredError(),
 ];
 for (const error of errors) {
  const response=screeningApiError(error,'Generic safe error');assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{success:false,code:'SCREENING_UPDATE_REQUIRED',error:SCREENING_UPDATE_MESSAGE});
 }
});
test('unknown database/provider failures remain generic 500 without internal payload',async()=>{
 for(const error of [new Error('screening_runs token=secret'),{code:'23505',message:'duplicate screening_runs token=secret'},{code:'42703',message:'column customer_private.sensitive does not exist'},{code:'PGRST301',message:'JWT token secret invalid'},null]) {
  assert.equal(isScreeningUpdateRequired(error),false);
  const response=screeningApiError(error,'Permintaan tidak dapat diproses.');assert.equal(response.status,500);assert.deepEqual(await response.json(),{success:false,error:'Permintaan tidak dapat diproses.'});
 }
 assert.equal(screeningApiError(new RangeError('Strategy ID tidak valid.'),'Fallback').status,400);
});
