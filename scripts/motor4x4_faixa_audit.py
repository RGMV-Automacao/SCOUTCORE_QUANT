#!/usr/bin/env python3
# ==============================================================================
#  Motor 4x4 — Análise empírica de mercados 10min sobre eventos_faixa
# ==============================================================================
#  Autor: consultoria — sessão de validação v1.2 (07/05/2026)
#  Objetivo: validar com DADOS REAIS (não suposição) se mercados de bandas 10min
#  têm valor estatístico antes de incluir no roadmap (v1.5).
#
#  PRINCÍPIO: "se tiver valor, não aceite apenas para agradar". Toda decisão
#  arquitetural sobre incluir/excluir mercado precisa de % real do banco.
#
#  Pré-requisitos:
#    - Python 3.11+ (sqlite3 vem na stdlib, zero dependência externa)
#    - opta.db acessível em ./db/opta.db (1.46 GB)
#    - Tabela eventos_faixa com schema:
#        (liga, id_confronto, time, faixa, escanteios, chutes,
#         chutes_no_alvo, faltas, cartoes_amarelos, cartoes_vermelhos,
#         gols, impedimentos)
#      onde faixa ∈ {'0-10','11-20','21-30','31-40','41-50',
#                    '51-60','61-70','71-80','81-90'}
#
#  Como rodar:
#      cd opta-extractor
#      python motor4x4_faixa_audit.py
#
#  O que ele entrega:
#    1) Total de partidas e linhas (sanity check do banco)
#    2) Distribuição por liga (qualifica para stacking v1.4 / não qualifica)
#    3) Para CADA mercado 10min relevante (Total Over 0.5, Total Under 1.5,
#       Time Over 0.5, Time Under 0.5), o hit-rate empírico = fair_prob real
#    4) Times com taxa extrema (≥70% em mercado de equipe), úteis para v1.5
# ==============================================================================

import sqlite3
import os
from collections import defaultdict

DB_PATH = os.path.join("db", "opta.db")  # ajuste se rodar de outro cwd
LIGAS_FOCO = ["brasileirao", "serie-a"]   # 6 ligas principais qualificam; aqui foquei 2 para output curto
FAIXA_ALVO = "0-10"                       # mude para '11-20' etc para outras bandas
MIN_JOGOS_TIME = 50                       # threshold para considerar amostra de time confiável
TAXA_EXTREMA = 0.70                       # ≥70% vira "pick value" candidato

# ──────────────────────────────────────────────────────────────────────────────
# Conexão SQLite — read-only é boa prática para auditoria, evita lock acidental
# ──────────────────────────────────────────────────────────────────────────────
def conectar(path):
    if not os.path.exists(path):
        raise FileNotFoundError(f"DB não encontrado em {path}")
    # uri=True permite parâmetro mode=ro
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    return con


# ──────────────────────────────────────────────────────────────────────────────
# Sanity check — sempre comece confirmando volume antes de tirar conclusões
# ──────────────────────────────────────────────────────────────────────────────
def sanity_check(cur):
    print("=" * 78)
    print("SANITY CHECK")
    print("=" * 78)

    n_partidas = cur.execute("SELECT COUNT(*) FROM partidas").fetchone()[0]
    n_eventos  = cur.execute("SELECT COUNT(*) FROM eventos_faixa").fetchone()[0]
    print(f"  partidas:         {n_partidas:>8,}")
    print(f"  eventos_faixa:    {n_eventos:>8,}")

    print(f"\n  distribuição por liga (top 13):")
    rows = cur.execute("""
        SELECT liga, COUNT(*) n
        FROM partidas
        GROUP BY liga
        ORDER BY n DESC
        LIMIT 13
    """).fetchall()
    for liga, n in rows:
        # Gate de stacking v1.4: ≥800 jogos efetivos
        gate = "[OK] stacking-ready" if n >= 1500 else ("[~] marginal" if n >= 800 else "[X] low-vol")
        print(f"    {liga:<28} {n:>5,}   {gate}")


