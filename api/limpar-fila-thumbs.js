import { redis, tamanhoFilaSemThumb } from '../lib/redisClient.js'

// Zera a fila:sem-thumb sob demanda. Protegido pelo mesmo CRON_SECRET dos
// outros endpoints administrativos — isso apaga fila de verdade, então não
// fica aberto como o /api/status-thumbs (que é só leitura).
//
// Seguro de rodar a qualquer momento: com a resolução ao vivo em
// /api/feed.js, a fila virou só uma rede de segurança/retry, não o caminho
// principal. Notícia sem imagem que aparecer de novo numa página do feed
// tenta resolver ao vivo de novo, e reentra na fila sozinha se falhar.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const segredoEsperado = process.env.CRON_SECRET
  const autorizacao = req.headers['authorization']
  if (segredoEsperado && autorizacao !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ erro: 'não autorizado' })
  }

  try {
    const tamanhoAntes = await tamanhoFilaSemThumb()
    await redis.del('fila:sem-thumb')
    return res.status(200).json({ removidos: tamanhoAntes })
  } catch (err) {
    console.error('[roxnews] erro em /api/limpar-fila-thumbs:', err)
    return res.status(500).json({ erro: 'falha ao limpar fila de thumbs' })
  }
}
