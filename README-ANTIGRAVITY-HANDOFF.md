# Handoff: fork OpenCode + Antigravity CLI

Este documento permite continuar el trabajo en otra sesión o con otro agente.

## Objetivo del fork

Este fork añade **Antigravity** como un provider nativo de OpenCode. No usa una API HTTP ni una API key de Google: ejecuta el binario local `agy.exe` como proceso hijo y traduce su protocolo `stream-json` al proveedor AI SDK que OpenCode ya sabe consumir.

El flujo que se busca es:

1. El usuario abre `/connect` en OpenCode.
2. Elige **Antigravity**.
3. OpenCode inicia `agy.exe`, obtiene la URL OAuth de Google y la abre en el navegador.
4. Tras iniciar sesión, el usuario pega el código OAuth de retorno en el cuadro de OpenCode.
5. `agy.exe` conserva su propia sesión autenticada localmente.
6. Al elegir el modelo, OpenCode ejecuta `agy.exe` por debajo y muestra la respuesta como cualquier otro provider.

Modelo expuesto (una sola entrada en el selector; el esfuerzo se cambia con “switch variant”):

| Identificador de `agy` | Nombre en OpenCode | Contexto | Variantes |
| --- | --- | ---: | --- |
| `gemini-3.8-flash-<low\|medium\|high>` | Gemini 3.8 Flash | 1,000,000 tokens | `low`, `medium`, `high` |

El selector muestra **un único modelo** `gemini-3.8-flash` (“Gemini 3.8 Flash”). Las variantes `low`/`medium`/`high` se cambian con el comando de variante (en la app, Ctrl+P → “switch model variant”), y por debajo el adaptador deriva el identificador real del CLI como `<id>-<effort>` con `--effort` equivalente.

## Estado actual

La integración está implementada y la ruta de respuesta fue comprobada localmente con peticiones mínimas (modelo base + variantes, con y sin `providerOptions`): el adaptador de OpenCode obtuvo respuestas desde `agy.exe` y el streaming incremental (`text-delta`) fluye del CLI al `fullStream` del AI SDK.

También pasaron:

```powershell
C:\Users\akong\.bun\bin\bun.exe run --cwd packages/core typecheck
C:\Users\akong\.bun\bin\bun.exe run --cwd packages/opencode typecheck
```

No hay commit creado todavía. Los archivos nuevos aparecen como *untracked* hasta que se añadan a Git.

## Cómo iniciar este fork

En PowerShell:

```powershell
cd C:\Users\akong\OneDrive\Escritorio\trabajos\opencode-fork\opencode
C:\Users\akong\.bun\bin\bun.exe run dev
```

Si ya había un `bun run dev` ejecutándose, detenerlo con `Ctrl+C` y arrancarlo de nuevo. Una instalación global de OpenCode no incluye automáticamente estos cambios: hay que usar este comando desde el fork.

Requisitos locales:

- `agy.exe` debe estar en `PATH`.
- Bun está disponible en `C:\Users\akong\.bun\bin\bun.exe` aunque no necesariamente en el `PATH` de todas las terminales.
- El usuario debe completar OAuth desde `/connect` al menos una vez para que `agy` guarde su autenticación.

## Archivos modificados o creados

### Adaptador de CLI y OAuth

