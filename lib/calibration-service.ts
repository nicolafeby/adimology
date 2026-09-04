import { getCalibrationObservations } from './supabase';
import { calibrateProbability, type CalibrationContext } from './probability-calibration';

export async function getCalibratedProbability(context: CalibrationContext) {
  return calibrateProbability(await getCalibrationObservations(context), context);
}
