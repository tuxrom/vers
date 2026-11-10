add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "fullscreen=(self), autoplay=(self), accelerometer=(), camera=(), microphone=(), geolocation=()" always;
# Tout vient de la même origine (scripts, service worker Workbox, WebSocket /ws). Les styles en ligne restent permis
# (index.html et attributs style des menus) ; aucune page tierce ne peut encadrer le jeu.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
