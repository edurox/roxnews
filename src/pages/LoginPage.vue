<template>
  <q-page class="q-pa-xl flex flex-center">
    <div class="rox-login-box">
      <div class="rox-headline text-h5 q-mb-sm">ROXNEWS</div>
      <div class="rox-summary q-mb-lg">
        Entre com seu e-mail pra manter suas tags e fontes bloqueadas
        sincronizadas entre aparelhos. Sem senha — você recebe um link.
      </div>

      <q-input
        v-model="email"
        dark
        outlined
        dense
        type="email"
        placeholder="seu@email.com"
        @keyup.enter="enviarLink"
      />
      <q-btn
        class="q-mt-md full-width"
        color="primary"
        unelevated
        :loading="enviando"
        :label="enviado ? 'Link enviado, confira seu e-mail' : 'Enviar link de acesso'"
        @click="enviarLink"
      />
    </div>
  </q-page>
</template>

<script setup>
import { ref } from 'vue'
import { supabase } from 'src/boot/supabase'

const email = ref('')
const enviando = ref(false)
const enviado = ref(false)

async function enviarLink() {
  if (!email.value.trim()) return
  enviando.value = true
  const { error } = await supabase.auth.signInWithOtp({
    email: email.value.trim(),
    options: {
      emailRedirectTo: import.meta.env.VITE_APP_URL || 'https://roxnews.vercel.app'
    }
  })
  enviando.value = false
  if (!error) enviado.value = true
}
</script>

<style scoped>
.rox-login-box {
  max-width: 360px;
  width: 100%;
}
</style>
