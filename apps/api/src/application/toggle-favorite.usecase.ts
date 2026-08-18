import { IndicatorNotFoundError } from '../domain/errors.js';
import type { FavoriteRepository, IndicatorRepository } from './ports.js';

/**
 * "Meus indicadores" (briefing, secao 4.3).
 *
 * A persistencia e REAL e fica no backend: a tabela `favorites` guarda o par
 * (client_id, indicator_id). Autenticacao esta fora do escopo do MVP (secao
 * 8), entao o dono da lista e um UUID anonimo gerado pelo navegador e enviado
 * no header x-client-id. O trade-off - a lista acompanha o navegador, nao a
 * pessoa - esta documentado no README.
 */
export class ToggleFavoriteUseCase {
  constructor(
    private readonly indicators: IndicatorRepository,
    private readonly favorites: FavoriteRepository,
  ) {}

  private async resolveIndicatorId(code: string): Promise<number> {
    const indicator = await this.indicators.findByCode(code);
    if (!indicator || !indicator.active) throw new IndicatorNotFoundError(code);
    return indicator.id;
  }

  async add(clientId: string, code: string): Promise<void> {
    await this.favorites.add(clientId, await this.resolveIndicatorId(code));
  }

  async remove(clientId: string, code: string): Promise<void> {
    await this.favorites.remove(clientId, await this.resolveIndicatorId(code));
  }

  async list(clientId: string): Promise<string[]> {
    return this.favorites.findCodesByClient(clientId);
  }
}
