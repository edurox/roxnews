<template>
  <q-page class="q-pa-md rox-page">
    <div class="rox-headline text-h5 q-mb-md">Configurações</div>

    <div v-if="!logado" class="rox-summary q-pa-md q-mb-lg rox-card">
      Você precisa entrar pra salvar interesses e fontes bloqueadas
      (assim eles sincronizam entre aparelhos).
      <div class="q-mt-sm">
        <q-btn color="primary" unelevated size="sm" to="/entrar" label="Entrar" />
      </div>
    </div>

    <template v-else>
      <div class="rox-meta q-mb-sm">seus interesses</div>
      <div class="row q-gutter-xs q-mb-sm">
        <q-chip
          v-for="tag in tags"
          :key="tag.id"
          removable
          class="rox-tag-chip"
          :label="tag.tag"
          @remove="removerTag(tag.id)"
        />
      </div>
      <q-input
        v-model="novaTag"
        dense
        outlined
        dark
        placeholder="ex: world of warcraft, tecnologia"
        @keyup.enter="adicionarTag"
        class="q-mb-lg"
      >
        <template #append>
          <q-btn flat dense icon="add" @click="adicionarTag" />
        </template>
      </q-input>

      <div class="rox-meta q-mb-sm">fontes bloqueadas</div>
      <div v-if="fontesBloqueadas.length === 0" class="rox-summary q-mb-lg">
        Nenhuma fonte bloqueada ainda. Use o botão de "ocultar" num card do feed.
      </div>
      <div v-else class="row q-gutter-xs q-mb-lg">
        <q-chip
          v-for="fonteId in fontesBloqueadas"
          :key="fonteId"
          removable
          class="rox-tag-chip"
          :label="fonteId"
          @remove="desbloquearFonte(fonteId)"
        />
      </div>
    </template>
  </q-page>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { supabase } from 'src/boot/supabase'

const tags = ref([])
const novaTag = ref('')
const fontesBloqueadas = ref([])
const logado = ref(false)

async function authHeader() {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function carregarTags() {
  const resp = await fetch('/api/tags', { headers: await authHeader() })
  if (resp.ok) tags.value = (await resp.json()).tags
}

async function adicionarTag() {
  if (!novaTag.value.trim()) return
  const resp = await fetch('/api/tags', {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag: novaTag.value })
  })
  if (resp.ok) {
    const { tag } = await resp.json()
    tags.value.push(tag)
    novaTag.value = ''
  }
}

async function removerTag(id) {
  await fetch(`/api/tags?id=${id}`, { method: 'DELETE', headers: await authHeader() })
  tags.value = tags.value.filter((t) => t.id !== id)
}

async function carregarFontesBloqueadas() {
  const resp = await fetch('/api/fontes-bloqueadas', { headers: await authHeader() })
  if (resp.ok) fontesBloqueadas.value = (await resp.json()).fontesBloqueadas
}

async function desbloquearFonte(fonteId) {
  await fetch(`/api/fontes-bloqueadas?fonteId=${fonteId}`, {
    method: 'DELETE',
    headers: await authHeader()
  })
  fontesBloqueadas.value = fontesBloqueadas.value.filter((f) => f !== fonteId)
}

onMounted(async () => {
  const { data: sessao } = await supabase.auth.getSession()
  logado.value = !!sessao?.session
  if (logado.value) {
    carregarTags()
    carregarFontesBloqueadas()
  }

  supabase.auth.onAuthStateChange((_event, session) => {
    logado.value = !!session
    if (logado.value) {
      carregarTags()
      carregarFontesBloqueadas()
    }
  })
})
</script>

<style scoped>
.rox-page {
  max-width: 640px;
  margin: 0 auto;
}
</style>
