-- Catalogo de indicadores do Pulse FX.
--
-- O catalogo entra como MIGRATION, e nao como script solto, porque ele faz
-- parte do schema do produto: qualquer ambiente (dev, teste, CI, producao)
-- precisa subir com exatamente as mesmas series, de forma reproduzivel.
--
-- Os campos `rationale` e `limitations` atendem ao briefing (secoes 3 e 4.2) e
-- sao renderizados na tela de detalhe. Ficam no banco, e nao hardcoded no
-- frontend, para que editar o texto editorial nao exija rebuild da UI.
--
-- Todos os codigos de serie abaixo foram verificados contra as APIs publicas.

INSERT INTO indicators
    (code, source, external_id, name, short_name, unit, frequency,
     variation_lag, precision, backfill_years, display_order, rationale, limitations, source_url)
VALUES

-- =========================================================================
-- BCB - cambio e macro Brasil
-- =========================================================================

('usd-brl-ptax', 'BCB_PTAX', 'CotacaoDolarPeriodo',
 'Dolar americano PTAX (venda)', 'USD/BRL PTAX',
 'BRL', 'DAILY', 1, 4, 5, 10,
 'A PTAX e a taxa oficial de cambio calculada pelo Banco Central a partir das negociacoes do dia no mercado interbancario. E a referencia contratual usada em derivativos, contratos indexados ao dolar e liquidacoes cambiais no Brasil. Para o usuario do Pulse FX, e o numero que responde "quanto vale o dolar hoje" com valor juridico, nao apenas indicativo.',
 'Divulgada uma vez por dia util, no fechamento (por volta das 13h). Nao existe cotacao em fins de semana e feriados bancarios: nesses dias o card exibe a ultima data util disponivel, sem interpolar. A cotacao de venda e a exibida; a de compra tambem e coletada. Nao e a cotacao de casa de cambio nem inclui spread ou IOF.',
 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/swagger-ui3/'),

('eur-brl', 'BCB_SGS', '21619',
 'Euro (venda)', 'EUR/BRL',
 'BRL', 'DAILY', 1, 4, 5, 20,
 'Segunda moeda de referencia para quem acompanha cambio no Brasil, relevante para comercio exterior com a zona do euro e para viagens. Acompanhar EUR e USD lado a lado separa movimento especifico do real de movimento global do dolar: se o real cai contra as duas, o problema e local; se cai so contra o dolar, a forca e do dolar.',
 'Serie diaria do SGS, publicada apenas em dias uteis. Reflete a taxa de fechamento divulgada pelo BCB e nao a cotacao intraday. Lacunas em feriados sao tratadas como ausencia de dado, sem interpolacao.',
 'https://www3.bcb.gov.br/sgspub/'),

('selic-daily', 'BCB_SGS', '1178',
 'Taxa Selic anualizada (base 252)', 'Selic',
 'PERCENT_PER_YEAR', 'DAILY', 1, 2, 5, 30,
 'Taxa basica de juros efetivamente praticada no mercado de reservas bancarias, anualizada. E o piso de remuneracao da economia brasileira e o principal determinante do diferencial de juros contra os EUA, que por sua vez move o cambio. Usamos a serie efetiva diaria (1178) e nao a meta (432) de proposito - ver limitacoes.',
 'A serie da META Selic (SGS 432) publica a meta vigente projetada ate a proxima reuniao do COPOM, ou seja, devolve observacoes com data no FUTURO. Isso quebraria a definicao de "ultimo valor observado". A serie 1178 registra a taxa efetiva ja praticada. Por ser taxa, a leitura correta da mudanca e em pontos percentuais, exibida junto da variacao percentual.',
 'https://www3.bcb.gov.br/sgspub/'),

('ipca-monthly', 'BCB_SGS', '433',
 'IPCA - variacao mensal', 'IPCA',
 'PERCENT', 'MONTHLY', 1, 2, 10, 40,
 'Indice oficial de inflacao ao consumidor do Brasil, calculado pelo IBGE e usado como meta pelo Banco Central. E o indicador que conecta o cambio ao bolso do usuario: desvalorizacao cambial costuma aparecer no IPCA alguns meses depois, via bens importados e combustiveis.',
 'Divulgado mensalmente, com defasagem de cerca de duas semanas apos o fim do mes de referencia. O valor da serie ja E uma variacao percentual mensal, entao a variacao calculada pelo Pulse FX e a diferenca entre dois meses de inflacao (em pontos percentuais), nao inflacao acumulada. O acumulado em 12 meses e outra metrica e nao deve ser confundido com esta. Sujeito a revisao pelo IBGE.',
 'https://www3.bcb.gov.br/sgspub/'),

('igpm-monthly', 'BCB_SGS', '189',
 'IGP-M - variacao mensal', 'IGP-M',
 'PERCENT', 'MONTHLY', 1, 2, 10, 50,
 'Indice geral de precos calculado pela FGV, historicamente usado para reajuste de contratos de aluguel no Brasil. Tem peso grande de precos no atacado e de commodities cotadas em dolar, o que o torna muito mais sensivel ao cambio que o IPCA - util como termometro rapido do repasse cambial.',
 'Volatil e frequentemente negativo, o que torna esta serie o caso de teste natural para variacao com denominador negativo. Divulgado mensalmente pela FGV e redistribuido pelo BCB. A variacao entre dois meses e expressa em pontos percentuais.',
 'https://www3.bcb.gov.br/sgspub/'),

-- =========================================================================
-- FRED - o outro lado do par cambial
-- =========================================================================

('us-treasury-10y', 'FRED', 'DGS10',
 'Treasury americano de 10 anos', 'US 10Y',
 'PERCENT_PER_YEAR', 'DAILY', 1, 2, 5, 60,
 'Juro do titulo de 10 anos do Tesouro americano, a taxa livre de risco de referencia global. Quando ele sobe, capital tende a migrar de mercados emergentes para os EUA e o real se enfraquece. Colocado ao lado da Selic, mostra ao usuario o diferencial de juros que sustenta (ou nao) o real.',
 'Serie diaria publicada em dias uteis americanos, cujo calendario de feriados DIFERE do brasileiro: havera dias com cotacao no Brasil e sem dado nos EUA, e vice-versa. O FRED usa o caractere "." para marcar observacao ausente; esses registros sao descartados na ingestao e nao entram no calculo.',
 'https://fred.stlouisfed.org/series/DGS10'),

('fed-funds', 'FRED', 'FEDFUNDS',
 'Federal Funds Rate (media mensal)', 'Fed Funds',
 'PERCENT_PER_YEAR', 'MONTHLY', 1, 2, 10, 70,
 'Taxa basica de juros dos Estados Unidos, equivalente americano da Selic. Define o custo do dolar no mundo e e o principal driver de fluxo de capital global. O par Selic x Fed Funds e a leitura mais direta de por que o real se valoriza ou se desvaloriza estruturalmente.',
 'Esta serie e a MEDIA MENSAL da taxa efetiva, nao a meta anunciada pelo FOMC. Por isso o mes em que ocorre uma decisao aparece com valor intermediario entre a taxa antiga e a nova. Publicada no inicio do mes seguinte ao de referencia.',
 'https://fred.stlouisfed.org/series/FEDFUNDS'),

('us-dollar-index', 'FRED', 'DTWEXBGS',
 'Indice amplo do dolar (Broad Dollar Index)', 'Dollar Index',
 'INDEX', 'DAILY', 1, 4, 5, 80,
 'Indice que mede o dolar contra uma cesta ampla de moedas de parceiros comerciais dos EUA. E o desempate da leitura do cambio: se o USD/BRL sobe e este indice tambem sobe, o movimento e do dolar contra o mundo; se este indice esta estavel, o movimento e especifico do real.',
 'E um numero-indice, sem unidade monetaria - so a variacao tem significado, o nivel absoluto nao. A base do indice foi fixada em janeiro de 2006 = 100. Publicado em dias uteis americanos, com revisoes ocasionais.',
 'https://fred.stlouisfed.org/series/DTWEXBGS'),

('us-cpi', 'FRED', 'CPIAUCSL',
 'CPI americano (indice, ajustado sazonalmente)', 'US CPI',
 'INDEX', 'MONTHLY', 1, 3, 10, 90,
 'Indice de precos ao consumidor dos EUA, o dado que mais move as decisoes do Federal Reserve e, por consequencia, o dolar no mundo inteiro. Serve de contraponto direto ao IPCA: permite ao usuario comparar a inflacao dos dois lados do par USD/BRL.',
 'Ao contrario do IPCA, esta serie e um INDICE DE NIVEL, nao uma variacao mensal - por isso a variacao calculada pelo Pulse FX sobre ela ja e a inflacao mensal americana em percentual. Ajustado sazonalmente e sujeito a revisao pelo BLS nos meses seguintes.',
 'https://fred.stlouisfed.org/series/CPIAUCSL');
