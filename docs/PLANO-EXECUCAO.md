# Pulse FX — Plano de Execução (3 dias)

> Documento de engenharia. Base: `README.md` (briefing v1.9).
> Todas as APIs externas citadas foram **testadas ao vivo** em 2026-08-18 antes de escrever este plano.

---

## 0. Sumário executivo

O briefing é um MVP full-stack com prazo curto e **avaliação explícita de sinais de engenharia**
(histórico de commits, modularização, organização do repo, documentação) — não apenas do produto final.

Decisão-chave de arquitetura que resolve metade dos requisitos de uma vez:

> **A API de leitura nunca chama BCB/FRED no request path.** Ela lê exclusivamente do PostgreSQL.
> Um pipeline de ingestão (bootstrap + cron + endpoint admin protegido) é o único componente que
> fala com o mundo externo, com TTL, idempotência e observabilidade.

Isso entrega o requisito §4.4 ("evitar chamadas descontroladas"), torna o app determinístico para
testes, e faz o "último valor válido" (§5) ser uma propriedade do banco, não de rede.

**Esforço estimado:** ~26–30h de trabalho efetivo em 3 dias. É apertado mas viável **se** o Dia 0 for cumprido.

---

## 1. Bloqueadores — resolver ANTES de escrever código (Dia 0, ~45 min)

| # | Bloqueador | Status verificado | Ação |
|---|---|---|---|
| B1 | **Docker não está instalado nesta máquina** | `docker` ausente do PATH e `C:\Program Files\Docker` não existe | Instalar Docker Desktop + WSL2 e validar `docker compose version`. **Sem isso o entregável §2 é impossível.** |
| B2 | **FRED exige API key** | Confirmado: chamada sem `api_key` retorna HTTP 400 `"Variable api_key is not set"` | Registrar em `fredaccount.stlouisfed.org/apikeys` (emissão imediata). Guardar em variável de ambiente, nunca commitar. |
| B3 | **Repositório de entrega** | O repo clonado (`luizdarioTR/pulse-fx`) é o do enunciado | Criar **repo próprio** (monorepo, §6). Não entregar em cima do repo do avaliador. Copiar o briefing para `docs/BRIEFING.md`. |
| B4 | Node LTS | v26.7.0 / npm 11.19.0 presentes | OK. Fixar via `.nvmrc` + `engines`. |
| B5 | Dúvida ao avaliador (§10 — só 1 mensagem) | — | **Só usar se houver ambiguidade real.** Na minha leitura não há: o briefing delega as escolhas ao candidato. Recomendo **não gastar** a pergunta. |

---

## 2. Decisões de arquitetura (com trade-offs para o README)

| Área | Decisão | Por quê / trade-off |
|---|---|---|
| Monorepo | **npm workspaces** | Zero tooling extra, já disponível. pnpm/turbo seriam ganho marginal em 3 dias e risco de fricção no Docker. |
| Backend HTTP | **Fastify 5 + TypeScript** | Rápido, TS-first, `app.inject()` torna teste de rota trivial sem subir porta. Plugin de OpenAPI nativo. Trade-off vs Express: ecossistema menor, irrelevante aqui. |
| Validação | **Zod** compartilhado em `packages/shared` | Um único schema define o contrato: valida entrada na API e tipa o cliente web. Elimina drift front/back. |
| Persistência | **Drizzle ORM + drizzle-kit** | Migrations geradas como **arquivos SQL versionados** (atende §6), queries tipadas, sem magia de ORM pesado. Trade-off: menos maduro que Prisma, mas a engine binária do Prisma complica a imagem Docker slim. |
| Banco | **PostgreSQL 16** | Obrigatório. Valores em `NUMERIC(20,8)` — **nunca `float`** (erro de arredondamento em variação %). |
| Datas | `ref_date` como `DATE` puro, tudo em UTC | Observação econômica é um *dia de referência*, não um instante. Timezone só na formatação da UI. |
| Agendamento | Worker separado no Compose com `node-cron` | Separa o ciclo de vida de leitura e escrita; a API continua respondendo se a ingestão falhar. |
| Frontend | **Vite + React 18 + TS + TanStack Query + React Router + Recharts** | Query dá cache/retry/estados de loading de graça. Recharts cobre "gráfico simples" (§4.2) sem esforço. |
| Estilo | **Tailwind** | Velocidade e consistência visual em 3 dias, sem inventar design system. |
| Auth | **Sem login.** `X-Client-Id` (UUID em `localStorage`) | KYC/auth está **fora de escopo** (§8), mas favoritos exigem "persistência real no backend" (§4.3). O client-id dá persistência real server-side sem inventar autenticação. **Documentar essa escolha explicitamente no README** — é exatamente o tipo de trade-off que o briefing pede. |

