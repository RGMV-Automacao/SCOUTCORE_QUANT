# SCOUT IA — Auditoria de Prompts (RM × Oviedo 2026-05-14)

## 1. Perplexity Sonar (camada web)
- url: https://api.perplexity.ai/chat/completions
- model: sonar-pro
- latency: 5593ms
- tokens usage: {"prompt_tokens":1233,"completion_tokens":709,"total_tokens":1942,"search_context_size":"low","cost":{"input_tokens_cost":0.0037,"output_tokens_cost":0.01064,"request_cost":0.006,"total_cost":0.02033}}
- citations: 8

### Request — system
```
Você é um agente de inteligência esportiva para um modelo quantitativo de apostas.
Sua missão: fornecer inteligência concreta sobre o jogo que possa afetar mercados de apostas.

Regras:
- Para fatos DINÂMICOS (lesões, escala, próximos jogos, clima recente): busque na web e cite fontes.
- Para fatos ESTÁTICOS (distância entre cidades, altitude, histórico de rivalidade): use seu próprio conhecimento.
- Se não encontrar informação dinâmica sobre uma categoria, escreva "sem informação".
- Não invente fatos dinâmicos. Seja conciso — cada item em 1-3 linhas.
- Se o espaço for limitado, priorize: (1) próximo compromisso ≤4 dias, (2) desfalques confirmados de titulares, (3) cansaço/viagem do visitante, (4) demais categorias.

Qualidade de fonte:
- Priorize fontes oficiais, liga, clubes, ESPN, SofaScore, Flashscore e veículos jornalísticos reconhecidos.
- Não use YouTube, redes sociais, páginas de odds, páginas de palpite ou live pages como prova única de desfalque, escalação, tabela ou resultado.
- Nunca trate vídeo/highlight/placar futuro como resultado confirmado quando o jogo ainda não tem status final confirmado.
- Não derive STAKES de records soltos em boxscore/live score. Use tabela/classificação somente se a fonte mostrar explicitamente posição, pontos e rodada.
- Se uma fonte parecer placeholder, conflitante ou pós-jogo antes do kickoff informado, escreva "fonte conflitante/ignorada" e não afirme o fato.
- Quando mencionar lesões/suspensões/escalação, indique uma certeza: "confirmado pelo clube", "noticiado" ou "incerto". Nunca misture níveis de certeza na mesma afirmação.
- Não use Markdown.
- Responda exatamente 8 itens numerados, um por categoria, com 1-3 linhas cada.
- Em cada linha, marque CONFIANÇA: alta, média ou baixa.
```

### Request — user (query)
```
DADOS ESTRUTURADOS DO MOTOR (use como âncora; não substitua por páginas genéricas):
- Jogo: Real Madrid x Real Oviedo
- Competição/liga: la-liga
- Data: 2026-05-14 19:30
- Temporada: 2025/2026
- Rodada: 36
- Estádio: Santiago Bernabéu
- Árbitro: Ricardo De Burgos Bengoetxea
- Cidade do jogo: Madrid
- Cidade do visitante: Oviedo

Pesquise APENAS contexto pré-jogo ou contexto atual verificável sobre este confronto.
Se encontrar página com placar/resultado/highlight antes de status final confirmado, ignore essa informação e marque como fonte conflitante.

Pesquise e responda CADA categoria abaixo sobre este jogo:

1. CLÁSSICO/RIVALIDADE — É derby? Intensidade emocional? [impacto: cartões, faltas]
2. STAKES — Situação na tabela. O que está em jogo? [impacto: intensidade, rotação]
3. DESFALQUES CONFIRMADOS — Lesões/suspensões (goleiro titular, artilheiro, armador). [impacto: gols]
4. ESCALAÇÃO / NOVIDADES — Retornos, pistas do técnico, rotação por Copa? [impacto: força real]
5. PRÓXIMO COMPROMISSO de Real Madrid e Real Oviedo — competição, adversário, data; jogo decisivo em ≤4 dias? Time misto? [impacto CRÍTICO: rotação]
6. CLIMA EMOCIONAL / TROCA DE TÉCNICO — troca nas últimas 4 semanas? Crise interna? [impacto: imprevisível]
7. FATORES LOGÍSTICOS:
   a) DISTÂNCIA: Madrid ↔ Oviedo, km aproximados (curta<500 / média 500-1500 / longa>1500 / extrema>2500)
   b) CANSAÇO: último jogo do Real Oviedo antes de 2026-05-14, dias de descanso, foi pesado?
   c) TRIPLA RODADA: Real Oviedo faz >2 jogos em 7 dias?
   d) CLIMA: temperatura/chuva prevista no local do jogo em 2026-05-14 (>30°C? chuva intensa?)
   e) ALTITUDE: local do jogo acima de 700m?
   [impacto: under gols/escanteios visitante, mandante favorecido]
8. ESTATÍSTICA MARCANTE — sequência relevante (invencibilidade, jejum, over/under recente).

Formato obrigatório: exatamente 8 itens numerados, sem Markdown, sem bullets extras.
Cada item: "N. CATEGORIA — fato útil ou sem informação; impacto; certeza/fonte curta; CONFIANÇA: alta|média|baixa".
Se não confirmar uma categoria, escreva "sem informação" e não explique longamente.
Responda em português, categoriado exatamente como acima.
```

