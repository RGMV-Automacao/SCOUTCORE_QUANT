"""
features.py — extração de features rolling para Engine B.

Para uma partida `(home, away, data)`, calcula features olhando APENAS para
partidas anteriores a `data` (zero leakage). Evita uso de team_profile_v2
porque é estado atual, não histórico.

Features (12):
  home_avg_gols_marcados, home_avg_gols_sofridos, home_n_jogos,
  away_avg_gols_marcados, away_avg_gols_sofridos, away_n_jogos,
  home_avg_btts, away_avg_btts,
  home_form_pts5, away_form_pts5,        # pts médios últimos 5
  diff_avg_marcados, diff_avg_sofridos
"""
import sqlite3
from collections import defaultdict
from typing import Optional


def _get_team_history(con: sqlite3.Connection, liga: str, team: str, before_date: str, max_n: int = 30):
    """Retorna lista de partidas do time anteriores a `before_date`, mais recente primeiro."""
    cur = con.execute(
        """
        SELECT data_partida, home_team, away_team, home_goals, away_goals
        FROM partidas
        WHERE liga = ?
          AND status = 'Played'
          AND modo = 'FT'
          AND home_goals IS NOT NULL
          AND data_partida < ?
          AND (home_team = ? OR away_team = ?)
        ORDER BY data_partida DESC
        LIMIT ?
        """,
        (liga, before_date, team, team, max_n),
    )
    return cur.fetchall()


def extract_features(con: sqlite3.Connection, liga: str, home: str, away: str, data: str) -> Optional[dict]:
    h_hist = _get_team_history(con, liga, home, data)
    a_hist = _get_team_history(con, liga, away, data)
    if len(h_hist) < 3 or len(a_hist) < 3:
        return None  # honesto: amostra insuficiente

    def stats(hist, team):
        gm, gs, btts, pts5 = [], [], [], []
        for i, row in enumerate(hist):
            _, ht, at, hg, ag = row
            if ht == team:
                gm.append(hg); gs.append(ag)
                if hg > 0 and ag > 0: btts.append(1)
                else: btts.append(0)
                if i < 5:
                    if hg > ag: pts5.append(3)
                    elif hg == ag: pts5.append(1)
                    else: pts5.append(0)
            else:
                gm.append(ag); gs.append(hg)
                if hg > 0 and ag > 0: btts.append(1)
                else: btts.append(0)
                if i < 5:
                    if ag > hg: pts5.append(3)
                    elif hg == ag: pts5.append(1)
                    else: pts5.append(0)
        return {
            "avg_gols_marcados": sum(gm) / len(gm),
            "avg_gols_sofridos": sum(gs) / len(gs),
            "n": len(gm),
            "avg_btts": sum(btts) / len(btts),
            "form_pts5": sum(pts5) / len(pts5) if pts5 else 0.0,
        }

    h = stats(h_hist, home)
    a = stats(a_hist, away)
    return {
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


FEATURE_NAMES = [
    "home_avg_gols_marcados", "home_avg_gols_sofridos", "home_n_jogos",
    "home_avg_btts", "home_form_pts5",
    "away_avg_gols_marcados", "away_avg_gols_sofridos", "away_n_jogos",
    "away_avg_btts", "away_form_pts5",
    "diff_avg_marcados", "diff_avg_sofridos",
]