---

## 3. Estrutura do monorepo

```
pulse-fx/
├─ README.md                      # raiz único, completo (§6) — é entregável, não enfeite
├─ docker-compose.yml
├─ .env.example
├─ package.json                   # workspaces + scripts raiz (dev, test, lint, build)
├─ tsconfig.base.json
├─ apps/
│  ├─ api/
│  │  ├─ Dockerfile
│  │  ├─ drizzle/                 # migrations SQL versionadas + meta
│  │  └─ src/
│  │     ├─ domain/               # PURO: sem I/O, sem imports de infra
│  │     │  ├─ variation.ts       # regra de negócio §5
│  │     │  ├─ frequency.ts       # DAILY | MONTHLY + políticas
│  │     │  └─ errors.ts
│  │     ├─ application/          # casos de uso, orquestração
│  │     │  ├─ list-indicators.usecase.ts
│  │     │  ├─ get-series.usecase.ts
│  │     │  ├─ toggle-favorite.usecase.ts
│  │     │  └─ sync-indicators.usecase.ts
│  │     ├─ infrastructure/
│  │     │  ├─ db/                # schema drizzle, client, repositories
│  │     │  ├─ providers/         # bcb-sgs, bcb-ptax, fred — cada um implementa a MESMA porta
│  │     │  └─ config/            # env parseado por zod, falha rápido no boot
│  │     ├─ interface/http/       # rotas, handlers, mapeadores DTO, error handler
│  │     ├─ worker.ts             # cron de sincronização
│  │     └─ server.ts
│  └─ web/
│     ├─ Dockerfile               # build Vite -> nginx
│     └─ src/
│        ├─ pages/                # Dashboard, IndicatorDetail
│        ├─ components/           # IndicatorCard, VariationBadge, Disclaimer, SeriesChart
│        ├─ hooks/                # useIndicators, useFavorites, useSeries
│        └─ lib/                  # api client (tipado pelo shared), formatters
└─ packages/
   └─ shared/                     # tipos + schemas zod do contrato HTTP
```

**Regra de dependência (imposta por lint):** `domain` não importa nada. `application` importa `domain`
via **portas (interfaces)**. `infrastructure` implementa as portas. `interface/http` só conhece `application`.
Isso é o "SOLID / camadas" que o briefing cobra em §2, e é verificável no code review.

---

## 4. Modelo de dados

```sql
-- 0001_init.sql
CREATE TYPE indicator_source    AS ENUM ('BCB_SGS','BCB_PTAX','FRED');
CREATE TYPE indicator_frequency AS ENUM ('DAILY','MONTHLY');

CREATE TABLE indicators (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,        -- slug estável p/ URL: 'usd-brl-ptax'
  source            indicator_source NOT NULL,
  external_id       TEXT NOT NULL,               -- '1', '433', 'DGS10'
  name              TEXT NOT NULL,
  unit              TEXT NOT NULL,               -- 'BRL', '%', 'index'
  frequency         indicator_frequency NOT NULL,
  variation_lag     INT  NOT NULL,               -- N do §5 (1 = período anterior disponível)
  precision         SMALLINT NOT NULL DEFAULT 4,
  rationale         TEXT NOT NULL,               -- as 2-5 linhas exigidas em §3
  limitations       TEXT NOT NULL,               -- texto exibido na tela de detalhe (§4.2)
  source_url        TEXT NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (source, external_id)
);

CREATE TABLE observations (
  indicator_id INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  ref_date     DATE NOT NULL,
  value        NUMERIC(20,8) NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (indicator_id, ref_date)           -- idempotência do sync vem daqui
);
CREATE INDEX observations_lookup ON observations (indicator_id, ref_date DESC);

CREATE TABLE sync_runs (
  id            BIGSERIAL PRIMARY KEY,
  indicator_id  INT REFERENCES indicators(id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL,                   -- 'bootstrap' | 'cron' | 'admin'
  status        TEXT NOT NULL,                   -- 'success' | 'failed' | 'skipped_ttl'
  rows_upserted INT NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ
);

CREATE TABLE favorites (
  client_id    UUID NOT NULL,
  indicator_id INT NOT NULL REFERENCES indicators(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, indicator_id)
);
```

