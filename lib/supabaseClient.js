import { createClient } from '@supabase/supabase-js'

// No front (Quasar), essas envs precisam do prefixo VITE_.
// Nas API functions (Node puro), usamos as mesmas variáveis sem prefixo.
const url =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const anonKey =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[roxnews] SUPABASE_URL / SUPABASE_ANON_KEY não configuradas.')
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true }
})

// Client "por request", carregando o JWT do usuário nos headers.
// Necessário pra RLS: sem isso, toda query roda como anônimo e as
// policies que checam auth.uid() sempre barram (mesmo já sabendo quem é o usuário).
export function supabaseComoUsuario(token) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

// Nas API routes, quando precisamos validar o usuário a partir do token
// enviado pelo front (header Authorization: Bearer <token>).
export async function getUsuarioFromRequest(req) {
  const authHeader = req.headers['authorization'] || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return { usuario: null, token: null }

  const { data, error } = await supabase.auth.getUser(token)
  if (error) return { usuario: null, token: null }
  return { usuario: data.user, token }
}
