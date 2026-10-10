const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (localPreview && 'serviceWorker' in navigator) {
  // Local previews should always use the current files, without an old PWA controller.
  window.addEventListener('load', async () => {
    const controlled = !!navigator.serviceWorker.controller;
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.filter(name => name.startsWith('sigaa-pwa-')).map(name => caches.delete(name)));
    if (controlled) location.reload();
  });
} else if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then(function(registration) {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', function() {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        // Verifica atualizações a cada 30s
        setInterval(function() {
          registration.update();
        }, 30 * 1000);

        // Verifica ao voltar para a aba
        document.addEventListener('visibilitychange', function() {
          if (document.visibilityState === 'visible') {
            registration.update();
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }
