import { tamanhoFilaSemThumb, usoIAHoje } from '../lib/redisClient.js'

const COTA_IA_DIARIA = Number(process.env.COTA_IA_DIARIA || 300)

// Diagnóstico rápido do pipeline de thumbs — não protegido por CRON_SECRET
// de propósito (é só leitura, nada sensível), pra dar uma olhada rápida no
// navegador sem precisar abrir o console do Upstash.
export default async function handler(req, res) {
  try {
    const [fila, usoIA] = await Promise.all([tamanhoFilaSemThumb(), usoIAHoje()])

    return res.status(200).json({
      filaSemThumb: fila,
      iaConfigurada: Boolean(process.env.OPENROUTER_API_KEY),
      pexelsConfigurado: Boolean(process.env.PEXELS_API_KEY),
      cotaIA: { usado: usoIA, limite: COTA_IA_DIARIA, excedida: usoIA >= COTA_IA_DIARIA }
    })
  } catch (err) {
    console.error('[roxnews] erro em /api/status-thumbs:', err)
    return res.status(500).json({ erro: 'falha ao ler status da fila de thumbs' })
  }
}