- `packages/core/src/antigravity.ts` **(nuevo)**
  - Ejecuta `agy.exe` en Windows (`agy` en otros sistemas).
  - Ejecuta el modelo derivando el identificador real como `<id>-<effort>`: el `effort` se resuelve en este orden: `providerOptions.antigravity.effort` (variante V1) → `options.effort` (settings del catálogo V2) → sufijo del ID (modelos antiguos) → `low`. Un ID ya sufijado (p. ej. `gemini-3.8-flash-high`) se usa tal cual.
  - Envía cada turno con el formato requerido por `agy`:

    ```json
    {"event":"user","message":{"content":"texto del prompt"}}
    ```

  - Lee eventos `init`, `step_update` y `result`. Cada `step_update.state=ACTIVE` trae `step_update.text_delta` incremental: se emite uno a uno como `text-delta` del AI SDK, de modo que la respuesta se transmite en streaming. El `result.response` solo se usa como respaldo final. En respuestas cortas, tras el silencio inicial el CLI vuelca todo en 1–3 chunks (200ms-1.6s de separación), por lo que visualmente “aparece de una”; en respuestas largas se ve escribir frase a frase.
  - Como `agy` guarda silencio durante la fase de razonamiento (la primera `text_delta` tarda ~5-7s en llegar), el adaptador emite un bloque `reasoning-start`/`reasoning-end` vacío (solo `providerMetadata`) para que la TUI muestre el indicador **“Thinking…”** mientras piensa. No se fabrica texto de razonamiento; el bloque queda como “Thought” opaco al finalizar.
  - Extrae `input_tokens`, `output_tokens`, `thinking_tokens` y `cache_read_tokens` y los coloca en el uso de AI SDK/OpenCode (`outputTokens.reasoning` recibe `thinking_tokens`).
  - Implementa `beginOAuth()`: usa un PTY y `agy --output-format stream-json --print=/model`, detecta la URL OAuth y entrega el código que el usuario pega al proceso.

### Provider de Core (V2)

- `packages/core/src/plugin/provider/antigravity.ts` **(nuevo)**
  - Registra la integración OAuth, el provider y **un único modelo** `gemini-3.8-flash` con sus tres variantes `low`/`medium`/`high` (cada una fija el `body.effort` del SDK).
  - Declara 1M de contexto, salida máxima de 65,536 tokens y el precio publicado por el CLI: `$0.75` entrada / `$3.75` salida por millón (50% fuera del $1.50/$7.50 de Google).
  - Crea el modelo AI SDK mediante el adaptador anterior.
- `packages/core/src/plugin/provider.ts`
  - Registra `AntigravityPlugin` entre los providers integrados.

### Compatibilidad con servidor/TUI actual de OpenCode

- `packages/opencode/src/plugin/antigravity.ts` **(nuevo)**
  - Expone el método OAuth para el flujo de conexión de OpenCode.
- `packages/opencode/src/plugin/index.ts`
  - Registra ese plugin de autenticación.
- `packages/opencode/src/provider/provider.ts`
  - Declara el paquete virtual `opencode-antigravity` y su cargador.
  - Añade Antigravity al catálogo de providers para que sea seleccionable.
- `packages/tui/src/component/dialog-provider.tsx`
  - Abre automáticamente la URL OAuth de Antigravity en el navegador.
- `packages/app/src/components/dialog-connect-provider.tsx`
  - Hace lo mismo para la app gráfica.
- `packages/opencode/src/session/session.ts`
  - Reconoce un coste numérico que Antigravity pueda devolver en sus metadatos.

## Diagnóstico ya resuelto

El error que aparecía al enviar “hola” era `agy exited with code 1`. Tenía dos causas:

1. Se enviaba `gemini-3.8-flash`, pero `agy models` muestra que el modelo existente se llama `gemini-3.8-flash-high`.
2. El adaptador enviaba `{"prompt":"..."}` al modo `stream-json`. El CLI responde que falta `event`. La estructura válida fue verificada directamente con `agy` y es `{"event":"user","message":{"content":"..."}}`.

El diálogo `/usage` tenía un bloqueo independiente: su proceso `agy --print /usage` se lanzaba con stdin abierto y podía quedar esperando EOF. `runAgy()` ahora ejecuta la consulta con stdin ignorado; la consulta JSON devuelve los grupos de cuota y el diálogo deja de quedarse en `Fetching usage…`.

Antes de cualquier cambio futuro, comprobar los modelos reales con:

```powershell
agy.exe models
```

## Tokens y precio

Los tokens sí se registran desde la salida real del CLI, incluyendo lectura de caché y razonamiento. El coste monetario del modelo usa el precio publicado por Antigravity para Gemini 3.8 Flash: `$0.75` / `$3.75` por millón de tokens (salida/entrada), 50% sobre el precio de Google (`$1.50` / `$7.50`). Es una estimación local a tasa del modelo, no una factura del proveedor.

