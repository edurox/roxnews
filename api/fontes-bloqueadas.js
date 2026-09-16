import { supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'

export default async function handler(req, res) {
  const { usuario, token } = await getUsuarioFromRequest(req)
  if (!usuario) return res.status(401).json({ erro: 'não autenticado' })
  const supabase = supabaseComoUsuario(token)

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('fontes_bloqueadas')
      .select('fonte_id')
      .eq('usuario_id', usuario.id)
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(200).json({ fontesBloqueadas: data.map((d) => d.fonte_id) })
  }

  if (req.method === 'POST') {
    const { fonteId } = req.body || {}
    if (!fonteId) return res.status(400).json({ erro: 'fonteId ausente' })

    const { error } = await supabase
      .from('fontes_bloqueadas')
      .insert({ usuario_id: usuario.id, fonte_id: fonteId })
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(201).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const { fonteId } = req.query
    if (!fonteId) return res.status(400).json({ erro: 'fonteId ausente' })

    const { error } = await supabase
      .from('fontes_bloqueadas')
      .delete()
      .eq('usuario_id', usuario.id)
      .eq('fonte_id', fonteId)
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ erro: 'method not allowed' })
}
