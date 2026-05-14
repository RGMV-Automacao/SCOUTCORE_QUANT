"""
train.py — treina Engine B por (family, direction, line).

Engine B v0.4.0 — Feature set v3 (32 features) + Walk-Forward Validation.

Engines: XGBoost (preferred) → LightGBM (fallback) → GradientBoosting (sklearn fallback).
Escolha controlada por env ML_ENGINE_B_BACKEND ∈ {xgb, lgbm, sklearn, auto}.

Famílias suportadas (v0.4.0):
  Gols (FT): over/under 0.5, 1.5, 2.5, 3.5, 4.5
  Gols (HT): over/under 0.5, 1.5
  BTTS FT:   sim, nao
  1x2 FT:    home, draw, away
  Escanteios (FT, total): over/under 7.5, 8.5, 9.5, 10.5, 11.5
  Cartões (FT, total): over/under 2.5, 3.5, 4.5, 5.5
  Chutes (FT, total): over/under 19.5, 21.5, 23.5, 25.5
  Faltas (FT, total): over/under 19.5, 21.5, 23.5, 25.5

Validação: Walk-forward temporal com 3 folds (60/20/20 expanding window).
Final model: treina em 100% dos dados válidos, métricas são média dos folds.

Salva: models/{key}.joblib + models/manifest.json com metadados.
"""
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import brier_score_loss, log_loss
import joblib

MIN_TRAIN_SAMPLES = 200
N_WF_FOLDS = 3         # walk-forward folds
WF_TEST_SHARE = 0.15   # ~15% por fold de teste

BACKEND = os.environ.get("ML_ENGINE_B_BACKEND", "auto").lower()

# Backends opcionais
try:
    if BACKEND in ("xgb", "auto"):
        from xgboost import XGBClassifier  # type: ignore
        HAS_XGB = True
    else:
        HAS_XGB = False
except Exception:
    HAS_XGB = False
try:
    if BACKEND in ("lgbm", "auto"):
        from lightgbm import LGBMClassifier  # type: ignore
        HAS_LGBM = True
    else:
        HAS_LGBM = False
except Exception:
    HAS_LGBM = False

sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import FEATURE_NAMES  # noqa: E402

DEFAULT_MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS_DIR = Path(os.environ.get("ENGINE_B_MODELS_DIR", DEFAULT_MODELS_DIR)).expanduser()
if not MODELS_DIR.is_absolute():
    MODELS_DIR = (Path.cwd() / MODELS_DIR).resolve()
MODELS_DIR.mkdir(parents=True, exist_ok=True)


def make_classifier():
    """Escolhe backend conforme env e disponibilidade. Retorna (clf, backend_name)."""
    if BACKEND in ("xgb", "auto") and HAS_XGB:
        return (
            XGBClassifier(
                n_estimators=300, max_depth=4, learning_rate=0.05, subsample=0.85,
                colsample_bytree=0.85, eval_metric="logloss", tree_method="hist",
                random_state=42, n_jobs=4,
            ),
            "xgboost",
        )
    if BACKEND in ("lgbm", "auto") and HAS_LGBM:
        return (
            LGBMClassifier(
                n_estimators=400, num_leaves=31, learning_rate=0.05,
                subsample=0.85, colsample_bytree=0.85, random_state=42, n_jobs=4, verbose=-1,
            ),
            "lightgbm",
        )
    return (
        GradientBoostingClassifier(
            n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.85, random_state=42,
        ),
        "sklearn_gbc",
    )


# ---------------------------------------------------------------------------
# Dataset builder — features v3 (32 features) + targets expandidos
# ---------------------------------------------------------------------------

