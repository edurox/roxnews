<template>
  <q-layout view="hHh lpR fFf">
    <q-page-container>
      <router-view />
    </q-page-container>

    <q-footer reveal bordered class="rox-nav">
      <q-toolbar>
        <q-toolbar-title class="rox-logo">
          <router-link to="/" class="rox-logo-link">ROXNEWS</router-link>
        </q-toolbar-title>

        <q-btn
          flat
          round
          dense
          icon="tune"
          to="/configuracoes"
          aria-label="Configurações"
        />
      </q-toolbar>
    </q-footer>
  </q-layout>
</template>

<script setup>
</script>

<style scoped>
.rox-nav {
  background: var(--rox-bg);
  border-top: 1px solid var(--rox-line);
}

.rox-logo {
  font-family: var(--rox-font-meta);
  font-size: 16px;
  letter-spacing: 1px;
  color: var(--rox-ink);
}

.rox-logo-link {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}
</style>
