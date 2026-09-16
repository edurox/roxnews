import { createClient } from '@supabase/supabase-js'

// No front (Vite/Quasar) as envs só chegam ao browser com o prefixo VITE_.
// Isso é um cliente separado do lib/supabaseClient.js, que é só pro lado Node (API functions).
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true } }
)

export default ({ app }) => {
  app.config.globalProperties.$supabase = supabase
}