def build_dataset(con: sqlite3.Connection, ligas: list[str] | None = None):
    """Itera partidas Played e gera (features, targets).

    Usa cache em memória de partidas por (liga, time) ordenadas por data, evitando
    O(N²) queries SQL. Para cada partida-alvo, faz busca binária pela data para
    pegar histórico anterior — mantém zero leakage (data_partida < data_alvo).
    """
    import bisect
    from collections import defaultdict

    where = ["status = 'Played'", "modo = 'FT'", "home_goals IS NOT NULL", "data_partida IS NOT NULL"]
    params: list = []
    if ligas:
        placeholders = ",".join("?" * len(ligas))
        where.append(f"liga IN ({placeholders})")
        params.extend(ligas)
    sql = f"""
        SELECT liga, home_team, away_team, data_partida, home_goals, away_goals,
               home_goals_ht, away_goals_ht, id_confronto
        FROM partidas
        WHERE {' AND '.join(where)}
        ORDER BY data_partida ASC
    """
    rows = con.execute(sql, params).fetchall()
    print(f"[train] partidas Played: {len(rows)}", flush=True)

    # Pré-carrega totais de eventos_faixa por id_confronto
    ev_rows = con.execute("""
        SELECT id_confronto,
               SUM(escanteios) AS esc,
               SUM(cartoes_amarelos + cartoes_vermelhos) AS cards,
               SUM(chutes) AS ch,
               SUM(chutes_no_alvo) AS sot,
               SUM(faltas) AS fl
        FROM eventos_faixa
        GROUP BY id_confronto
    """).fetchall()
    ev_total = {}
    for r in ev_rows:
        ev_total[r[0]] = {
            "esc": r[1] or 0, "cards": r[2] or 0,
            "ch": r[3] or 0, "sot": r[4] or 0, "fl": r[5] or 0,
        }

    # H2H index: (liga, home, away) → [(data, home_goals, away_goals)]
    h2h_idx: dict[tuple, list] = defaultdict(list)
    for liga, h, a, d, hg, ag, *_ in rows:
        # Ambas as direções
        key_fwd = (liga, h, a)
        key_rev = (liga, a, h)
        h2h_idx[key_fwd].append((d, hg, ag))
        h2h_idx[key_rev].append((d, ag, hg))

    # Index por (liga, team): listas paralelas (datas, payloads)
    idx_dates: dict[tuple, list[str]] = defaultdict(list)
    idx_data: dict[tuple, list[tuple]] = defaultdict(list)
    for liga, h, a, d, hg, ag, hg_ht, ag_ht, idc in rows:
        idx_dates[(liga, h)].append(d)
        idx_data[(liga, h)].append((d, h, a, hg, ag, hg_ht, ag_ht, idc))
        idx_dates[(liga, a)].append(d)
        idx_data[(liga, a)].append((d, h, a, hg, ag, hg_ht, ag_ht, idc))

    def hist_before(liga, team, before_date, max_n=30):
        key = (liga, team)
        dates = idx_dates.get(key)
        if not dates:
            return []
        pos = bisect.bisect_left(dates, before_date)
        if pos == 0:
            return []
        start = max(0, pos - max_n)
        return list(reversed(idx_data[key][start:pos]))

    def h2h_before(liga, home, away, before_date, max_n=10):
        key = (liga, home, away)
        matches = h2h_idx.get(key, [])
        # Filtra por data e pega mais recentes
        recent = [(d, hg, ag) for d, hg, ag in matches if d < before_date]
        return recent[-max_n:] if len(recent) > max_n else recent

    def stats(hist, team):
        gm, gs, btts, pts5 = [], [], [], []
        esc_list, ch_list, sot_list, cards_list, fl_list = [], [], [], [], []

        for i, (_, ht, at, hg, ag, hg_ht, ag_ht, idc) in enumerate(hist):
            is_home = (ht == team)
            if is_home:
                gm.append(hg); gs.append(ag)
            else:
                gm.append(ag); gs.append(hg)
            btts.append(1 if (hg > 0 and ag > 0) else 0)
            if i < 5:
                if is_home:
                    pts5.append(3 if hg > ag else (1 if hg == ag else 0))
                else:
                    pts5.append(3 if ag > hg else (1 if hg == ag else 0))

            # Contagem
            ev = ev_total.get(idc)
            if ev is not None:
                esc_list.append(ev["esc"] / 2)
                ch_list.append(ev["ch"] / 2)
                sot_list.append(ev["sot"] / 2)
                fl_list.append(ev["fl"] / 2)
                cards_list.append(ev["cards"] / 2)

        if not gm:
            return None
        return {
            "avg_gols_marcados": sum(gm) / len(gm),
            "avg_gols_sofridos": sum(gs) / len(gs),
            "n": len(gm),
            "avg_btts": sum(btts) / len(btts),
            "form_pts5": sum(pts5) / len(pts5) if pts5 else 0.0,
            "avg_escanteios": sum(esc_list) / len(esc_list) if esc_list else 0.0,
            "avg_chutes": sum(ch_list) / len(ch_list) if ch_list else 0.0,
            "avg_chutes_alvo": sum(sot_list) / len(sot_list) if sot_list else 0.0,
            "avg_cartoes": sum(cards_list) / len(cards_list) if cards_list else 0.0,
            "avg_faltas": sum(fl_list) / len(fl_list) if fl_list else 0.0,
        }

    def side_stats(hist, team, side):
        gm, gs = [], []
        for _, ht, at, hg, ag, *_ in hist:
            if side == "home" and ht == team:
                gm.append(hg); gs.append(ag)
            elif side == "away" and at == team:
                gm.append(ag); gs.append(hg)
        if not gm:
            return {"avg_gols_marcados": 0.0, "avg_gols_sofridos": 0.0}
        return {
            "avg_gols_marcados": sum(gm) / len(gm),
            "avg_gols_sofridos": sum(gs) / len(gs),
        }

    X, y = [], defaultdict(list)
    skipped = 0
    for liga, home, away, data, hg, ag, hg_ht, ag_ht, idc in rows:
        h_hist = hist_before(liga, home, data)
        a_hist = hist_before(liga, away, data)
        if len(h_hist) < 3 or len(a_hist) < 3:
            skipped += 1
            continue
        h = stats(h_hist, home)
        a = stats(a_hist, away)
        if h is None or a is None:
            skipped += 1
            continue

        h_home = side_stats(h_hist, home, "home")
        a_away = side_stats(a_hist, away, "away")

        h2h_matches = h2h_before(liga, home, away, data)
        h2h_total = [(mg + mg2) for _, mg, mg2 in h2h_matches] if h2h_matches else []
        h2h_btts = [1 if mg > 0 and mg2 > 0 else 0 for _, mg, mg2 in h2h_matches] if h2h_matches else []
        h2h_o25 = [1 if (mg + mg2) > 2 else 0 for _, mg, mg2 in h2h_matches] if h2h_matches else []

        feats = {
            # Gols (10)
            "home_avg_gols_marcados": h["avg_gols_marcados"],
            "home_avg_gols_sofridos": h["avg_gols_sofridos"],
            "home_n_jogos": h["n"],
            "home_avg_btts": h["avg_btts"],
            "home_form_pts5": h["form_pts5"],
            "away_avg_gols_marcados": a["avg_gols_marcados"],
            "away_avg_gols_sofridos": a["avg_gols_sofridos"],
            "away_n_jogos": a["n"],
            "away_avg_btts": a["avg_btts"],
            "away_form_pts5": a["form_pts5"],
            # Contagem (10)
            "home_avg_escanteios": h["avg_escanteios"],
            "home_avg_chutes": h["avg_chutes"],
            "home_avg_chutes_alvo": h["avg_chutes_alvo"],
            "home_avg_cartoes": h["avg_cartoes"],
            "home_avg_faltas": h["avg_faltas"],
            "away_avg_escanteios": a["avg_escanteios"],
            "away_avg_chutes": a["avg_chutes"],
            "away_avg_chutes_alvo": a["avg_chutes_alvo"],
            "away_avg_cartoes": a["avg_cartoes"],
            "away_avg_faltas": a["avg_faltas"],
            # Splits (4)
            "home_home_avg_gols_marcados": h_home["avg_gols_marcados"],
            "home_home_avg_gols_sofridos": h_home["avg_gols_sofridos"],
            "away_away_avg_gols_marcados": a_away["avg_gols_marcados"],
            "away_away_avg_gols_sofridos": a_away["avg_gols_sofridos"],
            # H2H (4)
            "h2h_avg_total_goals": sum(h2h_total) / len(h2h_total) if h2h_total else 0.0,
            "h2h_btts_rate": sum(h2h_btts) / len(h2h_btts) if h2h_btts else 0.0,
            "h2h_over25_rate": sum(h2h_o25) / len(h2h_o25) if h2h_o25 else 0.0,
            "h2h_n_games": len(h2h_matches),
            # Diferenças (4)
            "diff_avg_marcados": h["avg_gols_marcados"] - a["avg_gols_marcados"],
            "diff_avg_sofridos": h["avg_gols_sofridos"] - a["avg_gols_sofridos"],
            "diff_avg_escanteios": h["avg_escanteios"] - a["avg_escanteios"],
            "diff_avg_chutes": h["avg_chutes"] - a["avg_chutes"],
        }
        X.append([feats[k] for k in FEATURE_NAMES])
        total = hg + ag
        total_ht = (hg_ht or 0) + (ag_ht or 0) if hg_ht is not None else None

        # ── GOLS FT ──
        y["gols_total_ft_over_0_5"].append(1 if total > 0 else 0)
        y["gols_total_ft_over_1_5"].append(1 if total > 1 else 0)
        y["gols_total_ft_over_2_5"].append(1 if total > 2 else 0)
        y["gols_total_ft_over_3_5"].append(1 if total > 3 else 0)
        y["gols_total_ft_over_4_5"].append(1 if total > 4 else 0)

        # ── GOLS HT ──
        if total_ht is not None:
            y["gols_total_ht_over_0_5"].append(1 if total_ht > 0 else 0)
            y["gols_total_ht_over_1_5"].append(1 if total_ht > 1 else 0)
        else:
            y["gols_total_ht_over_0_5"].append(-1)
            y["gols_total_ht_over_1_5"].append(-1)

        # ── BTTS ──
        btts_val = 1 if hg > 0 and ag > 0 else 0
        y["btts_total_ft_sim"].append(btts_val)

        # ── 1x2 ──
        y["1x2_total_ft_home"].append(1 if hg > ag else 0)
        y["1x2_total_ft_draw"].append(1 if hg == ag else 0)
        y["1x2_total_ft_away"].append(1 if ag > hg else 0)

        # ── CONTAGEM (escanteios, cartões, chutes, faltas) ──
        ev = ev_total.get(idc)
        if ev is not None:
            esc, cards, ch, sot, fl = ev["esc"], ev["cards"], ev["ch"], ev["sot"], ev["fl"]
            # Escanteios
            y["escanteios_total_ft_over_7_5"].append(1 if esc > 7 else 0)
            y["escanteios_total_ft_over_8_5"].append(1 if esc > 8 else 0)
            y["escanteios_total_ft_over_9_5"].append(1 if esc > 9 else 0)
            y["escanteios_total_ft_over_10_5"].append(1 if esc > 10 else 0)
            y["escanteios_total_ft_over_11_5"].append(1 if esc > 11 else 0)
            # Cartões
            y["cartoes_total_ft_over_2_5"].append(1 if cards > 2 else 0)
            y["cartoes_total_ft_over_3_5"].append(1 if cards > 3 else 0)
            y["cartoes_total_ft_over_4_5"].append(1 if cards > 4 else 0)
            y["cartoes_total_ft_over_5_5"].append(1 if cards > 5 else 0)
            # Chutes
            y["chutes_total_ft_over_19_5"].append(1 if ch > 19 else 0)
            y["chutes_total_ft_over_21_5"].append(1 if ch > 21 else 0)
            y["chutes_total_ft_over_23_5"].append(1 if ch > 23 else 0)
            y["chutes_total_ft_over_25_5"].append(1 if ch > 25 else 0)
            # Faltas
            y["faltas_total_ft_over_19_5"].append(1 if fl > 19 else 0)
            y["faltas_total_ft_over_21_5"].append(1 if fl > 21 else 0)
            y["faltas_total_ft_over_23_5"].append(1 if fl > 23 else 0)
            y["faltas_total_ft_over_25_5"].append(1 if fl > 25 else 0)
        else:
            for k in ("escanteios_total_ft_over_7_5", "escanteios_total_ft_over_8_5",
                       "escanteios_total_ft_over_9_5", "escanteios_total_ft_over_10_5",
                       "escanteios_total_ft_over_11_5",
                       "cartoes_total_ft_over_2_5", "cartoes_total_ft_over_3_5",
                       "cartoes_total_ft_over_4_5", "cartoes_total_ft_over_5_5",
                       "chutes_total_ft_over_19_5", "chutes_total_ft_over_21_5",
                       "chutes_total_ft_over_23_5", "chutes_total_ft_over_25_5",
                       "faltas_total_ft_over_19_5", "faltas_total_ft_over_21_5",
                       "faltas_total_ft_over_23_5", "faltas_total_ft_over_25_5"):
                y[k].append(-1)

    print(f"[train] usadas: {len(X)}, descartadas (hist<3): {skipped}", flush=True)
    return np.array(X), {k: np.array(v) for k, v in y.items()}


