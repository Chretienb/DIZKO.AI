// Dizko.ai Service Worker — handles Web Push notifications

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', e => {
  if (!e.data) return
  const { title, body, url, icon } = e.data.json()
  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon:  icon || '/favicon.svg',
      badge: '/favicon.svg',
      data:  { url: url || '/' },
      vibrate: [100, 50, 100],
      tag: 'dizko-notification',
      renotify: true,
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin))
      if (existing) { existing.focus(); existing.navigate(url) }
      else self.clients.openWindow(url)
    })
  )
})