## Límites conocidos y próximas tareas sugeridas

1. **Herramientas**: el provider se marca sin herramientas (`toolCall: false`). `agy` tiene sus propias herramientas de agente, pero OpenCode no traduce aún sus tool calls hacia/desde el protocolo de OpenCode. Mantenerlo así evita ejecuciones duplicadas o permisos inconsistentes.
2. **Thinking**: `agy` no expone el texto de razonamiento interno — solo el contador `thinking_tokens` en `usage`. Se reporta como `outputTokens.reasoning` y, mientras la primera `text_delta` tarda en llegar, se muestra un indicador “Thinking…” sintético (bloque `reasoning-start`/`reasoning-end` vacío). No existe texto de pensamiento real que mostrar (no hay flag `--verbose` ni eventos de razonamiento). Si Antigravity publica el pensamiento en `step_update`, el adaptador deberá convertir sus deltas en `reasoning-delta` reales.
3. **Conversación persistente**: cada llamada de OpenCode inicia un proceso de `agy` y una conversación nueva. Para una implementación más profunda, mantener un proceso por sesión y mandar varios mensajes NDJSON sin cerrar stdin; habría que diseñar cancelación, memoria y limpieza de procesos.
4. **Multimodalidad**: actualmente se convierte el prompt de OpenCode a texto. Adjuntos, imágenes y tool results complejos aún no se traducen de forma nativa.
5. **Coste monetario**: registrado como precio de catálogo (`$0.75`/`$3.75` por millón). Si `agy` empieza a devolver `cost` real en sus eventos, el adaptador lo sobreescribirá con el valor facturado.
6. **Prueba manual completa**: hacer `/connect` desde la instancia local, completar OAuth, seleccionar Antigravity (el único modelo “Gemini 3.8 Flash”), probar el cambio de variante (Ctrl+P → “switch model variant”) y confirmar que el panel muestra el indicador “Thinking…” mientras piensa y luego texto en streaming y uso de tokens.
7. **Pruebas automatizadas**: conviene añadir tests unitarios del parser de eventos `stream-json` usando fixtures (sin invocar el binario ni gastar cuota).
8. **Provider V1/V2**: esta rama mezcla rutas nuevas V2 y rutas de compatibilidad de TUI/servidor. Si OpenCode migra completamente a V2, se podrá simplificar la capa `packages/opencode/src/plugin/antigravity.ts`.

## Comandos útiles de diagnóstico

Listar modelos autenticados:

```powershell
agy.exe models
```

Probar el CLI directamente sin modificar archivos:

```powershell
agy.exe --output-format stream-json --model gemini-3.8-flash-high --effort high --print="Responde exactamente: OK"
```

Probar el protocolo de entrada streaming:

```powershell
'{"event":"user","message":{"content":"Responde exactamente: OK"}}' |
  agy.exe --input-format stream-json --output-format stream-json --model gemini-3.8-flash-high --effort high --print=
```

Revisar el log local de OpenCode en caso de error:

```powershell
Get-Content "$env:USERPROFILE\.local\share\opencode\log\opencode.log" -Tail 200
```

No compartir códigos OAuth, cookies, tokens ni el contenido completo del log si contiene credenciales.

## Instrucción breve para el próximo agente

> Continúa el fork `C:\Users\akong\OneDrive\Escritorio\trabajos\opencode-fork\opencode`. Lee primero `README-ANTIGRAVITY-HANDOFF.md`. El provider Antigravity debe invocar `agy.exe`, no HTTP. Conserva el modelo único `gemini-3.8-flash` con sus variantes `low`/`medium`/`high` (que derivan el id del CLI como `<id>-<effort>`), el contexto de 1M, el precio `$0.75`/`$3.75` por millón, el flujo OAuth de pegado de código y el protocolo NDJSON `event=user/message.content`. Antes de editar, reproduce el problema y revisa los logs sin exponer secretos.