- `0002_seed_indicators.sql` — seed do catálogo como **migration**, não script solto: o catálogo é
  parte do schema do produto e precisa ser reprodutível em qualquer ambiente.
- Upsert do sync: `INSERT ... ON CONFLICT (indicator_id, ref_date) DO UPDATE SET value = EXCLUDED.value`
  — cobre revisão de dado pela fonte (IPCA e IBC-Br **são revisados**).

---

## 5. Indicadores escolhidos — códigos **verificados ao vivo**

Retornos reais obtidos em 2026-08-18:

| Code (slug) | Fonte | ID externo | Freq. | Amostra verificada |
|---|---|---|---|---|
| `usd-brl-ptax` | BCB Olinda PTAX | `CotacaoDolarPeriodo` | Diária | `2026-08-12 → compra 5.16320 / venda 5.16390` |
| `usd-brl-sgs` | BCB SGS | `1` | Diária | `18/08/2026 → 5.2043` |
| `eur-brl` | BCB SGS | `21619` | Diária | `18/08/2026 → 6.0271` |
| `selic-anual` | BCB SGS | `1178` | Diária | `17/08/2026 → 13.90` |
| `ipca-mensal` | BCB SGS | `433` | Mensal | `01/07/2026 → 0.07` |
| `us-10y` | FRED | `DGS10` | Diária | *pendente de API key (B2)* |
| `fed-funds` | FRED | `FEDFUNDS` | Mensal | *pendente de API key (B2)* |
| `dollar-index` | FRED | `DTWEXBGS` | Diária | *pendente de API key (B2)* |

4 séries BCB + 3–4 séries FRED, cobrindo **as duas frequências** — o que obriga as duas regras de
variação do §5 a existirem de verdade, em vez de uma regra única disfarçada.

**Justificativa de cada série (2–5 linhas)** vai no campo `rationale` da tabela `indicators` e é
renderizada na tela de detalhe — assim o requisito §3 vira parte do produto, não um parágrafo perdido no README.

### Armadilhas reais já identificadas nas fontes

1. **SGS 432 (Selic meta) retorna observações com data no FUTURO.** Verificado: em 18/08/2026 a série
   devolve linhas para `15/09/2026` e `16/09/2026` (meta vigente projetada até o próximo COPOM).
   → **A definição de "último valor válido" (§5) deve excluir `ref_date > CURRENT_DATE`.** Por isso escolhi
   `1178` (Selic efetiva anualizada, diária) em vez de `432`; o filtro de data futura fica no domínio de qualquer forma.
2. **SGS devolve `valor` como string** (`"5.2043"`) — parsear com decimal, nunca `parseFloat` direto para float.
3. **SGS usa datas `dd/MM/yyyy`; PTAX Olinda usa `MM-DD-YYYY` entre aspas simples na URL.** Formatos
   diferentes na mesma instituição. Um adaptador por provider, cada um com seu parser testado.
4. **PTAX não publica em fins de semana/feriados** e a resposta vem com `dataHoraCotacao` (timestamp),
   que precisa ser truncado para o dia de referência.
5. **IPCA e IBC-Br são revisados retroativamente** → o upsert (não insert) é obrigatório.
6. **FRED usa `.` para valor ausente** nas observações — filtrar antes de persistir.

---

## 6. Contrato da API

```
GET    /health                                 liveness
GET    /ready                                  readiness (ping no Postgres)
GET    /api/indicators?favorites=true          catálogo + último valor + ref_date + variação
GET    /api/indicators/:code                   metadados, rationale, limitations, última sync
GET    /api/indicators/:code/observations
         ?window=30d|90d|1y|5y|max             janela por tipo de série (default por frequência)
GET    /api/favorites                          header X-Client-Id
PUT    /api/favorites/:code                    idempotente
DELETE /api/favorites/:code                    idempotente
POST   /api/admin/sync                         Bearer ADMIN_TOKEN; body: { codes?: string[], force?: boolean }
GET    /docs                                   OpenAPI (fastify-swagger)
```

