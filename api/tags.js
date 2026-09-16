import { supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'

export default async function handler(req, res) {
  const { usuario, token } = await getUsuarioFromRequest(req)
  if (!usuario) return res.status(401).json({ erro: 'não autenticado' })
  const supabase = supabaseComoUsuario(token)

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('tags_usuario')
      .select('id, tag')
      .eq('usuario_id', usuario.id)
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(200).json({ tags: data })
  }

  if (req.method === 'POST') {
    const { tag } = req.body || {}
    if (!tag || !tag.trim()) return res.status(400).json({ erro: 'tag vazia' })

    const { data, error } = await supabase
      .from('tags_usuario')
      .insert({ usuario_id: usuario.id, tag: tag.trim().toLowerCase() })
      .select('id, tag')
      .single()
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(201).json({ tag: data })
  }

  if (req.method === 'DELETE') {
    const { id } = req.query
    if (!id) return res.status(400).json({ erro: 'id ausente' })

    const { error } = await supabase
      .from('tags_usuario')
      .delete()
      .eq('id', id)
      .eq('usuario_id', usuario.id)
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(204).end()
  }

  return res.status(405).json({ erro: 'method not allowed' })
}
