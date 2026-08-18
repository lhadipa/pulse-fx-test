/**
 * Disclaimer obrigatorio (briefing, secao 4.5).
 *
 * Fica no layout, e nao em cada pagina: assim ele aparece em TODAS as rotas
 * por construcao, sem depender de alguem lembrar de inclui-lo numa tela nova.
 */
export function Disclaimer(): JSX.Element {
  return (
    <div
      role="note"
      className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200"
    >
      <strong className="font-semibold">Conteudo educacional.</strong> Dados de fontes publicas
      (BCB e FRED), sujeitos a revisao e a atraso de publicacao.{' '}
      <strong className="font-semibold">Nao constitui recomendacao de investimento.</strong>
    </div>
  );
}