Payload do card (mesma forma no dashboard e no detalhe — requisito de **consistência** do §5):

```jsonc
{
  "code": "usd-brl-ptax",
  "name": "Dólar PTAX (venda)",
  "unit": "BRL",
  "frequency": "DAILY",
  "latest":    { "value": "5.16390", "refDate": "2026-08-12" },
  "previous":  { "value": "5.12850", "refDate": "2026-08-11" },  // denominador EXPLÍCITO
  "variation": { "absolute": "0.03540", "percent": "0.6903", "lag": 1, "unit": "business_day" },
  "isFavorite": true,
  "lastSyncedAt": "2026-08-18T12:00:00Z"
}
```

Expor `previous` junto com `variation` é deliberado: o briefing exige "denominador explícito".
O front nunca recalcula nada — a regra vive num único lugar.

---

## 7. Regra de variação — especificação formal (§5)

Função pura em `domain/variation.ts`, consumida pelos dois use cases:

```ts
calculateVariation(observations: Observation[], policy: VariationPolicy): VariationResult | null
```

**Algoritmo**

1. Descartar observações com `ref_date > hoje` (armadilha da Selic meta) e valores nulos/não-numéricos.
2. Ordenar desc por `ref_date`. `latest` = primeira. Se vazio → `null` (UI mostra "sem dado"; **não** mostra 0%).
3. `previous` = a observação **N posições disponíveis** antes de `latest`, onde N = `indicators.variation_lag`.
   Contam-se **observações existentes**, não dias de calendário.
4. `percent = (latest.value - previous.value) / |previous.value| * 100`, arredondado a 4 casas
   com `Decimal` (não `Number`).
5. Guardas: `previous.value == 0` → retorna variação absoluta e `percent: null`.
   Séries em ponto percentual (juros) expõem também `absolute` em **p.p.**, que é a leitura correta para taxas.

**Parâmetros fixados e justificados (vai literalmente para o README):**

- **Séries diárias (FX e juros diários): N = 1.** Comparação com o **fechamento anterior disponível**.
  É a leitura padrão de mercado ("dólar hoje vs ontem") e é a única que não inventa dado em feriado.
- **Séries mensais (IPCA, Fed Funds): N = 1 mês.** Variação **mês contra mês**.
  Deliberadamente **não** uso "acumulado 12 meses" como a variação do card: é outra métrica, com outro
  significado; misturar as duas quebra a comparabilidade entre cards. O acumulado 12m pode aparecer na
  tela de detalhe, **rotulado como métrica distinta**.

**Calendário / lacunas:** política de **último dado conhecido, sem interpolação**.
Fim de semana, feriado ou falha de publicação simplesmente **não geram observação**; o card exibe a
`refDate` real do dado, que pode ser anterior a hoje. Interpolar série financeira fabricaria preço que
nunca existiu — o briefing já aponta nessa direção e eu concordo. A UI mostra
"referência: 12/08/2026" e "sincronizado há 20 min" como **dois campos separados**, justamente para não
confundir data da observação com hora da consulta.

**Janela de histórico por tipo de série:** diária → 90 dias (default), opções 30d/90d/1y/5y.
Mensal → 5 anos (default), opções 1y/5y/max. Backfill inicial: 5 anos para diárias, 10 anos para mensais.

---

## 8. Política de sincronização (§4.4)

Três gatilhos, **um único caso de uso** (`SyncIndicatorsUseCase`):

| Gatilho | Quando | Comportamento |
|---|---|---|
| `bootstrap` | Subida do worker | Se a série tem 0 observações → backfill completo. Senão, incremental. |
| `cron` | Diárias: `*/30 * * * *` das 9h às 20h BRT. Mensais: `0 6 * * *` | Busca apenas de `MAX(ref_date) - 5 dias` até hoje (janela de revisão). |
| `admin` | `POST /api/admin/sync` com Bearer token | `force: true` ignora o TTL. Usado na demo/vídeo. |

**Controles contra chamada descontrolada:**

- **TTL por indicador** (`SYNC_TTL_MINUTES`, default 30): se existe `sync_run` com `status='success'`
  dentro do TTL, registra `skipped_ttl` e **não** chama a fonte. `force` é o único bypass.
