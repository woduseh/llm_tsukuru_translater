import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/HomePage.vue') },
  { path: '/mvmz', name: 'mvmz', component: () => import('./views/MvMzPage.vue') },
  { path: '/wolf', name: 'wolf', component: () => import('./views/WolfPage.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/SettingsPage.vue') },
  { path: '/llm-settings', name: 'llm-settings', component: () => import('./views/LlmSettingsPage.vue') },
  { path: '/llm-compare', name: 'llm-compare', component: () => import('./views/LlmComparePage.vue') },
  { path: '/json-verify', name: 'json-verify', component: () => import('./views/JsonVerifyPage.vue') },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})
