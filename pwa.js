if ('serviceWorker' in navigator) {
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