- **Timeout** de 10s por request + **retry 3x com backoff exponencial e jitter**, só em 5xx/timeout.
- **Concorrência limitada** (`p-limit`, 2 requests simultâneos por provider) — as APIs do BCB são lentas
  e não têm SLA público.
- **Advisory lock do Postgres** por indicador: duas instâncias do worker nunca sincronizam a mesma série.
- **Rate limit** na API pública (`@fastify/rate-limit`) — protege a nossa, não a deles, mas é higiene.
- Toda execução escreve em `sync_runs` → dá para responder "por que esse número está velho?" sem adivinhar.

---

## 9. Frontend

**Dashboard** — grid de `IndicatorCard`: nome, último valor formatado por `unit`/`precision`,
`refDate` em pt-BR, `VariationBadge` (verde/vermelho/neutro + seta + tooltip com o denominador:
"vs 5,12850 em 11/08/2026"). Toggle "Meus indicadores". Estrela de favorito com **optimistic update**
via TanStack Query e rollback em erro. Estados de loading (skeleton), erro (retry) e vazio — os três,
não só o caminho feliz.

**Detalhe** — header com valor e variação (mesmo componente do card, garantindo a consistência do §5),
`SeriesChart` (Recharts, area chart), seletor de janela, tabela paginada das observações,
bloco **"Limitações dos dados"** vindo de `indicators.limitations`, e link para a documentação da fonte.

**Disclaimer (§4.5)** — banner fixo no layout, presente em **todas** as rotas:
*"Conteúdo educacional. Dados de fontes públicas, sujeitos a revisão e atraso de publicação. Não constitui recomendação de investimento."*

**Acessibilidade mínima:** cor **nunca** é o único sinal de alta/baixa (seta + sinal `+`/`−`),
`aria-label` nos toggles, foco visível. Barato e é sinal de qualidade.

---

## 10. Testes — mapa dos 8 arquivos (mínimo é 5; entregar 8 com folga de qualidade)

| # | Arquivo | Camada | Cobre de verdade |
|---|---|---|---|
| 1 | `domain/variation.test.ts` | Domínio | N=1 diário, N=1 mensal, lacuna de feriado, série vazia, 1 só observação, denominador zero, **descarte de data futura**, arredondamento |
| 2 | `domain/date-normalization.test.ts` | Domínio | `dd/MM/yyyy` (SGS) vs `MM-DD-YYYY` (PTAX) vs ISO (FRED); truncar timestamp→data; ano bissexto |
| 3 | `providers/bcb-sgs.client.test.ts` | Infra | HTTP mockado (msw): parse de `valor` string, série vazia, HTTP 500 → retry, timeout |
| 4 | `providers/fred.client.test.ts` | Infra | valor `"."` descartado, paginação, erro de API key |
| 5 | `repositories/observation.repository.test.ts` | Persistência | **Postgres real** (Testcontainers): upsert idempotente, `latest` ignora futuro, janela por data |
| 6 | `http/indicators.routes.test.ts` | HTTP | `app.inject()`: 200 com payload correto, 404 em code inválido, 400 em `window` inválida, 401 no admin sem token |
| 7 | `integration/sync.integration.test.ts` | Integração | Fluxo ponta a ponta: provider mockado → sync → Postgres → `GET /api/indicators` com variação correta; **rodar 2x prova a idempotência**; TTL bloqueia a 2ª chamada |
| 8 | `web/IndicatorCard.test.tsx` + `web/useFavorites.test.tsx` | Frontend | Renderização de alta/baixa/neutro/sem-dado; formatação pt-BR; toggle otimista com rollback em falha |

Runner: **Vitest** nos dois apps (mesma DX, roda TSX nativo). Postgres de teste via **Testcontainers**
(fallback documentado: serviço `postgres-test` no Compose, se o Docker-in-CI der problema).
`npm test` na raiz roda todos os workspaces. **Nenhum teste toca a rede real.**

---

## 11. Docker Compose (§2 — o "15 minutos" do §9 depende disto)

