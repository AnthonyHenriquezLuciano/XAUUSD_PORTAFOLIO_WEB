# Publicar XAU Portfolio AI con GitHub Pages (alternativa gratis a Vercel)

## Estado del despliegue
El frontend es una SPA React/Vite. GitHub Pages sirve los archivos compilados; todas las funciones de MT5, tablas y RPC siguen utilizando Supabase directamente. No necesita servicios Vercel.

- Repositorio: `AnthonyHenriquezLuciano/XAUUSD_PORTAFOLIO_WEB` (`main`).
- Carpeta de frontend: `frontend/`.
- URL esperada una vez activado Pages: `https://anthonyhenriquezluciano.github.io/XAUUSD_PORTAFOLIO_WEB/`.
- Workflow: `.github/workflows/deploy-pages.yml` (compila, prueba y publica sólo `frontend/dist`).
- La compilación aplica `--base=/XAUUSD_PORTAFOLIO_WEB/` solamente a Pages; Vercel mantiene `/`.
- Demo, modelos y descarga EA usan `import.meta.env.BASE_URL` para funcionar bajo el subdirectorio.
- El enlace de confirmación/restablecimiento de Supabase incluye la ruta de la SPA en Pages.

## Activación del sitio (una sola vez)
1. Abre `https://github.com/AnthonyHenriquezLuciano/XAUUSD_PORTAFOLIO_WEB/settings/pages`.
2. En **Build and deployment → Source**, selecciona **GitHub Actions**.
3. Ve a la pestaña **Actions** y ejecuta `Publish XAU Portfolio AI to GitHub Pages` → **Run workflow** seleccionando `main`, si no se ejecuta automáticamente.
4. Verifica que `build` y `deploy` terminan verdes. Solo entonces abre la URL esperada de Pages. Una URL publicada no es evidencia de que la autenticación esté bien configurada.

## Inicio de sesión y recuperación de contraseña
En **Supabase → Authentication → URL Configuration → Redirect URLs** agrega la URL exacta:

`https://anthonyhenriquezluciano.github.io/XAUUSD_PORTAFOLIO_WEB/`

No cambies necesariamente el **Site URL** principal de Supabase: puede seguir en Vercel para no romper los flujos existentes. El campo de redirect permite ambas URLs.

Para los callbacks de proveedores OAuth, valida los orígenes permitidos si más adelante se habilitan. Esta SPA usa Supabase directamente desde el navegador, por lo que sólo deben estar disponibles claves **publishable/anon** y políticas RLS. Nunca incluyas `service_role`, tokens MT5 privados ni contraseñas en frontend o Actions.

## Diagnóstico
- No carga CSS o aparece blanco: verifica `--base` y el test `test/validate_pages.mjs`.
- La demo/modelos/descarga EA dan 404: deben utilizar `import.meta.env.BASE_URL`.
- El correo de recuperación lleva a la raíz `github.io` o a Vercel: configura el Redirect URL en Supabase y prueba una cuenta de ensayo.
- El workflow falla en Configure Pages: confirma que `Source = GitHub Actions` está activado en Settings → Pages.
- El flujo pasa pero la URL aún no abre: verifica el enlace `page_url` publicado por el paso Deploy.
- No se recomienda activar automatización de órdenes sin las pruebas MT5 demo, sea cual sea el alojamiento.
- Vercel permanece independiente; no modificamos su dominio, proyecto o reglas del EA.