### Response — content
```
1. CLÁSSICO/RIVALIDADE — Não é derby local; é confronto interestadual sem rivalidade histórica forte, embora o jogo no Bernabéu eleve a pressão sobre o visitante; impacto moderado em intensidade/faltas. Certeza: estático/conhecimento geral; CONFIANÇA: alta
2. STAKES — Sem informação pré-jogo confiável aqui sobre a tabela completa no momento exato, mas na rodada 36 o Real Madrid aparecia 2º com 77 pts e o Oviedo na parte baixa com 29 pts; impacto: mandante sob pressão por título/vaga, visitante sob risco baixo de rotação defensiva. Fonte curta: ESPN/marcadoresonline (classificação exibida); CONFIANÇA: média
3. DESFALQUES CONFIRMADOS — Sem informação confiável de lesões/suspensões confirmadas no material fornecido; não há prova oficial suficiente para cravar goleiro titular, artilheiro ou armador fora. Certeza: sem informação; CONFIANÇA: baixa
4. ESCALAÇÃO / NOVIDADES — Sem informação pré-jogo verificável sobre retornos, rotação ou pista clara do técnico; as fontes encontradas foram majoritariamente pós-jogo/conflitantes para esse quesito. Certeza: sem informação; CONFIANÇA: baixa
5. PRÓXIMO COMPROMISSO — Sem informação confiável e específica dos próximos jogos de Real Madrid e Real Oviedo dentro de ≤4 dias no material fornecido; por isso não dá para inferir rotação com segurança. Certeza: sem informação; CONFIANÇA: baixa
6. CLIMA EMOCIONAL / TROCA DE TÉCNICO — Sem informação sobre troca de técnico nas últimas 4 semanas ou crise interna antes do jogo; não encontrei fonte dinâmica confiável para sustentar esse ponto. Certeza: sem informação; CONFIANÇA: baixa
7. FATORES LOGÍSTICOS — a) Distância Madrid↔Oviedo: curta-média, aprox. 450 km por estrada/linha aérea curta; b) cansaço do Oviedo: sem informação do último jogo pré-14/05/2026; c) tripla rodada: sem informação; d) clima: sem informação confiável de previsão para 14/05/2026; e) altitude: Santiago Bernabéu está bem abaixo de 700 m, então não há efeito de altitude. Certeza: estático/sem informação dinâmica; CONFIANÇA: média
8. ESTATÍSTICA MARCANTE — Sem informação pré-jogo confiável de sequência relevante específica; as páginas encontradas trazem principalmente o resultado final, então não uso para afirmar tendência anterior sem validação. Certeza: sem informação; CONFIANÇA: baixa
```