# ---------------------------------------------------------------------------
# Walk-forward training + final model
# ---------------------------------------------------------------------------

def walk_forward_eval(X, y, n_folds=N_WF_FOLDS) -> list[dict]:
    """Walk-forward temporal: expanding window, n_folds test slices.

    Retorna lista de {fold, n_train, n_test, brier, log_loss, base_rate}.
    """
    n = len(X)
    test_size = max(50, int(n * WF_TEST_SHARE))
    folds = []

    for i in range(n_folds):
        test_end = n - i * test_size
        test_start = test_end - test_size
        if test_start < MIN_TRAIN_SAMPLES:
            break
        train_end = test_start

        X_tr, y_tr = X[:train_end], y[:train_end]
        X_te, y_te = X[test_start:test_end], y[test_start:test_end]

        if len(X_te) < 20 or y_tr.sum() == 0 or y_tr.sum() == len(y_tr):
            continue
        if y_te.sum() == 0 or y_te.sum() == len(y_te):
            continue

        clf, backend = make_classifier()
        clf.fit(X_tr, y_tr)
        p_te = clf.predict_proba(X_te)[:, 1]
        folds.append({
            "fold": len(folds),
            "n_train": int(len(X_tr)),
            "n_test": int(len(X_te)),
            "brier": float(brier_score_loss(y_te, p_te)),
            "log_loss": float(log_loss(y_te, np.clip(p_te, 1e-6, 1 - 1e-6))),
            "base_rate": float(y_tr.mean()),
            "backend": backend,
        })

    return folds


