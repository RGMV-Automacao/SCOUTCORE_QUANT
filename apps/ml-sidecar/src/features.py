"""
features.py — extração de features rolling para Engine B (v3).

Para uma partida `(home, away, data)`, calcula features olhando APENAS para
partidas anteriores a `data` (zero leakage). Evita uso de team_profile_v2
porque é estado atual, não histórico.

Feature set v3 (32 features):
  Gols (10):
    home/away: avg_gols_marcados, avg_gols_sofridos, n_jogos, avg_btts, form_pts5
  Contagem (10):
    home/away: avg_escanteios, avg_chutes, avg_chutes_alvo, avg_cartoes, avg_faltas
  Splits (4):
    home_home_avg_gols_marcados, home_home_avg_gols_sofridos   (time da casa jogando EM CASA)
    away_away_avg_gols_marcados, away_away_avg_gols_sofridos   (time de fora jogando FORA)
  H2H (4):
    h2h_avg_total_goals, h2h_btts_rate, h2h_over25_rate, h2h_n_games
  Diferenças (4):
    diff_avg_marcados, diff_avg_sofridos, diff_avg_escanteios, diff_avg_chutes
"""
import sqlite3
from typing import Optional


# ---------------------------------------------------------------------------
# Queries — partidas
# ---------------------------------------------------------------------------

_SQL_TEAM_HIST = """
    SELECT data_partida, home_team, away_team, home_goals, away_goals,
           home_goals_ht, away_goals_ht, id_confronto
    FROM partidas
    WHERE liga = ?
      AND status = 'Played'
      AND home_goals IS NOT NULL
      AND data_partida < ?
      AND (home_team = ? OR away_team = ?)
    ORDER BY data_partida DESC
    LIMIT ?
"""

_SQL_H2H = """
    SELECT home_goals, away_goals
    FROM partidas
    WHERE liga = ?
      AND status = 'Played'
      AND home_goals IS NOT NULL
      AND data_partida < ?
      AND ((home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?))
    ORDER BY data_partida DESC
    LIMIT ?
"""


def _get_team_history(con: sqlite3.Connection, liga: str, team: str,
                      before_date: str, max_n: int = 30) -> list:
    """Retorna lista de partidas do time anteriores a `before_date`, mais recente primeiro."""
    return con.execute(_SQL_TEAM_HIST, (liga, before_date, team, team, max_n)).fetchall()


def _get_h2h(con: sqlite3.Connection, liga: str, home: str, away: str,
             before_date: str, max_n: int = 10) -> list:
    """Retorna confrontos diretos H2H, mais recente primeiro."""
    return con.execute(_SQL_H2H, (liga, before_date, home, away, away, home, max_n)).fetchall()


# ---------------------------------------------------------------------------
# times — totais por confronto/equipe (modo='FT'). Fonte canônica desde a
# Fase 4 do refactor Superbet v2.0.0; `eventos_faixa` foi descontinuada
# como leitura.
# ---------------------------------------------------------------------------

_SQL_EV_TOTALS_BY_TEAM = """
    SELECT escanteios, chutes, chutes_no_alvo, faltas,
           COALESCE(cartoes_amarelos, 0) + COALESCE(cartoes_vermelhos, 0) AS cards
      FROM times
     WHERE id_confronto = ?
       AND time = ?
       AND modo = 'FT'
     LIMIT 1
"""


def _get_event_totals(con: sqlite3.Connection, id_confronto: str,
                      team: str) -> Optional[dict]:
    """Totais por equipe para um confronto. None se não houver dados."""
    row = con.execute(_SQL_EV_TOTALS_BY_TEAM, (id_confronto, team)).fetchone()
    if row is None or row[0] is None:
        return None
    return {
        "escanteios": row[0] or 0,
        "chutes": row[1] or 0,
        "chutes_alvo": row[2] or 0,
        "faltas": row[3] or 0,
        "cartoes": row[4] or 0,
    }


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def _team_stats(hist: list, team: str, con: sqlite3.Connection = None) -> Optional[dict]:
    """Calcula estatísticas de gols + contagem a partir do histórico.

    `hist` rows: (data_partida, home_team, away_team, home_goals, away_goals,
                  home_goals_ht, away_goals_ht, id_confronto)
    """
    if not hist:
        return None

    gm, gs, btts, pts5 = [], [], [], []
    # Side-specific (casa/fora)
    gm_side, gs_side, n_side = [], [], 0
    # Contagem acumulada
    esc_list, ch_list, sot_list, cards_list, fl_list = [], [], [], [], []

    for i, row in enumerate(hist):
        _, ht, at, hg, ag, hg_ht, ag_ht, idc = row
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

        # Contagem por confronto — `times` (modo='FT'), per-team direto.
        if con is not None and idc:
            ev = _get_event_totals(con, idc, team)
            if ev is not None:
                esc_list.append(ev["escanteios"])
                ch_list.append(ev["chutes"])
                sot_list.append(ev["chutes_alvo"])
                fl_list.append(ev["faltas"])
                cards_list.append(ev["cartoes"])

    if not gm:
        return None

    out = {
        "avg_gols_marcados": sum(gm) / len(gm),
        "avg_gols_sofridos": sum(gs) / len(gs),
        "n": len(gm),
        "avg_btts": sum(btts) / len(btts),
        "form_pts5": sum(pts5) / len(pts5) if pts5 else 0.0,
    }

    # Contagem (média por partida do time)
    out["avg_escanteios"] = sum(esc_list) / len(esc_list) if esc_list else 0.0
    out["avg_chutes"] = sum(ch_list) / len(ch_list) if ch_list else 0.0
    out["avg_chutes_alvo"] = sum(sot_list) / len(sot_list) if sot_list else 0.0
    out["avg_cartoes"] = sum(cards_list) / len(cards_list) if cards_list else 0.0
    out["avg_faltas"] = sum(fl_list) / len(fl_list) if fl_list else 0.0

    return out


