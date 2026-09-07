# Screener factor audit — swing 5–20 sessions

| Existing feature | Previous use / issue | v2 role | Horizon |
|---|---|---|---|
| Return 5D, relative volume, MA20 | Pre-screen, analysis, confirmation and ranking overlap | confirmation; capped short-term ranking input | short-term / swing |
| Return/RS 20D | directional ranking | ranking | swing |
| Broker detector label + latest dominant broker | keyword/snapshot directional heuristic | label informational; multi-session persistence ranking | swing |
| Orderbook imbalance | raised analysis and directional signal | informational only, zero directional weight | execution-only |
| Spread and fixed 100-lot slippage | mixed analysis/ranking; share/lot ambiguity | hard execution gate with IDR scenarios and two-sided depth | execution-only |
| Fundamental/DER | universal absolute thresholds | sector-relative risk/context; bank DER excluded | context-only |
| PER/PBV | absolute cheap/expensive thresholds | peer-relative informational context; negative PER special-cased | context-only |
| Market regime | component and gate | risk modifier/gate; no independent duplicate ranking evidence | context-only |
| AI/news | component score | enrichment/informational; never admission | context-only |

The active baseline is `swing_5_20d` / `swing-v1`. It is an interpretable,
unvalidated baseline, not an optimized model. Version comparisons must only use
point-in-time-valid snapshots and a later holdout. No compatible outcome sample
is bundled with this repository, so comparison and ablation status is
`insufficient_data`.
