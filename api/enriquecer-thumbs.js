import { processarLoteFilaThumbs } from '../lib/processarFilaThumbs.js'

const TAMANHO_LOTE_PADRAO = 40
const LIMITE_LOTE_MAXIMO = 100

// Faxina de retaguarda: roda 1x/dia via cron (limite do plano Hobby da
// Vercel — ver comentário em vercel.json) e processa um lote grande da fila
// de uma vez. O grosso do trabalho em tempo quase real acontece via
// enriquecimento oportunista dentro de /api/feed.js, não aqui.
export default async function handler(req, res) {
  const segredoEsperado = process.env.CRON_SECRET
  const autorizacao = req.headers['authorization']
  if (segredoEsperado && autorizacao !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ erro: 'não autorizado' })
  }

  const quantidade = Math.min(Number(req.query.quantidade) || TAMANHO_LOTE_PADRAO, LIMITE_LOTE_MAXIMO)

  try {
    const resultados = await processarLoteFilaThumbs(quantidade)
    return res.status(200).json({ processados: resultados.length, resultados })
  } catch (err) {
    console.error('[roxnews] erro em /api/enriquecer-thumbs:', err)
    return res.status(500).json({ erro: 'falha ao processar fila de thumbs' })
  }
}