def _side_stats(hist: list, team: str, side: str) -> dict:
    """Gols marcados/sofridos filtrados por side (casa/fora)."""
    gm, gs = [], []
    for row in hist:
        _, ht, at, hg, ag, *_ = row
        if side == "home" and ht == team:
            gm.append(hg); gs.append(ag)
        elif side == "away" and at == team:
            gm.append(ag); gs.append(hg)

    if not gm:
        return {"avg_gols_marcados": 0.0, "avg_gols_sofridos": 0.0, "n": 0}

    return {
        "avg_gols_marcados": sum(gm) / len(gm),
        "avg_gols_sofridos": sum(gs) / len(gs),
        "n": len(gm),
    }


def _h2h_stats(h2h_rows: list) -> dict:
    """Estatísticas de confrontos diretos."""
    if not h2h_rows:
        return {"avg_total_goals": 0.0, "btts_rate": 0.0, "over25_rate": 0.0, "n": 0}

    total_goals = [hg + ag for hg, ag in h2h_rows]
    btts = [1 if (hg > 0 and ag > 0) else 0 for hg, ag in h2h_rows]
    over25 = [1 if (hg + ag) > 2 else 0 for hg, ag in h2h_rows]

    return {
        "avg_total_goals": sum(total_goals) / len(total_goals),
        "btts_rate": sum(btts) / len(btts),
        "over25_rate": sum(over25) / len(over25),
        "n": len(h2h_rows),
    }


# ---------------------------------------------------------------------------
# Extração principal
# ---------------------------------------------------------------------------

def extract_features(con: sqlite3.Connection, liga: str, home: str, away: str,
                     data: str) -> Optional[dict]:
    """Extrai 32 features para uma partida futura. Retorna None se amostra insuficiente."""
    h_hist = _get_team_history(con, liga, home, data)
    a_hist = _get_team_history(con, liga, away, data)
    if len(h_hist) < 3 or len(a_hist) < 3:
        return None  # honesto: amostra insuficiente

    h = _team_stats(h_hist, home, con)
    a = _team_stats(a_hist, away, con)
    if h is None or a is None:
        return None

    # Splits casa/fora
    h_home = _side_stats(h_hist, home, "home")
    a_away = _side_stats(a_hist, away, "away")

    # H2H
    h2h_rows = _get_h2h(con, liga, home, away, data)
    h2h = _h2h_stats(h2h_rows)

    return {
        # --- Gols (10) ---
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
        # --- Contagem (10) ---
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
        # --- Splits (4) ---
        "home_home_avg_gols_marcados": h_home["avg_gols_marcados"],
        "home_home_avg_gols_sofridos": h_home["avg_gols_sofridos"],
        "away_away_avg_gols_marcados": a_away["avg_gols_marcados"],
        "away_away_avg_gols_sofridos": a_away["avg_gols_sofridos"],
        # --- H2H (4) ---
        "h2h_avg_total_goals": h2h["avg_total_goals"],
        "h2h_btts_rate": h2h["btts_rate"],
        "h2h_over25_rate": h2h["over25_rate"],
        "h2h_n_games": h2h["n"],
        # --- Diferenças (4) ---
        "diff_avg_marcados": h["avg_gols_marcados"] - a["avg_gols_marcados"],
        "diff_avg_sofridos": h["avg_gols_sofridos"] - a["avg_gols_sofridos"],
        "diff_avg_escanteios": h["avg_escanteios"] - a["avg_escanteios"],
        "diff_avg_chutes": h["avg_chutes"] - a["avg_chutes"],
    }


FEATURE_NAMES = [
    # Gols (10)
    "home_avg_gols_marcados", "home_avg_gols_sofridos", "home_n_jogos",
    "home_avg_btts", "home_form_pts5",
    "away_avg_gols_marcados", "away_avg_gols_sofridos", "away_n_jogos",
    "away_avg_btts", "away_form_pts5",
    # Contagem (10)
    "home_avg_escanteios", "home_avg_chutes", "home_avg_chutes_alvo",
    "home_avg_cartoes", "home_avg_faltas",
    "away_avg_escanteios", "away_avg_chutes", "away_avg_chutes_alvo",
    "away_avg_cartoes", "away_avg_faltas",
    # Splits (4)
    "home_home_avg_gols_marcados", "home_home_avg_gols_sofridos",
    "away_away_avg_gols_marcados", "away_away_avg_gols_sofridos",
    # H2H (4)
    "h2h_avg_total_goals", "h2h_btts_rate", "h2h_over25_rate", "h2h_n_games",
    # Diferenças (4)
    "diff_avg_marcados", "diff_avg_sofridos",
    "diff_avg_escanteios", "diff_avg_chutes",
]
