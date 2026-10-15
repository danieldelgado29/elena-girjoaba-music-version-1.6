# Evidencia — EGP Panel + EGP Músicos

Fecha: 2026-10-14

Repositorio:

`danieldelgado29/elena-girjoaba-music-version-1.6`

HEAD previo:

`1f962f9ed0a374fab1355b16e716f22bbe0a834b`

## Alcance

Este cambio afecta únicamente:

- EGP Panel
- EGP Músicos

**Bridge está expresamente fuera de alcance.**

No se copió, modificó, reinició ni versionó ningún archivo de Bridge.

## Por qué se hizo

Durante las pruebas se verificó que el repositorio publicado no contenía
todavía las correcciones finales usadas en el entorno local.

### Problema 1 — Local Core deshabilitado en Músicos

`musicos/app.js` tenía:

```
EGP16_BACKUP_FIREBASE_ONLY = true
LOCAL_CORE = ""
```

Por tanto el código LAN existía pero estaba desactivado y Firebase quedaba
como fuente efectiva.

### Problema 2 — estado vivo potencialmente cacheable

Los Service Workers podían atender recursos del mismo origen desde Cache
Storage.

Para el estado dinámico de:

`/api/*`

esto es incorrecto porque podría mostrar una cola anterior.

## Cambios aplicados

### musicos/app.js

- Local Core habilitado.
- Core LAN primario:
  `https://10.10.10.2:8789`
- Firebase se conserva como respaldo.
- Cuando Músicos corre desde el Core local usa:
  - `/panel/configuracion.json`
  - `/musicos/canciones.json`
- En hosting remoto se conservan las rutas relativas existentes.

### musicos/service-worker.js

- `/api/*` usa siempre red/Core.
- `cache: "no-store"`.
- Sin fallback a Cache Storage para estado live.

### service-worker-6.36.94.js

- Misma protección para Panel/app principal:
  `/api/*` no se sirve desde caché.

### musicos/index.html

- Nuevo cache-bust:
  `lan-live-core-20261014-v1`

## Regla arquitectónica

**Core local/LAN manda durante el show.**

Internet/Firebase actúa como respaldo.

El estado vivo nunca debe reconstruirse desde una copia antigua de caché.

## No modificado

- Bridge
- Logic
- Ui24R
- credenciales Firebase
- proyecto Firebase
- diseño visual del Panel
