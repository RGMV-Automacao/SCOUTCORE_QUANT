"""
train.py — treina Engine B (GradientBoostingClassifier) por (family, direction, line).

Famílias suportadas (escopo limitado e honesto):
  - gols_total_ft over 1.5 / 2.5 / 3.5
  - btts_sim
  - 1x2_home / 1x2_draw / 1x2_away

Não treina escanteios/cartões/chutes/faltas (dados não disponíveis em `partidas`).

Salva: models/{key}.joblib + models/manifest.json com metadados.
"""
import json
import os
import sqlite3
import sys
from pathlib import Path
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import brier_score_loss, log_loss
import joblib

# Add this dir to path so 'features' import works regardless of cwd
sys.path.insert(0, str(Path(__file__).resolve().parent))
from features import extract_features, FEATURE_NAMES  # noqa: E402

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

MIN_TRAIN_SAMPLES = 200


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
        SELECT liga, home_team, away_team, data_partida, home_goals, away_goals
        FROM partidas
        WHERE {' AND '.join(where)}
        ORDER BY data_partida ASC
    """
    rows = con.execute(sql, params).fetchall()
    print(f"[train] partidas Played: {len(rows)}", flush=True)

    # Index por (liga, team): listas paralelas (datas, payloads)
    idx_dates: dict[tuple, list[str]] = defaultdict(list)
    idx_data: dict[tuple, list[tuple]] = defaultdict(list)
    for liga, h, a, d, hg, ag in rows:
        idx_dates[(liga, h)].append(d); idx_data[(liga, h)].append((d, h, a, hg, ag))
        idx_dates[(liga, a)].append(d); idx_data[(liga, a)].append((d, h, a, hg, ag))

    def hist_before(liga, team, before_date, max_n=30):
        key = (liga, team)
        dates = idx_dates.get(key)
        if not dates: return []
        # bisect_left para incluir apenas datas estritamente menores
        pos = bisect.bisect_left(dates, before_date)
        if pos == 0: return []
        # pega últimos max_n antes de pos, em ordem decrescente
        start = max(0, pos - max_n)
        return list(reversed(idx_data[key][start:pos]))

    def stats(hist, team):
        gm, gs, btts, pts5 = [], [], [], []
        for i, (_, ht, at, hg, ag) in enumerate(hist):
            if ht == team:
                gm.append(hg); gs.append(ag)
                btts.append(1 if (hg > 0 and ag > 0) else 0)
                if i < 5:
                    pts5.append(3 if hg > ag else (1 if hg == ag else 0))
            else:
                gm.append(ag); gs.append(hg)
                btts.append(1 if (hg > 0 and ag > 0) else 0)
                if i < 5:
                    pts5.append(3 if ag > hg else (1 if hg == ag else 0))
        if not gm: return None
        return {
            "avg_gols_marcados": sum(gm) / len(gm),
            "avg_gols_sofridos": sum(gs) / len(gs),
            "n": len(gm),
            "avg_btts": sum(btts) / len(btts),
            "form_pts5": sum(pts5) / len(pts5) if pts5 else 0.0,
        }

    X, y_over15, y_over25, y_over35, y_btts, y_home, y_draw, y_away = [], [], [], [], [], [], [], []
    skipped = 0
    for liga, home, away, data, hg, ag in rows:
        h_hist = hist_before(liga, home, data)
        a_hist = hist_before(liga, away, data)
        if len(h_hist) < 3 or len(a_hist) < 3:
            skipped += 1; continue
        h = stats(h_hist, home); a = stats(a_hist, away)
        if h is None or a is None:
            skipped += 1; continue
        feats = {
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
            "diff_avg_marcados": h["avg_gols_marcados"] - a["avg_gols_marcados"],
            "diff_avg_sofridos": h["avg_gols_sofridos"] - a["avg_gols_sofridos"],
        }
        X.append([feats[k] for k in FEATURE_NAMES])
        total = hg + ag
        y_over15.append(1 if total > 1 else 0)
        y_over25.append(1 if total > 2 else 0)
        y_over35.append(1 if total > 3 else 0)
        y_btts.append(1 if hg > 0 and ag > 0 else 0)
        y_home.append(1 if hg > ag else 0)
        y_draw.append(1 if hg == ag else 0)
        y_away.append(1 if ag > hg else 0)
    print(f"[train] usadas: {len(X)}, descartadas (hist<3): {skipped}", flush=True)
    return np.array(X), {
        "gols_total_ft_over_1_5": np.array(y_over15),
        "gols_total_ft_over_2_5": np.array(y_over25),
        "gols_total_ft_over_3_5": np.array(y_over35),
        "btts_sim": np.array(y_btts),
        "1x2_home": np.array(y_home),
        "1x2_draw": np.array(y_draw),
        "1x2_away": np.array(y_away),
    }


def train_one(X, y, name: str) -> dict:
    if len(X) < MIN_TRAIN_SAMPLES:
        return {"name": name, "skipped": True, "reason": "below_min_samples", "n": int(len(X))}
    if y.sum() == 0 or y.sum() == len(y):
        return {"name": name, "skipped": True, "reason": "degenerate_target", "n": int(len(X))}

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.20, random_state=42, stratify=y)
    clf = GradientBoostingClassifier(
        n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.85, random_state=42,
    )
    clf.fit(X_tr, y_tr)
    p_te = clf.predict_proba(X_te)[:, 1]
    brier = float(brier_score_loss(y_te, p_te))
    ll = float(log_loss(y_te, np.clip(p_te, 1e-6, 1 - 1e-6)))
    base_rate = float(y_tr.mean())

    out_path = MODELS_DIR / f"{name}.joblib"
    joblib.dump({"model": clf, "features": FEATURE_NAMES}, out_path)
    return {
        "name": name, "skipped": False, "n": int(len(X)),
        "n_train": int(len(X_tr)), "n_test": int(len(X_te)),
        "base_rate": base_rate, "brier": brier, "log_loss": ll,
        "path": str(out_path.name),
    }


def main():
    db_path = os.environ.get("SCOUT_DB")
    if not db_path:
        print("ERRO: SCOUT_DB env required", file=sys.stderr)
        sys.exit(1)
    con = sqlite3.connect(db_path)
    X, ys = build_dataset(con)
    print(f"[train] X.shape: {X.shape}", flush=True)

    manifest = {
        "version": "0.1.0",
        "feature_names": FEATURE_NAMES,
        "min_train_samples": MIN_TRAIN_SAMPLES,
        "models": [],
    }
    for name, y in ys.items():
        res = train_one(X, y, name)
        manifest["models"].append(res)
        print(f"  {name}: {res}", flush=True)

    with open(MODELS_DIR / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
    print(f"[train] manifest -> {MODELS_DIR / 'manifest.json'}", flush=True)


if __name__ == "__main__":
    main()