```yaml
services:
  postgres:  # 16-alpine, volume nomeado, healthcheck pg_isready
  migrate:   # one-shot: drizzle-kit migrate + seed; depends_on postgres healthy
  api:       # depends_on migrate (completed_successfully); healthcheck /health; :3333
  worker:    # mesma imagem da api, command: node dist/worker.js
  web:       # multi-stage build Vite -> nginx:alpine; :5173
```

- **Dockerfiles multi-stage** com `npm ci --omit=dev` no estágio final, usuário não-root, `.dockerignore`.
- `.env.example` completo e comentado: `DATABASE_URL`, `FRED_API_KEY`, `ADMIN_TOKEN`,
  `SYNC_TTL_MINUTES`, `BACKFILL_YEARS`, `PORT`, `VITE_API_URL`, `TZ=UTC`.
- **Critério de aceite não-negociável:** copiar o `.env.example` → colar a FRED key →
  `docker compose up --build` → dashboard com dados reais em **um único comando**.
  O backfill roda no bootstrap do worker; a UI mostra "sincronizando" enquanto não há dado, em vez de quebrar.
- Ensaiar isso numa máquina limpa (ou `docker compose down -v`) **duas vezes**, no Dia 3.

---

## 12. Cronograma

### Dia 0 — noite anterior (~1h)

Bloqueadores B1–B4. Criar o repo, `README.md` esqueleto, licença, `.gitignore`, `.editorconfig`.

### Dia 1 — Fundação e backend (~10h)

| Bloco | Entrega |
|---|---|
| 1 (2h) | Monorepo: workspaces, `tsconfig.base`, ESLint+Prettier, Vitest, `packages/shared` com os schemas zod |
| 2 (2h) | Docker Compose + Postgres + Dockerfile da API subindo (`/health` verde) — **antes** da lógica |
| 3 (2h) | Drizzle: schema, `0001_init`, `0002_seed_indicators` com rationale/limitations escritos |
| 4 (2h) | Domínio: `variation.ts` + normalização de datas, **com os testes 1 e 2 já verdes** (TDD onde compensa) |
| 5 (2h) | Providers BCB (SGS + PTAX) com a mesma porta + teste 3 |
| **Fim do Dia 1** | `docker compose up` sobe Postgres migrado e API saudável; domínio testado; BCB integrado |

### Dia 2 — API completa e frontend (~11h)

| Bloco | Entrega |
|---|---|
| 6 (1.5h) | Provider FRED + teste 4 |
| 7 (2h) | Repositories + sync use case (TTL, upsert, advisory lock, `sync_runs`) + teste 5 |
| 8 (2h) | Rotas HTTP + OpenAPI + error handler + favoritos + admin token + testes 6 e 7 |
| 9 (1h) | Worker com cron e bootstrap; validar backfill real de ponta a ponta |
| 10 (3h) | Web: scaffold, api client tipado, Dashboard, `IndicatorCard`, `VariationBadge`, Disclaimer |
| 11 (1.5h) | Web: página de detalhe, gráfico, seletor de janela, favoritos otimistas |
| **Fim do Dia 2** | **MVP funcional ponta a ponta.** Dia 3 é polimento, não construção. |

### Dia 3 — Qualidade, documentação e entrega (~7h)

| Bloco | Entrega |
|---|---|
| 12 (1.5h) | Teste 8 (frontend) + fechar as lacunas dos 8 arquivos; `npm test` e `npm run lint` limpos |
| 13 (1.5h) | Estados de loading/erro/vazio, responsividade, a11y básica, revisão visual |
| 14 (2h) | **README raiz** completo (checklist da §14 abaixo) |
| 15 (1h) | **Teste de máquina limpa:** `docker compose down -v` + `up --build` cronometrado (< 15 min) |
| 16 (1h) | Screenshots ou vídeo de 2–3 min; revisão final do histórico de commits; tag `v1.0.0` |

**Buffer:** o Dia 3 tem ~1h de folga. Se algo derrapar, o corte é nesta ordem:
gráfico → tabela simples; 8 indicadores → 6; vídeo → screenshots.
**Nunca cortar:** Docker Compose, migrations, os 5 testes, o README.

---

## 13. Estratégia de commits (avaliada explicitamente no §1)

Conventional Commits, **~30–40 commits pequenos e coerentes**, distribuídos pelos 3 dias.
Um commit monolítico no último minuto é penalizado pelo enunciado — e é visível no `git log`.

