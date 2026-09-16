import { defineConfig } from '#q-app/wrappers'

export default defineConfig(() => {
  return {
    boot: ['pinia', 'supabase'],
    css: ['app.scss'],
    extras: ['roboto-font', 'material-icons'],

    build: {
      target: { browser: ['es2019'], node: 'node24' },
      vueRouterMode: 'history'
    },

    devServer: {
      open: true
    },

    framework: {
      config: {
        dark: true,
        brand: {
          primary: '#4F8F6D',
          secondary: '#B98A4E',
          accent: '#4F8F6D',
          dark: '#191712',
          'dark-page': '#191712',
          positive: '#4F8F6D',
          negative: '#B0524A',
          info: '#5B7FA6',
          warning: '#B98A4E'
        }
      },
      plugins: ['Notify', 'Dialog']
    },

    pwa: {
      workboxMode: 'GenerateSW',
      manifest: {
        name: 'ROXNEWS',
        short_name: 'ROXNEWS',
        description: 'Feed de notícias curado, sem doomscrolling',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#191712',
        theme_color: '#191712',
        icons: [
          { src: 'icons/icon-128x128.png', sizes: '128x128', type: 'image/png' },
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    }
  }
})