## 2. OpenAI GPT-4o (cérebro)
- url: https://api.openai.com/v1/chat/completions
- model: gpt-4o
- latency: 2233ms
- tokens usage: {"prompt_tokens":2353,"completion_tokens":285,"total_tokens":2638,"prompt_tokens_details":{"cached_tokens":1024,"audio_tokens":0},"completion_tokens_details":{"reasoning_tokens":0,"audio_tokens":0,"accepted_prediction_tokens":0,"rejected_prediction_tokens":0}}
- response_format: {"type":"json_object"}

### Request — system
```
Você é o SCOUT — analista quantitativo-qualitativo de apostas esportivas.

## Papel
Você não valida predições. Você questiona o edge encontrado pelo motor:
"Por que o mercado está pagando mais do que os modelos acham justo?"

- Se não encontrar razão contextual → edge provavelmente real → confidence_delta positivo
- Se encontrar razão contextual que explica o edge → red_flag + confidence_delta negativo

## O que você recebe
1. Top slots com edge positivo (fair_prob, market_odd, edge_pct, confidence)
2. Perfil estatístico dos times (médias de gols, escanteios, cartões, etc.)
3. Forma recente / variância dos top slots (min, max, últimos valores quando disponível)
4. Contexto da partida (liga, data, regime hints quando disponíveis)

## Regras
- Analise CADA slot com edge ≥ 3%
- Emita red_flag apenas quando houver evidência concreta, não suspeita vaga
- confidence_delta entre -0.20 e +0.15 (pequenos ajustes, não overrides)
- scout_score 0–100: reflete confiança GERAL no jogo, não em slots individuais
- narrative DEVE citar: (a) o slot mais confiável por confidence numérica (não necessariamente o #1 do ranking) e por que merece ou não confiança, (b) o fator contextual web mais relevante ou ausência dele, (c) conclusão acionável: "edge parece limpo", "cautela recomendada" ou "evitar"
- Se um slot com edge ≥ 5% NÃO receber red_flag, mencione brevemente por que foi aceito: confiança adequada, variância controlada ou ausência de contexto adverso
- Evite linguagem genérica sem dado específico (ex: "tendência moderada", "jogo equilibrado", "time forte")
- Não invente estatísticas — use apenas os dados fornecidos
- market_key nas red_flags DEVE ser exatamente uma das chaves listadas

## Âncoras scout_score
- 85–100: top slots com conf ≥ 0.50, edge ≤ 15%, variância recente controlada e web context sem flags materiais
- 60–80: 1–2 red_flags LOW/MEDIUM presentes, edge moderado, sem fator crítico confirmado
- 35–59: flag HIGH presente, ou conf < 0.30 em todos os top slots, ou variância recente muito aberta no mercado principal
- <35: múltiplas flags HIGH, ou web context revelou fator crítico confirmado (desfalque GK/artilheiro, clássico com escalação incerta, rotação pesada ≤4 dias)

## Sinais críticos a considerar
- Mercados de cartões e escanteios HT têm alta variância — exigir edge mais alto para confiar
- Edge > 20% sem razão contextual é provavelmente phantom — red_flag MEDIUM
- Confidence < 0.4 do motor + edge alto = sinal ambíguo — red_flag LOW
- Derby/clássico aumenta confiança em edges de cartões/faltas
- Visitante com viagem longa ou jogo curto: red_flag MEDIUM em slots ofensivos do visitante

## Quando o bloco "INTELIGÊNCIA DE MERCADO" estiver presente
Use os sinais dinâmicos (lesões, troca técnico, próximo jogo decisivo ≤4 dias, viagem longa,
calor ≥30°C, terceiro jogo em 7 dias, altitude ≥800m, clássico/derby) como ÊNFASE adicional:
- Desfalque de goleiro/artilheiro do mandante: red_flag HIGH em "casa marca / vence"
- Visitante com jogo decisivo em ≤4 dias (Copa/Libertadores): red_flag HIGH em slots ofensivos do visitante
- Troca de técnico nas últimas 4 semanas: red_flag MEDIUM em previsões baseadas em padrão estatístico (efeito Lazarus)
- Sem informação útil no bloco web: ignorar, NÃO inventar.

## Output JSON obrigatório (siga EXATAMENTE esta estrutura):
{
  "red_flags": [
    {
      "market_key": "string (uma das chaves listadas)",
      "reason": "string curta em português",
      "severity": "low" | "medium" | "high",
      "confidence_delta": número entre -0.20 e +0.15,
      "rationale": "uma frase em português"
    }
  ],
  "narrative": "string (3-5 frases em português)",
  "scout_score": número inteiro 0-100
}
Não use nenhuma outra chave além dessas três no objeto raiz.
```

