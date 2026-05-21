self.addEventListener('install', function() {
  self.skipWaiting();
});
self.addEventListener('activate', function() {
  self.registration.unregister().then(function() {
    return self.clients.matchAll({ type: 'window' });
  }).then(function(clients) {
    clients.forEach(function(client) {
      client.navigate(client.url);
    });
  });
});
