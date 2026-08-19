# Pulse FX

Acompanhamento de **câmbio (BRL)** e **indicadores macro** a partir de fontes públicas
(**Banco Central do Brasil** e **FRED**), com dados persistidos em PostgreSQL, API própria
e cliente web.

> **Conteúdo educacional.** Dados de fontes públicas, sujeitos a revisão e a atraso de
> publicação. **Não constitui recomendação de investimento.**

---

## Sumário

- [Subir o ambiente](#subir-o-ambiente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Arquitetura](#arquitetura)
- [Indicadores e por que cada um](#indicadores-e-por-que-cada-um)
- [Regra de variação percentual](#regra-de-variação-percentual)
- [Janelas de histórico](#janelas-de-histórico)
- [Como o worker funciona](#como-o-worker-funciona)
- [Política de sincronização](#política-de-sincronização)
- [API](#api)
- [Testes e lint](#testes-e-lint)
- [Desenvolvimento sem Docker](#desenvolvimento-sem-docker)
- [Decisões técnicas e trade-offs](#decisões-técnicas-e-trade-offs)
- [Armadilhas reais encontradas nas fontes](#armadilhas-reais-encontradas-nas-fontes)
- [Fora de escopo](#fora-de-escopo)

---

## Subir o ambiente

**Pré-requisito único:** Docker Desktop (ou Docker Engine) rodando. Node, PostgreSQL e todas
as dependências ficam dentro dos containers — nada é instalado na sua máquina.

### Passo 1 — gere sua chave do FRED (2 minutos, gratuita)

As 4 séries americanas vêm do **FRED** (Federal Reserve Economic Data), que exige uma chave de
API **pessoal**. Ela não é versionada neste repositório: cada pessoa gera a sua.

1. Crie a conta gratuita e solicite a chave em
   **https://fredaccount.stlouisfed.org/apikeys**
2. A liberação é imediata — uma string de 32 caracteres hexadecimais.

> Sem chave o ambiente **sobe e funciona** com as 5 séries do BCB. Apenas os 4 cards
> americanos ficam sem dado, e o motivo aparece no log do worker. Dá para adicionar a chave
> depois, sem recomeçar.

### Passo 2 — configure e suba

```bash
cp .env.example .env          # cria o arquivo de variáveis a partir do modelo
# abra o .env e cole sua chave em FRED_API_KEY=
docker compose up --build     # sobe tudo
```

Espere a linha `pulse-fx-web ... Started` e abra **http://localhost:5173**.

O primeiro build leva de 2 a 4 minutos, porque compila API e frontend. Nas próximas vezes,
segundos.

### O que acontece quando você sobe

A ordem é garantida por **healthcheck**, não por `sleep`:

```
postgres (healthy) → migrate (migrations + seed) → api + worker → web
```

O worker faz o **backfill inicial** assim que sobe: 5 anos das séries diárias e 10 anos das
mensais. Os primeiros cards aparecem em segundos; o conjunto completo leva 1–2 minutos,
limitado pela velocidade das APIs públicas. Enquanto isso a UI mostra estado de carregamento
em vez de quebrar.

| Serviço | URL |
|---|---|
| **Web** | **http://localhost:5173** |
| API | http://localhost:3333 |
| Documentação da API (OpenAPI) | http://localhost:3333/docs |
| Health / readiness | http://localhost:3333/health · `/ready` |

### Comandos do dia a dia

```bash
docker compose logs -f worker     # acompanhar a sincronização
docker compose ps                 # estado dos containers
docker compose down               # parar tudo, mantendo os dados
docker compose down -v            # parar e APAGAR o banco
docker compose up --build         # subir de novo
```

**Adicionou a chave do FRED depois de já ter subido?** Rode `docker compose up -d worker`.
Precisa ser `up`, e não `restart`: o `restart` reaproveita as variáveis antigas do container.
Como `SYNC_ON_BOOTSTRAP=true`, o worker já busca as séries americanas ao subir.

### Se algo der errado

| Sintoma | Causa provável |
|---|---|
| `failed to connect to the docker API` | Docker Desktop não está rodando. |
| `port is already allocated` | Algo já ocupa 5173, 3333 ou 5432. Ajuste `WEB_PORT`, `API_PORT` ou `POSTGRES_PORT`. |
| Cards americanos vazios | `FRED_API_KEY` ausente ou inválida — confirme em `docker compose logs worker`. |
| Página abre mas sem dado | O backfill ainda está rodando. Acompanhe com `docker compose logs -f worker`. |

---

## Variáveis de ambiente

Todas documentadas em [`.env.example`](.env.example). As que importam:

| Variável | Padrão | Para que serve |
|---|---|---|
| `FRED_API_KEY` | *(vazio)* | **A única que você precisa preencher.** Gere a sua em [fredaccount.stlouisfed.org/apikeys](https://fredaccount.stlouisfed.org/apikeys). Sem ela, apenas as séries do BCB sincronizam. |
| `ADMIN_TOKEN` | `pulse-fx-dev-admin-token` | Bearer token de `POST /api/admin/sync`. Trocar fora da máquina local. |
| `SYNC_TTL_MINUTES` | `30` | Janela mínima entre duas sincronizações do mesmo indicador. |
| `SYNC_ON_BOOTSTRAP` | `true` | Sincronizar assim que o worker sobe. |
| `SYNC_REVISION_WINDOW_DAYS` | `5` | Quantos dias cada sync incremental relê, para capturar revisões. |
| `VITE_API_URL` | `http://localhost:3333` | URL da API embutida no bundle **em tempo de build**. |
| `POSTGRES_*`, `API_PORT`, `WEB_PORT` | ver arquivo | Credenciais e portas. |

Nenhuma chave é versionada: o arquivo de variáveis local está no `.gitignore`, e só o
`.env.example` — com `FRED_API_KEY` vazia — entra no git.

---

## Arquitetura

```
pulse-fx/
├── apps/
│   ├── api/                    Node + TypeScript (Fastify)
│   │   ├── migrations/         SQL versionado, aplicado em ordem
│   │   └── src/
│   │       ├── domain/         PURO — regra de negócio, sem I/O
│   │       ├── application/    Casos de uso + portas (interfaces)
│   │       ├── infrastructure/ Postgres, providers HTTP, config
│   │       ├── interface/http/ Rotas, mapeadores DTO, error handler
│   │       ├── container.ts    Composition root
│   │       ├── server.ts       Entrypoint da API
│   │       └── worker.ts       Entrypoint do sincronizador
│   └── web/                    React + TypeScript (Vite)
└── packages/
    └── shared/                 Contrato HTTP (schemas zod) usado pelos dois
```

### A decisão que estrutura o resto

> **A API de leitura nunca chama BCB ou FRED.** Ela lê exclusivamente do PostgreSQL.

Toda comunicação com o mundo externo passa pelo **worker**, um processo separado. Isso:

- **cumpre o requisito de não fazer chamadas descontroladas** — o tráfego para as fontes
  não é mais função do número de usuários, e sim do cronograma do worker;
- torna a leitura **determinística e rápida**, e testável sem rede;
- faz *"último valor válido"* ser uma propriedade do banco, não do estado da internet;
- **isola falhas**: se o BCB cair, o dashboard continua servindo o último dado persistido,
  com o campo `lastSyncedAt` deixando explícito que ele envelheceu.

### Regra de dependência entre camadas

`domain` não importa nada. `application` depende de **portas** (interfaces).
`infrastructure` implementa essas portas. `interface/http` só conhece `application`.

Isso **não é convenção verbal** — está no ESLint (`eslint.config.js`): um import de `pg` ou
`fastify` dentro de `domain/` quebra o lint. Separação de camadas que não é verificável se
degrada no primeiro atalho.

---

## Indicadores e por que cada um

Nove séries, **duas fontes**, **duas frequências**. A justificativa de cada uma vive no banco
(coluna `indicators.rationale`) e é renderizada na tela de detalhe — o texto editorial faz
parte do produto, não é um parágrafo perdido no README.

### BCB — o lado brasileiro

| Série | Fonte | Frequência | Por quê |
|---|---|---|---|
| **Dólar PTAX (venda)** | Olinda PTAX | Diária | Taxa **oficial** do BC, referência contratual de derivativos e liquidações cambiais. É o número que responde "quanto vale o dólar hoje" com valor jurídico. |
| **Euro** | SGS `21619` | Diária | Segunda moeda de referência. Ver EUR e USD lado a lado separa movimento **do real** de movimento **do dólar**: se o real cai contra as duas, o problema é local. |
| **Selic anualizada** | SGS `1178` | Diária | Juro básico efetivamente praticado. Determina o diferencial de juros contra os EUA, que move o câmbio. |
| **IPCA** | SGS `433` | Mensal | Inflação oficial e meta do BC. Conecta o câmbio ao bolso: desvalorização aparece no IPCA meses depois. |
| **IGP-M** | SGS `189` | Mensal | Peso alto de atacado e commodities em dólar — termômetro rápido do repasse cambial. |

### FRED — o outro lado do par

| Série | ID | Frequência | Por quê |
|---|---|---|---|
| **Treasury 10 anos** | `DGS10` | Diária | Taxa livre de risco global. Sobe → capital migra de emergentes → real enfraquece. |
| **Federal Funds Rate** | `FEDFUNDS` | Mensal | Selic americana. O par Selic × Fed Funds é a leitura mais direta do câmbio estrutural. |
| **Broad Dollar Index** | `DTWEXBGS` | Diária | Desempata a leitura: se USD/BRL sobe **e** o índice sobe, é o dólar contra o mundo. |
| **CPI americano** | `CPIAUCSL` | Mensal | Contraponto ao IPCA: inflação dos dois lados do par. |

Todos os códigos foram **verificados contra as APIs reais** antes de entrarem no seed.

---

## Regra de variação percentual

Implementada em [`apps/api/src/domain/variation.ts`](apps/api/src/domain/variation.ts) como
**função pura**, e consumida pelo dashboard e pela tela de detalhe através do **mesmo caso de
uso**. A consistência entre as duas telas é garantida **por construção**: não existe um segundo
lugar onde a conta possa sair diferente.

### Definições

| Termo | Definição adotada |
|---|---|
| **Último valor** | A observação **válida** mais recente já persistida. "Válida" exclui valor não numérico e, crucialmente, **exclui data de referência no futuro**. |
| **Data de referência** | A data da observação exibida. **Nunca** a hora da consulta — são dois campos separados na UI. |
| **Variação %** | `(último − anterior) / |anterior| × 100`, onde *anterior* é a **N-ésima observação disponível** para trás. |

### Os valores de N, e por quê

| Tipo de série | N | Justificativa |
|---|---|---|
| **Diárias** (câmbio, juros diários) | **1 fechamento anterior disponível** | É a leitura padrão de mercado ("o dólar hoje contra ontem") e a única que não inventa dado em feriado. |
| **Mensais** (IPCA, IGP-M, Fed Funds, CPI) | **1 mês** | Variação mês contra mês. |

**Deliberadamente não usamos "acumulado em 12 meses" como a variação do card.** É outra
métrica, com outro significado; misturar as duas quebraria a comparabilidade entre cards do
dashboard. Ela pode aparecer na tela de detalhe, **rotulada como métrica distinta**.

### Fins de semana, feriados e lacunas

**Política: último dado conhecido, sem interpolação.**

Fim de semana, feriado bancário ou falha de publicação simplesmente **não geram observação**.
Uma observação que não existe **não entra na contagem do N** — por isso a segunda-feira compara
com a sexta-feira, e não com um domingo fabricado.

Interpolar série financeira criaria um preço que nunca foi negociado. O card exibe a `refDate`
**real** do dado, que pode ser anterior a hoje, e mostra *"referência: 12/08/2026"* e
*"sincronizado há 20 min"* como **dois campos separados e rotulados**.

Os calendários de BCB e FRED **são diferentes**: existem dias com cotação no Brasil e sem dado
nos EUA, e vice-versa. Como cada série é calculada de forma independente, isso não é problema.

### Garantias numéricas

- **Nunca `float`.** `NUMERIC(20,8)` no Postgres, `Decimal` no domínio, **string** no JSON.
  A conversão para `number` acontece só na formatação da UI.
- **Denominador zero** → devolve variação absoluta e `percent: null`, nunca `Infinity`.
- **Denominador negativo** (IGP-M em deflação) → usa o módulo, para não inverter o sinal.
- **Dado insuficiente** → devolve `null`, e a UI mostra *"sem dado"*, **nunca um 0% enganoso**.

---

## Janelas de histórico

O default difere por frequência porque a mesma janela não serve para as duas: 90 dias de uma
série mensal são três pontos — um gráfico inútil.

| Frequência | Default | Opções | Backfill inicial |
|---|---|---|---|
| Diária | **90 dias** | 30d · 90d · 1 ano · 5 anos | 5 anos |
| Mensal | **5 anos** | 1 ano · 5 anos · tudo | 10 anos |

---

## Como o worker funciona

O worker é o **único processo que fala com BCB e FRED**. Ele roda no mesmo container image da
API, com outro entrypoint ([`worker.ts`](apps/api/src/worker.ts) em vez de `server.ts`), e o
Compose sobe os dois lado a lado. A API nunca sai do Postgres.

### Ciclo de vida

```
1. loadConfig()          lê e valida as variáveis de ambiente (falha rápido se faltar algo)
2. waitForDatabase()     espera o Postgres aceitar conexão
3. runMigrations()       aplica o que faltar (no-op se o serviço `migrate` já rodou)
4. bootstrap             se SYNC_ON_BOOTSTRAP=true, sincroniza tudo IMEDIATAMENTE, com force
5. cron.schedule()       registra os dois agendamentos e fica vivo
6. SIGTERM / SIGINT      fecha o pool de conexões e sai com código 0
```

O passo 3 não é redundante com o serviço `migrate` do Compose: ele permite rodar o worker
sozinho, fora do Compose, sem preparar o banco antes. Como o migrator usa **advisory lock** e
registra o que já aplicou, subir api e worker ao mesmo tempo é seguro — o segundo espera o
lock e encontra tudo pronto.

O **bootstrap usa `force: true`** de propósito: um ambiente recém-criado precisa de dado na
tela, e o TTL de uma execução anterior não pode impedir o primeiro backfill.

### O que acontece em cada ciclo

Um ciclo percorre os indicadores **ativos** (`indicators.active = TRUE`), **um de cada vez**.
Para cada um:

```
┌─ TTL ──────────── houve sync bem-sucedida há menos de SYNC_TTL_MINUTES?
│                   sim → registra `skipped_ttl` e NÃO chama a fonte. Fim.
│
├─ LOCK ─────────── try_advisory_lock(indicator_id)
│                   não obteve → outra instância já está nessa série. Fim, sem erro.
│
├─ JANELA ───────── série vazia   → hoje − backfill_years  (5 ou 10 anos)
│                   série povoada → MAX(ref_date) − SYNC_REVISION_WINDOW_DAYS
│
├─ FETCH ────────── provider da fonte (BCB_SGS, BCB_PTAX ou FRED)
│                   timeout 10s · 3 retries com backoff exponencial + jitter
│                   retry SÓ em 5xx, 408, 429, rede e timeout — nunca em 4xx
│
├─ UPSERT ───────── INSERT ... ON CONFLICT (indicator_id, ref_date) DO UPDATE
│                   WHERE value IS DISTINCT FROM EXCLUDED.value
│
└─ AUDITORIA ───── uma linha em `sync_runs`: success | failed | skipped_ttl
```

**Falha em uma série não interrompe as outras.** O erro vira linha em `sync_runs`, é logado, e
o loop segue para o próximo indicador. Foi assim que as 4 séries do FRED falharam sozinhas
enquanto as 5 do BCB sincronizaram normalmente, num ambiente sem chave.

**Um ciclo inteiro nunca derruba o worker**: `runSync` captura qualquer exceção que escape,
registra e mantém o processo vivo para o próximo agendamento.

### Por que em série, e não em paralelo

As APIs públicas do BCB são lentas e não têm SLA publicado. Disparar nove requisições
simultâneas contra elas seria exatamente o "acesso descontrolado" que o briefing pede para
evitar. O custo é o backfill inicial levar 1–2 minutos em vez de 20 segundos — uma vez só, na
primeira subida.

### Os dois agendamentos

| Cron | Expressão (UTC) | Por quê |
|---|---|---|
| Diário | `*/30 12-23 * * 1-5` | A PTAX sai por volta das 13h BRT. Varrer de 30 em 30 minutos só em dia útil, a partir do meio-dia UTC, cobre a publicação sem bater na fonte de madrugada nem no fim de semana. |
| Mensal | `0 9 * * *` | IPCA, IGP-M, Fed Funds e CPI saem em dias imprevisíveis do mês. Uma checagem diária barata (janela de revisão, poucos registros) é mais simples e confiável que tentar adivinhar a data de divulgação. |

Os dois disparam o **mesmo** caso de uso, que decide por indicador o que fazer. O TTL é o que
torna a varredura frequente barata: fora do horário de publicação, quase toda execução termina
em `skipped_ttl` sem tocar na rede.

### Acompanhando e disparando manualmente

```bash
docker compose logs -f worker      # log estruturado, uma linha JSON por evento
```

```jsonc
{"level":"info","msg":"sync concluida","code":"usd-brl-ptax",
 "from":"2021-08-18","to":"2026-08-18","fetched":1256,"rowsUpserted":1256}
{"level":"info","msg":"ciclo de sincronizacao concluido",
 "trigger":"bootstrap","summary":{"success":9}}
```

`rowsUpserted: 0` com `fetched > 0` **não é erro**: significa que a fonte devolveu os mesmos
valores que já estavam no banco e o `WHERE ... IS DISTINCT FROM` evitou a escrita.

Para forçar uma sincronização sem esperar o cron, existe o terceiro gatilho (`admin`), via
`POST /api/admin/sync` — o **único bypass do TTL**, e por isso atrás de um bearer token. O
comando está na [seção da API](#api).

---

## Política de sincronização

Três gatilhos, **um único caso de uso**
([`sync-indicators.usecase.ts`](apps/api/src/application/sync-indicators.usecase.ts)):

| Gatilho | Quando | Comportamento |
|---|---|---|
| `bootstrap` | Subida do worker | Série vazia → backfill completo. Série povoada → incremental. |
| `cron` | Diárias: `*/30 12-23 * * 1-5` UTC · Mensais: `0 9 * * *` UTC | Relê apenas a janela de revisão. |
| `admin` | `POST /api/admin/sync` com bearer token | `force: true` ignora o TTL. |

### Os freios contra chamada descontrolada

1. **TTL por indicador** — existindo sync bem-sucedida dentro de `SYNC_TTL_MINUTES`, a
   execução registra `skipped_ttl` e **não chama a fonte**. `force` é o **único** bypass, e
   está atrás do token de administrador.
2. **Advisory lock do Postgres, por indicador** — cron e chamada manual podem coincidir; o
   lock garante que só um dos dois fale com a fonte. É `try_advisory_lock`: desiste na hora
   em vez de enfileirar.
3. **Janela incremental** — cada sync relê apenas `MAX(ref_date) − 5 dias` até hoje, e não o
   histórico inteiro. A janela existe porque **IPCA e CPI são revisados** após publicados.
4. **Sincronização em série, não em paralelo** — as APIs do BCB são lentas e sem SLA público.
   Dez requisições simultâneas seriam exatamente o comportamento a evitar.
5. **Timeout de 10s, 3 retries com backoff exponencial e jitter** — e **nunca retry em 4xx**:
   repetir requisição malformada ou sem API key só gera carga inútil e atrasa o diagnóstico.
6. **Auditoria** — toda execução, inclusive as puladas, vira linha em `sync_runs`. Dá para
   responder *"por que este número está velho?"* sem adivinhar.

### Idempotência

O upsert usa `ON CONFLICT (indicator_id, ref_date) DO UPDATE ... WHERE value IS DISTINCT FROM
EXCLUDED.value`:

- `DO UPDATE` e não `DO NOTHING`, porque as fontes **revisam** dados já publicados;
- o `WHERE` evita escrita quando nada mudou — rodar a mesma sync duas vezes reporta
  `rowsUpserted: 0` na segunda;
- a PK composta torna a operação idempotente por construção.

---

## API

Documentação interativa em **http://localhost:3333/docs**.

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` · `/ready` | Liveness e readiness (o segundo consulta o Postgres). |
| `GET` | `/api/indicators?favorites=true` | Catálogo com último valor, data de referência e variação. |
| `GET` | `/api/indicators/:code` | Detalhe com `rationale`, `limitations` e link da fonte. |
| `GET` | `/api/indicators/:code/observations?window=30d\|90d\|1y\|5y\|max` | Série temporal. |
| `GET` | `/api/favorites` | Lista do cliente (header `x-client-id`). |
| `PUT` / `DELETE` | `/api/favorites/:code` | Marca/desmarca. Idempotente. |
| `POST` | `/api/admin/sync` | Dispara sincronização. **Bearer token.** |

### Formato do indicador

```jsonc
{
  "code": "usd-brl-ptax",
  "name": "Dolar americano PTAX (venda)",
  "unit": "BRL",
  "frequency": "DAILY",
  "precision": 4,
  "latest":   { "refDate": "2026-08-12", "value": "5.1639" },
  "previous": { "refDate": "2026-08-11", "value": "5.1285" },  // denominador EXPLÍCITO
  "variation": { "absolute": "0.0354", "percent": "0.6903", "lag": 1, "lagUnit": "business_day" },
  "isFavorite": true,
  "lastSyncedAt": "2026-08-18T12:00:00.000Z"
}
```

`previous` viaja junto com `variation` **de propósito**: o briefing exige denominador
explícito, e a UI usa isso para mostrar *"comparado com R$ 5,1285 em 11/08/2026"*. O frontend
**não recalcula nada**.

Disparar uma sincronização manualmente:

```bash
curl -X POST http://localhost:3333/api/admin/sync \
  -H "Authorization: Bearer pulse-fx-dev-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"codes":["usd-brl-ptax"],"force":true}'
```

---

## Testes e lint

```bash
npm test          # 122 testes, 7 arquivos — sem Docker, sem rede
npm run lint      # ESLint, incluindo a regra de fronteira entre camadas
npm run typecheck # tsc --noEmit em todos os workspaces
```

Suíte de integração contra PostgreSQL real (8º arquivo):

```bash
docker compose --profile test up -d postgres-test
npm run test:integration --workspace @pulse-fx/api
```

| Arquivo | Camada | O que protege |
|---|---|---|
| `domain/variation.test.ts` | Domínio | Lacunas de calendário, **data futura**, denominador zero e negativo, precisão decimal |
| `domain/date.test.ts` | Domínio | Os três formatos de data das fontes, ano bissexto, virada de mês/ano |
| `infrastructure/providers/providers.test.ts` | Infra | Parse dos payloads reais, política de retry, linha corrompida |
| `application/sync-indicators.test.ts` | Aplicação | **TTL**, idempotência, lock, revisão, resiliência a falha da fonte |
| `interface/http/routes.test.ts` | HTTP | Contrato, validação, 404/400/401, favoritos, isolamento entre clientes |
| `web/components/IndicatorCard.test.tsx` | Frontend | Formatação pt-BR, sem-dado vs 0%, acessibilidade da direção |
| `web/hooks/useToggleFavorite.test.tsx` | Frontend | Atualização otimista e **rollback em falha** |
| `db/repositories/repositories.integration.test.ts` | Persistência | SQL real: upsert idempotente, `DATE` sem shift de fuso, advisory lock |

**Nenhum teste toca a rede.** Os payloads dos providers são cópias fiéis de respostas reais
capturadas das APIs, injetadas via `fetch` falso.

---

## Desenvolvimento sem Docker

Requer Node 20+ e um PostgreSQL acessível.

```bash
npm install
# DATABASE_URL apontando para o seu Postgres
npm run db:migrate                       # aplica migrations + seed
npm run dev --workspace @pulse-fx/api    # API em :3333
npm run dev:worker --workspace @pulse-fx/api
npm run dev --workspace @pulse-fx/web    # Web em :5173
```

---

## Decisões técnicas e trade-offs

| Decisão | Alternativa considerada | Por que esta |
|---|---|---|
| **npm workspaces** | pnpm, Turborepo | Zero tooling extra e zero fricção no Docker. Ganho marginal não justifica o risco no prazo. |
| **Fastify** | Express | TS-first e `app.inject()` torna teste de rota trivial sem abrir socket. |
| **`pg` + SQL escrito à mão** | Prisma, Drizzle | Schema é artefato de **revisão**: quem lê o PR vê o DDL exato que roda em produção, não um diff gerado. Custo: ~60 linhas de migrator. Sem engine binária complicando a imagem. |
| **Migrator próprio** | node-pg-migrate | Advisory lock (api e worker sobem juntos), transação por arquivo, re-execução no-op. Explícito e auditável. |
| **Worker separado** | Cron dentro da API | Isola o ciclo de vida: instabilidade da fonte não afeta latência nem disponibilidade da leitura. |
| **Zod compartilhado** | Tipos duplicados | Um schema define o contrato nas duas pontas. Drift silencioso entre back e front deixa de ser possível. |
| **Valores como string no JSON** | `number` | `number` em JSON é double: reintroduziria erro de precisão exatamente na fronteira onde o dado vira visível. |
| **Favoritos por `x-client-id`** | Login | Autenticação está **fora de escopo** (§8), mas favoritos exigem persistência real (§4.3). Ver abaixo. |
| **Tailwind** | CSS Modules | Consistência visual sem inventar design system no prazo disponível. |

### O trade-off dos favoritos, explícito

A persistência é **real e no backend**: a tabela `favorites` guarda `(client_id, indicator_id)`
no Postgres. O dono da lista é um **UUID anônimo gerado pelo navegador** e enviado no header
`x-client-id`.

**A limitação:** a lista acompanha o **navegador**, não a pessoa. Limpar o armazenamento local
ou trocar de dispositivo começa uma lista nova. Resolver isso exigiria login — que o próprio
briefing coloca fora de escopo. A API valida que o header é um UUID, para o identificador não
virar chave arbitrária enumerável.

---

## Armadilhas reais encontradas nas fontes

Descobertas consultando as APIs de verdade, e todas cobertas por teste:

1. **A meta Selic (SGS `432`) retorna observações com data no FUTURO.** Consultada em
   18/08/2026, devolve linhas datadas de 15/09 e 16/09 — a meta vigente projetada até o
   próximo COPOM. Um *"último valor"* ingênuo pegaria uma data que ainda não aconteceu.
   → **Por isso a definição de último valor exclui `refDate > hoje`**, para todas as séries, e
   por isso usamos a série `1178` (Selic efetiva) em vez da `432`.

2. **Duas APIs do mesmo Banco Central usam formatos de data diferentes.** SGS usa
   `dd/MM/yyyy`; PTAX (Olinda) usa `MM-DD-YYYY` entre aspas simples na URL. Cada provider tem
   seu parser, testado isoladamente.

3. **O SGS devolve `valor` como string** (`"5.2043"`). Vai direto para `Decimal`; um
   `parseFloat` perderia precisão silenciosamente.

4. **O construtor do `Decimal` lança exceção** em entrada não numérica (`"n/d"`), em vez de
   devolver `NaN` como `Number()` faria. Sem um wrapper seguro, uma única célula suja no meio
   de cinco anos de histórico derrubaria a sincronização inteira da série. *(Esse bug existiu
   e foi pego pelo teste antes de qualquer execução real.)*

5. **O FRED marca observação ausente com o caractere `.`**, não com `null`. Feriado americano
   em série diária vem assim. Filtrado explicitamente na ingestão.

6. **IPCA, CPI e IBC-Br são revisados retroativamente** — daí o upsert com `DO UPDATE` e a
   janela de revisão de 5 dias em toda sync incremental.

7. **O parser default do `node-postgres` converte `DATE` para `Date` no fuso local**, e
   `2026-01-01` viraria `2025-12-31` em UTC−3. Registramos um parser que devolve a string ISO
   crua. Coberto por teste de integração.

8. **A Olinda devolve VÁRIOS boletins da PTAX no mesmo dia** — os intermediários e o de
   fechamento, cada um com seu `dataHoraCotacao`. Truncados para o dia de referência, todos
   colapsam na mesma chave `(indicator_id, ref_date)`, e o Postgres recusa o lote inteiro com
   *"ON CONFLICT DO UPDATE command cannot affect row a second time"*. O provider deduplica por
   data e fica com o boletim de maior horário, que é o de fechamento — a PTAX oficial.

---

## Fora de escopo

Conforme §8 do briefing: sem trading, ordens, conta bancária, pagamentos, KYC, recomendação
de investimento, streaming tick-by-tick ou multi-tenant.

### Próximos passos naturais

- Autenticação real, promovendo `client_id` a `user_id` sem mudar o modelo de favoritos.
- Acumulado em 12 meses na tela de detalhe, rotulado como métrica distinta.
- Alertas de variação e comparação de duas séries no mesmo gráfico.
- Métricas Prometheus a partir de `sync_runs` (latência e taxa de erro por fonte).

---

O briefing original está preservado em [`docs/BRIEFING.md`](docs/BRIEFING.md).
