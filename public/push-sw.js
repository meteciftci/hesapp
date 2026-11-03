/* Vade bildirimi: sunucudan gelen Web Push iletisini gösterir; dokununca uygulamayı açar. */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'HesApp', body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'HesApp', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/favicon-32.png',
      lang: 'tr',
      tag: 'hesapp-vade',
      data: { url: data.url || '/yaklasan' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