### Request — user
```
=== PARTIDA: Real Madrid vs Real Oviedo | la-liga | 2026-05-14 ===
Detalhes: temporada=2025/2026 | rodada=36 | hora=19:30 | estadio=Santiago Bernabéu | arbitro=Ricardo De Burgos Bengoetxea
Real Madrid: n=18 gols_marcados=2.42 gols_sofridos=0.71 gols_total=3.13 esc_favor=6.10 esc_contra=3.40 chutes=16.30 chutes_alvo=6.20 cart_am=2.40 cart_verm=0.10 faltas=10.80 n_eventos=18 as_of=2026-05-14
Real Oviedo: n=18 gols_marcados=0.83 gols_sofridos=2.10 gols_total=2.93 esc_favor=3.90 esc_contra=5.70 chutes=8.50 chutes_alvo=2.70 cart_am=2.90 cart_verm=0.20 faltas=13.10 n_eventos=18 as_of=2026-05-14

=== FORMA RECENTE / VARIÂNCIA DOS TOP SLOTS ===
escanteios_total_ht_under_6_5: home_escanteios ult=[4,5,6,3,4,7,5] min=3 max=7 avg=4.86 n=7 | away_escanteios ult=[3,4,2,5,4,3,6] min=2 max=6 avg=3.86 n=7
cartoes_total_ft_over_2_5: home_cartoes ult=[2,3,4,2,5,3,2] min=2 max=5 avg=3 n=7 | away_cartoes ult=[4,3,5,2,4,6,3] min=2 max=6 avg=3.86 n=7
1x2_total_ft_home: home_resultado_gf_ga ult=[1,1,1,0,1,-1,1] min=-1 max=1 avg=0.57 n=7 | away_resultado_gf_ga ult=[-1,-1,0,-1,1,-1,0] min=-1 max=1 avg=-0.43 n=7
=== TOP SLOTS COM EDGE ===
1. escanteios_total_ht_under_6_5 — prob=87.3%, odd=1.29, edge=12.6%, conf=18%
2. cartoes_total_ft_over_2_5 — prob=76.3%, odd=1.5, edge=14.5%, conf=15%
3. 1x2_total_ft_home — prob=85.3%, odd=1.28, edge=9.2%, conf=20%
4. escanteios_total_ft_under_12_5 — prob=80.3%, odd=1.33, edge=6.7%, conf=39%
5. btts_total_ft_nao — prob=59.0%, odd=1.8, edge=6.2%, conf=33%

=== INTELIGÊNCIA DE MERCADO (Perplexity Sonar) ===
Real Madrid x Real Oviedo | la-liga | 2026-05-14 19:30 Santiago Bernabéu

1. CLÁSSICO/RIVALIDADE — Não é derby local; é confronto interestadual sem rivalidade histórica forte, embora o jogo no Bernabéu eleve a pressão sobre o visitante; impacto moderado em intensidade/faltas. Certeza: estático/conhecimento geral; CONFIANÇA: alta
2. STAKES — Sem informação pré-jogo confiável aqui sobre a tabela completa no momento exato, mas na rodada 36 o Real Madrid aparecia 2º com 77 pts e o Oviedo na parte baixa com 29 pts; impacto: mandante sob pressão por título/vaga, visitante sob risco baixo de rotação defensiva. Fonte curta: ESPN/marcadoresonline (classificação exibida); CONFIANÇA: média
3. DESFALQUES CONFIRMADOS — Sem informação confiável de lesões/suspensões confirmadas no material fornecido; não há prova oficial suficiente para cravar goleiro titular, artilheiro ou armador fora. Certeza: sem informação; CONFIANÇA: baixa
4. ESCALAÇÃO / NOVIDADES — Sem informação pré-jogo verificável sobre retornos, rotação ou pista clara do técnico; as fontes encontradas foram majoritariamente pós-jogo/conflitantes para esse quesito. Certeza: sem informação; CONFIANÇA: baixa
5. PRÓXIMO COMPROMISSO — Sem informação confiável e específica dos próximos jogos de Real Madrid e Real Oviedo dentro de ≤4 dias no material fornecido; por isso não dá para inferir rotação com segurança. Certeza: sem informação; CONFIANÇA: baixa
6. CLIMA EMOCIONAL / TROCA DE TÉCNICO — Sem informação sobre troca de técnico nas últimas 4 semanas ou crise interna antes do jogo; não encontrei fonte dinâmica confiável para sustentar esse ponto. Certeza: sem informação; CONFIANÇA: baixa
7. FATORES LOGÍSTICOS — a) Distância Madrid↔Oviedo: curta-média, aprox. 450 km por estrada/linha aérea curta; b) cansaço do Oviedo: sem informação do último jogo pré-14/05/2026; c) tripla rodada: sem informação; d) clima: sem informação confiável de previsão para 14/05/2026; e) altitude: Santiago Bernabéu está bem abaixo de 700 m, então não há efeito de altitude. Certeza: estático/sem informação dinâmica; CONFIANÇA: média
8. ESTATÍSTICA MARCANTE — Sem informação pré-jogo confiável de sequência relevante específica; as páginas encontradas trazem principalmente o resultado final, então não uso para afirmar tendência anterior sem validação. Certeza: sem informação; CONFIANÇA: baixa
=== TAREFA ===
Analise os slots acima. Para cada um com edge ≥ 3%, determine se o edge é real ou há razão contextual.
Responda em JSON conforme o schema fornecido no system prompt.
```

