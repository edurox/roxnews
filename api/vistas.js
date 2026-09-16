import { getUsuarioFromRequest } from '../lib/supabaseClient.js'
import { marcarComoVistas } from '../lib/redisClient.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const { usuario } = await getUsuarioFromRequest(req)
  if (!usuario) return res.status(401).json({ erro: 'não autenticado' })

  const { ids } = req.body || {}
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ erro: 'ids ausentes' })
  }

  await marcarComoVistas(usuario.id, ids)
  return res.status(204).end()
}
