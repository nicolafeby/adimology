DO $$
DECLARE
 run_base JSONB := jsonb_build_object('analysis_date','2026-09-04','started_at','2026-09-04T09:30:00+07:00','screened_at','2026-09-04T09:30:00+07:00','information_cutoff_at','2026-09-04T09:30:00+07:00','execution_mode','live','strategy_version','fixture-v1','configuration_version','fixture-config','execution_model','fixture-execution','outcome_definition','fixture-outcome');
 first_id UUID; repeated_id UUID; second_id UUID; was_reused BOOLEAN; snapshot_id BIGINT; blocked BOOLEAN;
BEGIN
 IF EXISTS(SELECT 1 FROM screening_runs WHERE id='00000000-0000-4000-8000-000000000001' AND (strategy_id IS NOT NULL OR execution_mode <> 'legacy_unverified')) THEN RAISE EXCEPTION 'legacy run was relabelled'; END IF;
 IF EXISTS(SELECT 1 FROM signal_snapshots WHERE symbol='OLDX' AND (strategy_id IS NOT NULL OR point_in_time_valid OR backtest_eligible)) THEN RAISE EXCEPTION 'legacy snapshot was verified'; END IF;
 SELECT id,reused INTO first_id,was_reused FROM claim_screening_run(run_base || jsonb_build_object('id',gen_random_uuid(),'strategy_id','bpjs','idempotency_key','bpjs:fixture'));
 IF was_reused THEN RAISE EXCEPTION 'fresh run reused'; END IF;
 UPDATE screening_runs SET status='completed',quantitative_status='completed' WHERE id=first_id;
 SELECT id,reused INTO repeated_id,was_reused FROM claim_screening_run(run_base || jsonb_build_object('id',gen_random_uuid(),'strategy_id','bpjs','idempotency_key','bpjs:fixture'));
 IF NOT was_reused OR repeated_id<>first_id THEN RAISE EXCEPTION 'terminal retry did not reuse'; END IF;
 SELECT id INTO second_id FROM claim_screening_run(run_base || jsonb_build_object('id',gen_random_uuid(),'strategy_id','bsjp','idempotency_key','bsjp:fixture'));
 IF second_id=first_id THEN RAISE EXCEPTION 'strategy run collision'; END IF;
 INSERT INTO screening_results(run_id,symbol,analysis_date,screening_status,selection_stage,evaluated_at,strategy_id,strategy_version,configuration_version,execution_model,outcome_definition,quantitative_status,terminal_status,ranking_position)
 VALUES(first_id,'BBCA','2026-09-04','passed','final_selection',NOW(),'bpjs','fixture-v1','fixture-config','fixture-execution','fixture-outcome','completed','completed',1),
 (second_id,'BBCA','2026-09-04','watch','quality_gate',NOW(),'bsjp','fixture-v1','fixture-config','fixture-execution','fixture-outcome','completed','completed',NULL);
 blocked:=FALSE;
 BEGIN UPDATE screening_results SET ranking_score=99 WHERE run_id=first_id; EXCEPTION WHEN OTHERS THEN blocked:=TRUE; END;
 IF NOT blocked THEN RAISE EXCEPTION 'quantitative result mutable'; END IF;
 UPDATE screening_results SET ai_status='completed',news_enrichment='{"status":"source_unavailable"}' WHERE run_id=first_id;
 INSERT INTO screening_enrichments(run_id,symbol,strategy_id,strategy_version,kind,payload) VALUES(first_id,'BBCA','bpjs','fixture-v1','news','{"status":"source_unavailable"}');
 blocked:=FALSE;
 BEGIN UPDATE screening_enrichments SET payload='{}'; EXCEPTION WHEN OTHERS THEN blocked:=TRUE; END;
 IF NOT blocked THEN RAISE EXCEPTION 'enrichment audit mutable'; END IF;
 INSERT INTO signal_snapshots(signal_date,symbol,score,signal,model_version,run_id,strategy_id,strategy_version,configuration_version,execution_model,outcome_definition)
 VALUES('2026-09-04','BBCA',60,'watch','fixture-v1',first_id,'bpjs','fixture-v1','fixture-config','fixture-execution','fixture-outcome') RETURNING id INTO snapshot_id;
 blocked:=FALSE;
 BEGIN UPDATE signal_snapshots SET score=99 WHERE id=snapshot_id; EXCEPTION WHEN OTHERS THEN blocked:=TRUE; END;
 IF NOT blocked THEN RAISE EXCEPTION 'prediction mutable'; END IF;
 blocked:=FALSE;
 BEGIN DELETE FROM signal_snapshots WHERE id=snapshot_id; EXCEPTION WHEN OTHERS THEN blocked:=TRUE; END;
 IF NOT blocked THEN RAISE EXCEPTION 'prediction deletable'; END IF;
 blocked:=FALSE;
 BEGIN INSERT INTO signal_snapshots(signal_date,symbol,score,signal,model_version,run_id,strategy_id,strategy_version,configuration_version,execution_model,outcome_definition)
 VALUES('2026-09-04','BBCA',60,'watch','fixture-v1',first_id,'bpjs','fixture-v1','fixture-config','fixture-execution','fixture-outcome'); EXCEPTION WHEN unique_violation THEN blocked:=TRUE; END;
 IF NOT blocked THEN RAISE EXCEPTION 'duplicate prediction accepted'; END IF;
 UPDATE screening_runs SET updated_at=NOW()-INTERVAL '2 hours' WHERE id=second_id;
 PERFORM mark_stale_screening_runs(15);
 IF EXISTS(SELECT 1 FROM screening_runs WHERE id=second_id AND status='running') THEN RAISE EXCEPTION 'stale run not terminal'; END IF;
END $$;
SELECT 'PASS: SQL contracts verified against real PostgreSQL' AS result;