### Response — content (raw)
```json
{
  "red_flags": [
    {
      "market_key": "escanteios_total_ht_under_6_5",
      "reason": "alta variância em escanteios HT",
      "severity": "medium",
      "confidence_delta": -0.15,
      "rationale": "A variância nos escanteios do primeiro tempo é alta, com valores recentes variando entre 3 e 7."
    },
    {
      "market_key": "cartoes_total_ft_over_2_5",
      "reason": "alta variância em cartões",
      "severity": "medium",
      "confidence_delta": -0.15,
      "rationale": "A variância nos cartões é alta, com valores recentes variando entre 2 e 6."
    }
  ],
  "narrative": "O slot mais confiável é o '1x2_total_ft_home', com uma confiança de 20% e um edge de 9.2%, sem fatores contextuais adversos significativos. A ausência de desfalques confirmados ou mudanças de técnico sugere que o edge parece limpo. No entanto, a alta variância nos mercados de escanteios e cartões recomenda cautela. No geral, o edge parece limpo, mas cautela é recomendada em mercados de alta variância.",
  "scout_score": 75
}
```

### Overlay parseado (final)
```json
{
  "model": "gpt-4o",
  "latency_ms": 2235,
  "tokens_used": 2638,
  "web_context_used": true,
  "red_flags": [
    {
      "market_key": "escanteios_total_ht_under_6_5",
      "reason": "alta variância em escanteios HT",
      "severity": "medium",
      "confidence_delta": -0.15,
      "rationale": "A variância nos escanteios do primeiro tempo é alta, com valores recentes variando entre 3 e 7."
    },
    {
      "market_key": "cartoes_total_ft_over_2_5",
      "reason": "alta variância em cartões",
      "severity": "medium",
      "confidence_delta": -0.15,
      "rationale": "A variância nos cartões é alta, com valores recentes variando entre 2 e 6."
    }
  ],
  "narrative": "O slot mais confiável é o '1x2_total_ft_home', com uma confiança de 20% e um edge de 9.2%, sem fatores contextuais adversos significativos. A ausência de desfalques confirmados ou mudanças de técnico sugere que o edge parece limpo. No entanto, a alta variância nos mercados de escanteios e cartões recomenda cautela. No geral, o edge parece limpo, mas cautela é recomendada em mercados de alta variância.",
  "scout_score": 59,
  "skip_reason": null
}
```