# ──────────────────────────────────────────────────────────────────────────────
# Análise dos 4 mercados 10min
#   - TOTAL Over 0.5  → ≥1 escanteio na banda (somando home+away)
#   - TOTAL Under 1.5 → 0 ou 1 escanteio na banda total
#   - TIME Over 0.5   → time individual fez ≥1 escanteio na banda
#   - TIME Under 0.5  → time individual fez 0 escanteio na banda
#
# Para CADA hit-rate, fair_odd = 1 / hit_rate (sem margem). Mercado tem valor
# quando casa paga acima do fair_odd com folga ≥ 2pp (EDGE_MIN_PP).
# ──────────────────────────────────────────────────────────────────────────────
def analisar_mercados_banda(cur, liga, faixa, stat_col):
    print("=" * 78)
    print(f"MERCADO BANDA {faixa}  ·  estatística: {stat_col}  ·  liga: {liga}")
    print("=" * 78)

    # ---- TOTAL CONFRONTO (soma home + away na banda) ----
    rows = cur.execute(f"""
        SELECT id_confronto, SUM({stat_col}) total
        FROM eventos_faixa
        WHERE liga = ? AND faixa = ?
        GROUP BY id_confronto
    """, (liga, faixa)).fetchall()

    n = len(rows)
    if n < 50:
        print(f"  amostra insuficiente: {n} partidas — pulando.")
        return

    over_05  = sum(1 for _, t in rows if t >= 1)   # ≥1 = Over 0.5
    under_15 = sum(1 for _, t in rows if t <= 1)   # ≤1 = Under 1.5
    over_15  = sum(1 for _, t in rows if t >= 2)
    under_05 = sum(1 for _, t in rows if t == 0)

    def fmt(label, k):
        prob = k / n
        fair = 1 / prob if prob > 0 else float("inf")
        print(f"    {label:<28} {prob*100:5.1f}%  ({k:>4}/{n})   fair_odd ≈ {fair:.3f}")

    print(f"  TOTAL CONFRONTO (n={n}):")
    fmt("Total Over  0.5",  over_05)
    fmt("Total Under 1.5",  under_15)
    fmt("Total Over  1.5",  over_15)
    fmt("Total Under 0.5",  under_05)

    # ---- POR TIME (cada linha eventos_faixa = 1 time × 1 banda × 1 jogo) ----
    rows = cur.execute(f"""
        SELECT time,
               COUNT(*) n_jogos,
               SUM(CASE WHEN {stat_col} >= 1 THEN 1 ELSE 0 END) n_over_05,
               SUM(CASE WHEN {stat_col} = 0  THEN 1 ELSE 0 END) n_under_05
        FROM eventos_faixa
        WHERE liga = ? AND faixa = ?
        GROUP BY time
        HAVING n_jogos >= ?
    """, (liga, faixa, MIN_JOGOS_TIME)).fetchall()

    if not rows:
        return

    # Times que NÃO fazem (Under 0.5 individual extremo)
    print(f"\n  TIME Under 0.5 — taxa ≥ {int(TAXA_EXTREMA*100)}% (jogos ≥ {MIN_JOGOS_TIME}):")
    fortes_under = [r for r in rows if r[3] / r[1] >= TAXA_EXTREMA]
    fortes_under.sort(key=lambda r: -r[3]/r[1])
    if not fortes_under:
        print("    nenhum.")
    for time, nj, no, nu in fortes_under[:10]:
        prob = nu / nj
        print(f"    {time:<32} {prob*100:5.1f}%  ({nu}/{nj})   fair_odd ≈ {1/prob:.3f}")

    # Times que SEMPRE fazem (Over 0.5 individual extremo)
    print(f"\n  TIME Over 0.5 — taxa ≥ {int(TAXA_EXTREMA*100)}% (jogos ≥ {MIN_JOGOS_TIME}):")
    fortes_over = [r for r in rows if r[2] / r[1] >= TAXA_EXTREMA]
    fortes_over.sort(key=lambda r: -r[2]/r[1])
    if not fortes_over:
        print("    nenhum.")
    for time, nj, no, nu in fortes_over[:10]:
        prob = no / nj
        print(f"    {time:<32} {prob*100:5.1f}%  ({no}/{nj})   fair_odd ≈ {1/prob:.3f}")
    print()


# ──────────────────────────────────────────────────────────────────────────────
# main — orquestra tudo
# ──────────────────────────────────────────────────────────────────────────────
def main():
    con = conectar(DB_PATH)
    cur = con.cursor()

    sanity_check(cur)

    # Estatísticas que valem investigar nas bandas — escanteios é o caso usado
    # na validação inaugural; cartões e chutes seguem mesmo padrão.
    for stat in ["escanteios", "chutes", "cartoes_amarelos"]:
        for liga in LIGAS_FOCO:
            analisar_mercados_banda(cur, liga, FAIXA_ALVO, stat)

    con.close()


if __name__ == "__main__":
    main()


# ==============================================================================
# NOTAS DIDÁTICAS — por que o script é assim
# ==============================================================================
#
# 1. SQLite read-only via URI:
#       sqlite3.connect(f"file:{path}?mode=ro", uri=True)
#    Garante que mesmo um bug não escreva no banco de produção.
#
# 2. GROUP BY id_confronto + SUM(escanteios):
#    O schema tem 1 linha POR TIME POR BANDA POR JOGO. Para virar "total do
#    confronto" precisa SOMAR home+away — esse é o pulo do gato. Esquecer
#    isso é o erro #1 em análise sobre eventos_faixa.
#
# 3. Threshold MIN_JOGOS_TIME = 50:
#    Abaixo disso, hit-rate vira ruído. Lição da memory:
#    "n < 10 = ruído, não sinal" — mas para mercados extremos (taxa 70%+),
#    50 é mais conservador.
#
# 4. CASE WHEN ... vs COUNT(...) FILTER (WHERE ...):
#    SQLite < 3.30 não tem FILTER. CASE WHEN ... THEN 1 ELSE 0 END dentro de
#    SUM() é o equivalente portável.
#
# 5. fair_odd = 1 / hit_rate:
#    É a "odd justa" sem margem da casa. Comparar com market_odd dá o edge:
#       edge_pct = (market_odd / fair_odd - 1) * 100
#    Esse é o cálculo que o Curinga faz no motor. O script é o backtest manual
#    do que o motor automatiza em produção.
#
# 6. Por que não reusar Pandas:
#    Pandas é ótimo, mas cada import demora 1-2s. Para queries simples sobre
#    SQLite, sqlite3 + tuplas Python é 10x mais rápido para iterar. Para
#    análise exploratória interativa (Jupyter), Pandas vale; para auditoria
#    de produção, stdlib basta.
#
# 7. Fluxo de auditoria que sigo (recomendado para você reproduzir):
#       a) sanity check de volume (não sair tirando conclusão sobre N=10)
#       b) descobrir granularidade real do schema (faixa='0-10' ou minute-level?)
#       c) calcular hit-rate de cada DIREÇÃO do mercado (Over E Under)
#          — sempre olhar os dois lados, nunca só o que confirma a hipótese
#       d) cruzar com filtro de TIME para achar dispersão
#          — média da liga 73% pode esconder times de 50% e times de 90%
#       e) traduzir hit-rate em fair_odd e SÓ ENTÃO opinar sobre valor
#
# ==============================================================================
