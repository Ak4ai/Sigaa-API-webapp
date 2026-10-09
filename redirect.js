if (location.hostname === 'ak4ai.github.io') {
      for (const storage of [localStorage, sessionStorage]) {
        storage.removeItem('sigaa_token');
        storage.removeItem('sigaa_token_info');
      }
      location.replace('https://ak4ai-sigaa.duckdns.org/' + location.search + location.hash);
    }
