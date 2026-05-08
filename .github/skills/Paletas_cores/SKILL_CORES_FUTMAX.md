# FutMaxStats — Skill de Cores (Design System Final)

> **Arquivo Unificado e Canônico:** Este documento consolida `SKILL_CORES.md` e `palette.md`.
> **Uso:** Referência obrigatória para manter a consistência visual "Verde Bet / Cockpit de Apostador".
> **Regra de Ouro:** Hierarquia semântica sobre estética decorativa. Cockpit Profissional > Vitrine de IA.

---

## 1. Paleta Principal (Tokens HSL)

| Token                    | HSL                     | HEX Approx   | Uso Principal                           |
|--------------------------|-------------------------|---------------|------------------------------------------|
| `--background`           | 220 20% 7%              | `#0f1219`     | Fundo principal (quente, não preto puro) |
| `--foreground`           | 210 20% 92%             | `#e4e8ed`     | Texto principal (alto contraste)         |
| `--card`                 | 220 18% 10%             | `#151a24`     | Fundo de cards e superfícies             |
| `--card-foreground`      | 210 20% 92%             | `#e4e8ed`     | Texto sobre cards                        |
| `--popover`              | 220 18% 10%             | `#151a24`     | Popovers, Selects e Dropdowns            |
| `--popover-foreground`   | 210 20% 92%             | `#e4e8ed`     | Texto em popovers                        |
| `--primary`              | **152 60% 48%**         | `#31c48d`     | **VERDE MARCA — Acento Estrutural**      |
| `--primary-foreground`   | 220 20% 7%              | `#0f1219`     | Texto sobre primary (escuro)             |
| `--secondary`            | 220 16% 16%             | `#222a38`     | Elementos secundários, inputs            |
| `--secondary-foreground` | 210 20% 85%             | `#c8d0db`     | Texto sobre secondary                    |
| `--muted`                | 220 14% 14%             | `#1e2430`     | Áreas de fundo sutil                     |
| `--muted-foreground`     | 215 12% 50%             | `#71808f`     | Labels e textos desativados              |
| `--accent`               | 152 50% 40%             | `#339966`     | Hover e estados ativos alternativos      |
| `--accent-foreground`    | 210 20% 95%             | `#edf0f4`     | Texto sobre accent                       |
| `--destructive`          | 0 72% 51%               | `#dc2626`     | Erros críticos, perda total (Red)        |
| `--border`               | 220 14% 18%             | `#272e3c`     | Bordas sólidas e delimitadores           |
| `--input`                | 220 14% 18%             | `#272e3c`     | Bordas de campos de entrada              |
| `--ring`                 | 152 60% 48%             | `#31c48d`     | Foco (Focus Ring verde)                  |

## 2. Sidebar (Menu Lateral)

| Token                        | HSL               | HEX Approx | Uso                         |
|------------------------------|--------------------|------------|------------------------------|
| `--sidebar-background`       | 220 20% 5%         | `#0b0e15`  | Fundo mais escuro que o body |
| `--sidebar-foreground`       | 210 15% 70%        | `#a3adb8`  | Texto itens inativos         |
| `--sidebar-primary`          | 152 60% 48%        | `#31c48d`  | Ícone/Texto item ativo       |
| `--sidebar-primary-foreground`| 220 20% 7%        | `#0f1219`  | Texto sobre active (contraste)|
| `--sidebar-accent`           | 220 16% 12%        | `#1a1f2b`  | Fundo de hover no item       |
| `--sidebar-accent-foreground`| 210 20% 90%        | `#dce2e9`  | Texto no hover               |
| `--sidebar-border`           | 220 14% 14%        | `#1e2430`  | Divisores internos           |

## 3. Cores de Apoio e Semântica (Brand Colors)

| Nome              | HEX       | HSL (Aprox)      | Significado Semântico                   |
|-------------------|-----------|------------------|-----------------------------------------|
| `primary / neon`  | `#31c48d` | 152 60% 48%      | Estrutura, botões principais, marca     |
| `gold`            | `#f5b731` | 45 93% 58%       | **Odds, Payout, Retorno, Fair Odd**     |
| `cyan / blue`     | `#3b82f6` | 210 80% 55%      | Confiança, Precisão, Suporte Analítico  |
| `emerald`         | `#10b981` | 160 84% 39%      | Saúde do sistema, Green (ganho), Status |
| `orange`          | `#f97316` | 24 95% 53%       | Alerta, Risco Médio                     |
| `neon-purple`     | `#8b5cf6` | 270 60% 55%      | Contexto IA, Modelos, Arena IA          |
| `neon-blue`       | `#00d4ff` | 190 100% 50%     | Links, detalhes técnicos, info extra    |

---

## 4. Hierarquia Visual e Regras de Negócio

### Prioridades de Cor
1. **Verde (`primary`):** Base de navegação e ações principais.
2. **Ouro (`gold`):** Todo dado financeiro (Odds, Valores) deve usar ouro para atrair o olho do apostador.
3. **Ciano (`cyan`):** Dados de suporte (confiança do modelo, score de precisão).
4. **Esmeralda (`emerald`):** Confirmações e estados positivos.
5. **Vermelho (`destructive`):** Apenas para erro real ou risco de perda iminente.

### Regras de Superfície
- **Cockpit Mode:** Páginas de decisão (Estratégias, Odds, Oportunidades, Raio-X) devem ser limpas, com alto contraste e sem distrações visuais excessivas.
- **Opacidade vs Glass:** Preferir cards sólidos (`--card`). O uso de `glassmorphism` e `backdrop-blur` deve ser mínimo em áreas de leitura intensa de dados.
- **Bordas:** Devem ser sólidas (`--border`), não transparentes, para garantir contorno claro.

### Restrições IA
- **Roxo (`neon-purple`):** Restrito a blocos onde a IA é o assunto principal. Não usar em headers ou botões de aposta.
- **Conflito Visual:** Não misturar Verde, Azul, Roxo e Dourado no mesmo bloco sem uma hierarquia semântica clara definida acima.

---

## 5. Tailwind & Implementation Tips

### Classes Úteis (Match com o Sistema)
- **Fundos:** `bg-background` (#0f1219), `bg-card` (#151a24)
- **Bordas:** `border-border` (#272e3c)
- **Textos:** `text-foreground` (#e4e8ed), `text-muted-foreground` (#71808f)
- **Acentos:** `text-gold`, `text-emerald-400`, `text-cyan-400`, `text-primary`
- **Gradientes:** `bg-gradient-to-br from-[#31c48d] to-[#21855f]` (CTA Principal)

### Componentes Críticos (Select/Dropdown)
**PROIBIDO:** Usar `<select>` nativo (renderiza popup branco no Windows).
**OBRIGATÓRIO:** Usar `Select` do shadcn/UI (Radix) para garantir o fundo `--popover` em todas as plataformas.

```tsx
// Estilo padrão para Selects no tema Verde Bet
const SEL_TRIGGER = 'bg-card border-border text-foreground hover:bg-secondary focus:ring-primary/30';
const SEL_CONTENT = 'bg-popover border-border text-popover-foreground shadow-2xl';
```

---

## 6. Filosofia de Design

- **Dark-first:** Nunca preto puro. Sempre o carvão quente (#0f1219).
- **Contraste Profissional:** Tipografia Inter (UI) + JetBrains Mono (Stats/Números).
- **Glow Controlado:** Usar `box-shadow: 0 0 20px hsl(var(--primary) / 0.15)` apenas em elementos de destaque extremo.
- **Slogan Sidebar:** *"Não precisamos ser o maior. Precisamos ser o mais inteligente."*
