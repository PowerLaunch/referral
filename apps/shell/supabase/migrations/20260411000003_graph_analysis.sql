-- Phase 10-E: Referral network topology analysis (R16)
-- Stores detected graph patterns (star clusters, bipartite swaps, cliques, fan-convergence, gen2 velocity).
-- NOT append-only: admins resolve patterns by setting resolved = true.

CREATE TABLE graph_analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type text NOT NULL CHECK (pattern_type IN ('STAR_CLUSTER', 'BIPARTITE', 'CLIQUE', 'FAN_CONVERGE', 'GEN2_VELOCITY')),
  user_ids uuid[] NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE graph_analysis_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON graph_analysis_results FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Indexes for graph_analysis_results
CREATE INDEX IF NOT EXISTS idx_graph_pattern ON graph_analysis_results(pattern_type);
CREATE INDEX IF NOT EXISTS idx_graph_unresolved ON graph_analysis_results(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_graph_user_ids ON graph_analysis_results USING GIN (user_ids);

-- Partial unique indexes on trust_score_events for graph analysis reasons.
-- Ensures one penalty per user per reason even when patterns evolve between cron runs
-- (e.g., a star cluster gains a new referee → new graph_analysis_result, but existing
-- members must not be re-penalized).
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_star_cluster ON trust_score_events (user_id) WHERE reason = 'star_cluster';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_bipartite_swap ON trust_score_events (user_id) WHERE reason = 'bipartite_swap';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_bipartite_cycle ON trust_score_events (user_id) WHERE reason = 'bipartite_cycle';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_disconnected_clique ON trust_score_events (user_id) WHERE reason = 'disconnected_clique';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_fan_converge_fp ON trust_score_events (user_id) WHERE reason = 'fan_converge_fingerprint';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_fan_converge_ip ON trust_score_events (user_id) WHERE reason = 'fan_converge_ip';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tse_gen2_velocity ON trust_score_events (user_id) WHERE reason = 'gen2_velocity';

-- Indexes on referrals for graph queries (may already exist)
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referee ON referrals(referee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
