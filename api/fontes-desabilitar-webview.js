import { supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const { usuario, token } = await getUsuarioFromRequest(req)
  if (!usuario) return res.status(401).json({ erro: 'não autenticado' })

  const { fonteId } = req.body || {}
  if (!fonteId) return res.status(400).json({ erro: 'fonteId ausente' })

  const supabase = supabaseComoUsuario(token)
  const { error } = await supabase
    .from('fontes_rss')
    .update({ abre_webview: false })
    .eq('id', fonteId)

  if (error) return res.status(500).json({ erro: error.message })
  return res.status(204).end()
}
