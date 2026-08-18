-- Schema inicial do Pulse FX.
--
-- Decisoes:
--  * `value` e NUMERIC, nunca DOUBLE PRECISION: erro de arredondamento em
--    variacao percentual e inaceitavel num produto financeiro.
--  * `ref_date` e DATE puro: uma observacao economica e um DIA de referencia,
--    nao um instante. Timezone entra so na formatacao da UI.
--  * A PK composta de `observations` e o que torna o sync idempotente.

CREATE TYPE indicator_source AS ENUM ('BCB_SGS', 'BCB_PTAX', 'FRED');
CREATE TYPE indicator_frequency AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE indicator_unit AS ENUM ('BRL', 'PERCENT', 'PERCENT_PER_YEAR', 'INDEX');

CREATE TABLE indicators (
    id             SERIAL PRIMARY KEY,
    code           TEXT NOT NULL UNIQUE,
    source         indicator_source NOT NULL,
    external_id    TEXT NOT NULL,
    name           TEXT NOT NULL,
    short_name     TEXT NOT NULL,
    unit           indicator_unit NOT NULL,
    frequency      indicator_frequency NOT NULL,
    variation_lag  INTEGER NOT NULL DEFAULT 1 CHECK (variation_lag > 0),
    precision      SMALLINT NOT NULL DEFAULT 4 CHECK (precision BETWEEN 0 AND 8),
    rationale      TEXT NOT NULL,
    limitations    TEXT NOT NULL,
    source_url     TEXT NOT NULL,
    backfill_years SMALLINT NOT NULL DEFAULT 5 CHECK (backfill_years > 0),
    display_order  SMALLINT NOT NULL DEFAULT 100,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT indicators_source_external_id_key UNIQUE (source, external_id)
);

COMMENT ON COLUMN indicators.variation_lag IS
    'N do calculo de variacao: quantas observacoes disponiveis para tras usar como denominador.';
COMMENT ON COLUMN indicators.rationale IS
    'Justificativa editorial da serie, exibida na tela de detalhe.';

CREATE TABLE observations (
    indicator_id INTEGER NOT NULL REFERENCES indicators (id) ON DELETE CASCADE,
    ref_date     DATE NOT NULL,
    value        NUMERIC(20, 8) NOT NULL,
    ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (indicator_id, ref_date)
);

-- Suporta tanto "ultimo valor" (LIMIT 1) quanto a janela de historico.
CREATE INDEX observations_indicator_ref_date_desc_idx
    ON observations (indicator_id, ref_date DESC);

CREATE TABLE sync_runs (
    id            BIGSERIAL PRIMARY KEY,
    indicator_id  INTEGER REFERENCES indicators (id) ON DELETE CASCADE,
    trigger       TEXT NOT NULL CHECK (trigger IN ('bootstrap', 'cron', 'admin')),
    status        TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped_ttl')),
    rows_upserted INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);

-- Consulta quente: "qual foi a ultima sync bem-sucedida deste indicador?",
-- usada tanto pelo freio de TTL quanto pelo campo lastSyncedAt da API.
CREATE INDEX sync_runs_indicator_success_idx
    ON sync_runs (indicator_id, finished_at DESC)
    WHERE status = 'success';

CREATE TABLE favorites (
    client_id    UUID NOT NULL,
    indicator_id INTEGER NOT NULL REFERENCES indicators (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, indicator_id)
);

COMMENT ON TABLE favorites IS
    'Favoritos por cliente anonimo. Autenticacao esta fora do escopo do MVP; o
     frontend gera um UUID por navegador e o envia no header x-client-id.';
