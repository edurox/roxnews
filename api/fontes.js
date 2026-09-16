import { supabase } from '../lib/supabaseClient.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const { data, error } = await supabase
    .from('fontes_rss')
    .select('id, nome, idioma, categoria_padrao, ativo')
    .order('nome', { ascending: true })

  if (error) return res.status(500).json({ erro: error.message })
  return res.status(200).json({ fontes: data })
}