def train_one(X, y, name: str) -> dict:
    """Treina um target com walk-forward validation + modelo final em 100% dos dados."""
    # Remove linhas com target ausente (-1 sentinel)
    mask = y != -1
    X_clean = X[mask]
    y_clean = y[mask]
    if len(X_clean) < MIN_TRAIN_SAMPLES:
        return {"name": name, "skipped": True, "reason": "below_min_samples", "n": int(len(X_clean))}
    if y_clean.sum() == 0 or y_clean.sum() == len(y_clean):
        return {"name": name, "skipped": True, "reason": "degenerate_target", "n": int(len(X_clean))}

    # Walk-forward validation (métricas honestas)
    folds = walk_forward_eval(X_clean, y_clean)
    if not folds:
        return {"name": name, "skipped": True, "reason": "walk_forward_failed", "n": int(len(X_clean))}

    avg_brier = float(np.mean([f["brier"] for f in folds]))
    avg_ll = float(np.mean([f["log_loss"] for f in folds]))

    # Modelo final: treina em 100% dos dados válidos
    clf, backend = make_classifier()
    clf.fit(X_clean, y_clean)
    base_rate = float(y_clean.mean())

    out_path = MODELS_DIR / f"{name}.joblib"
    joblib.dump({"model": clf, "features": FEATURE_NAMES, "backend": backend}, out_path)

    return {
        "name": name, "skipped": False, "n": int(len(X_clean)),
        "base_rate": base_rate,
        "wf_avg_brier": round(avg_brier, 6),
        "wf_avg_log_loss": round(avg_ll, 6),
        "wf_folds": len(folds),
        "wf_detail": folds,
        "backend": backend, "path": str(out_path.name),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    db_path = os.environ.get("SCOUT_DB")
    if not db_path:
        print("ERRO: SCOUT_DB env required", file=sys.stderr)
        sys.exit(1)

    t0 = time.perf_counter()
    con = sqlite3.connect(db_path)
    X, ys = build_dataset(con)
    print(f"[train] X.shape: {X.shape}", flush=True)
    print(f"[train] targets: {len(ys)} — {sorted(ys.keys())}", flush=True)
    t_data = time.perf_counter() - t0

    manifest = {
        "version": "0.4.0",
        "feature_set": "v3",
        "feature_names": FEATURE_NAMES,
        "n_features": len(FEATURE_NAMES),
        "min_train_samples": MIN_TRAIN_SAMPLES,
        "validation_strategy": f"walk_forward_{N_WF_FOLDS}_folds",
        "backend_preference": BACKEND,
        "models_dir": str(MODELS_DIR),
        "backends_available": {"xgboost": HAS_XGB, "lightgbm": HAS_LGBM, "sklearn_gbc": True},
        "dataset_build_seconds": round(t_data, 1),
        "models": [],
    }

    t_train = time.perf_counter()
    trained, skipped = 0, 0
    for name, target_y in sorted(ys.items()):
        res = train_one(X, target_y, name)
        manifest["models"].append(res)
        if res.get("skipped"):
            skipped += 1
            print(f"  SKIP {name}: {res.get('reason')} (n={res.get('n')})", flush=True)
        else:
            trained += 1
            print(f"  OK   {name}: brier={res['wf_avg_brier']:.4f} ll={res['wf_avg_log_loss']:.4f} "
                  f"n={res['n']} folds={res['wf_folds']} backend={res['backend']}", flush=True)

    manifest["total_trained"] = trained
    manifest["total_skipped"] = skipped
    manifest["train_seconds"] = round(time.perf_counter() - t_train, 1)
    manifest["total_seconds"] = round(time.perf_counter() - t0, 1)

    with open(MODELS_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n[train] Done: {trained} trained, {skipped} skipped in {manifest['total_seconds']}s", flush=True)
    print(f"[train] manifest -> {MODELS_DIR / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