```
chore: inicializa monorepo com npm workspaces e tsconfig base
chore(ci): configura eslint, prettier e vitest
feat(infra): adiciona docker compose com postgres e healthcheck
feat(db): cria schema inicial de indicadores e observacoes
feat(db): popula catalogo de indicadores com justificativa e limitacoes
feat(domain): implementa calculo de variacao percentual por frequencia
test(domain): cobre lacunas de calendario e observacoes futuras
feat(providers): integra bcb sgs com retry e timeout
...
docs: documenta regras de variacao, janelas e trade-offs no readme
```

Regras: um commit = uma unidade lógica que compila e passa nos testes; mensagem no imperativo;
`feat`/`fix`/`test`/`docs`/`refactor`/`chore`. Trabalhar em branches curtas
(`feat/domain-variation`) com merge (não squash) na `main` preserva a narrativa do trabalho.

---

## 14. Checklist de aceite — rastreabilidade contra o briefing

| Req. | Item | Como fica evidente |
|---|---|---|
| §2 | React + TS (web) | `apps/web` |
| §2 | Node + TS em camadas, SOLID | `apps/api/src/{domain,application,infrastructure,interface}` + regra de dependência no lint |
| §2 | PostgreSQL | serviço `postgres` + migrations |
| §2 | Docker + Compose | `docker-compose.yml` com 5 serviços |
| §2/§7 | ≥5 arquivos de teste reais | 8 arquivos, tabela da §10 |
| §3 | Duas fontes distintas (BCB + FRED) | 2 providers, códigos verificados |
| §3 | 2–5 linhas por indicador | `indicators.rationale`, exibido na UI + README |
| §4.1 | Dashboard: nome, último valor, data ref., variação | `IndicatorCard` |
| §4.2 | Detalhe: série, janela, limitações | página de detalhe + `indicators.limitations` |
| §4.3 | Favoritos com persistência real | tabela `favorites` + `X-Client-Id` (trade-off documentado) |
| §4.4 | Política de sync sem chamadas descontroladas | TTL + cron + admin + `sync_runs` + leitura só do banco |
| §4.5 | Disclaimer visível | banner em todas as rotas |
| §5 | Variação definida, implementada e documentada | `domain/variation.ts` + seção no README + testes |
| §5 | Mesma regra no dashboard e no detalhe | mesmo use case, mesmo payload, mesmo componente |
| §5 | Tratamento de fins de semana/feriados/lacunas | último dado conhecido, sem interpolação (documentado) |
| §6 | Monorepo + README raiz único | estrutura da §3 |
| §6 | Migrations versionadas | `apps/api/drizzle/*.sql` no git |
| §6 | Vídeo/screenshots (opcional recomendado) | Dia 3, bloco 16 |
| §9 | Rodar local em < 15 min | ensaio cronometrado em máquina limpa |
| §9 | Histórico de commits coerente | §13 |

---

## 15. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Docker Desktop não instala / WSL2 falha | Média | **Crítico** | Resolver no Dia 0. Sem Docker o entregável principal cai. |
| API do BCB lenta ou fora do ar durante o backfill | Média | Alto | Retry + backoff; backfill em lotes; **fixtures gravadas** para os testes |
| Estourar o prazo por over-engineering | **Alta** | Alto | Escopo congelado neste documento. Nada fora da §14 entra. Ordem de corte definida na §12. |
| Erro de arredondamento na variação % | Média | Alto (é o coração do desafio) | `NUMERIC` no banco + `Decimal` no domínio; teste 1 com valores fixos |
| Testcontainers falhar no ambiente | Baixa | Médio | Fallback `postgres-test` no Compose, já documentado |
| Confundir data da observação com hora da consulta | Média | Alto (o briefing avisa) | Dois campos distintos no payload e na UI; teste cobre |
| Segredo (FRED key) vazar no repo | Baixa | **Crítico** | Arquivo de ambiente no `.gitignore`; só o `.example` versionado; revisar `git log -p` antes de publicar |

---

## 16. Fora de escopo (§8) — reafirmado

Sem trading, ordens, conta, pagamentos, KYC, recomendação de investimento, streaming tick-by-tick
ou multi-tenant. Qualquer ideia nessa direção durante a execução vira uma linha em
"Próximos passos" no README, **não** código.
