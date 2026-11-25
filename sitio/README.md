# Sitio web de Jc-System

Página de la empresa en **jcsystemhn.com**: HTML, CSS y JavaScript sin librerías ni compilación.

- `index.html`, `estilos.css`, `app.js`: la página.
- `img/` y `media/`: capturas de CONECTA, logo y el video corto.
- El formulario de contacto no guarda nada: arma el mensaje y abre WhatsApp (+504 8776-4208).

**Verlo en la computadora:** `python3 -m http.server 3200 --directory sitio` y abrir http://localhost:3200.

**Publicarlo:** al unir cambios de `sitio/` en `main` corre solo el flujo «Publicar el sitio de
Jc-System» (`.github/workflows/sitio-web.yml`). La primera vez muestra en su resumen los registros
del DNS que hay que crear en Spaceship. La infraestructura está en `infra/sitio-web.yaml`.
