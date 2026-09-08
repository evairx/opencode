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

Modelos expuestos (las variantes de razonamiento se cambian con “switch variant” cuando aplica):

| Identificador de `agy` | Nombre en OpenCode | Contexto | Variantes |
| --- | --- | ---: | --- |
| `gemini-3.8-flash-<low\|medium\|high>` | Gemini 3.8 Flash | 1,000,000 tokens | `low`, `medium`, `high` |
| `gemini-3.7-flash-<low\|medium\|high>` | Gemini 3.7 Flash | 1,000,000 tokens | `low`, `medium`, `high` |
| `gemini-3.6-flash-<low\|medium\|high>` | Gemini 3.6 Flash | 1,000,000 tokens | `low`, `medium`, `high` |
| `gemini-3.1-pro-<low\|high>` | Gemini 3.1 Pro | 1,000,000 tokens | `low`, `high` |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 250,000 tokens | — |
| `claude-opus-4-6-thinking` | Claude Opus 4.6 | 250,000 tokens | — |
| `gpt-oss-120b-medium` | GPT-OSS 120B | 131,072 tokens | `medium` |

Los modelos Gemini se muestran con su ID base y las variantes `low`/`medium`/`high` se cambian con el comando de variante (en la app, Ctrl+P → “switch model variant”); por debajo el adaptador deriva el identificador real del CLI como `<id>-<effort>`. Claude usa los IDs exactos sin añadir `--effort`; GPT-OSS usa el ID concreto `gpt-oss-120b-medium`.

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
  - Registra la integración OAuth, el provider y los modelos Gemini, Claude y GPT-OSS con los IDs que entiende `agy`.
  - Declara 1M de contexto para todos los Gemini, 250k para Claude y 131,072 para GPT-OSS; la salida máxima del catálogo es 65,536 tokens.
  - Declara el precio por millón: Gemini Flash `$0.75`/`$3.75`; Gemini Pro `$2`/`$12` hasta 200k y `$4`/`$18` por encima; Sonnet `$3`/`$15`; Opus `$5`/`$25`; GPT-OSS `$0.15`/`$0.60`.
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

Los tokens se registran desde la salida real del CLI, incluyendo lectura de caché y razonamiento. OpenCode calcula el coste local a partir de la tarifa del modelo y selecciona automáticamente la tarifa de Gemini Pro cuando el contexto supera 200.000 tokens. Las tarifas de caché quedan en cero porque `agy` no entrega una tarifa separada; si el CLI empieza a informar `cost`, ese importe real tiene prioridad. Es una estimación local, no una factura del proveedor.

## Conversación y contexto

La continuidad actual la administra **OpenCode**, no una conversación persistente de `agy`:

1. OpenCode guarda los mensajes y sus partes en su propia sesión/base de datos.
2. En cada turno, el AI SDK prepara el contexto completo disponible (sistema, mensajes anteriores y el mensaje nuevo), aplicando compaction cuando alcanza el límite del modelo.
3. `packages/core/src/antigravity.ts` inicia un proceso nuevo de `agy.exe` para ese turno, no usa `--continue` ni `--conversation`, y envía ese contexto como un único evento NDJSON `event=user`.
4. Cuando termina la respuesta, el proceso de `agy` finaliza. En el siguiente turno se vuelve a crear otro proceso y OpenCode reenvía el historial preparado.

Por tanto, `agy` no conserva aquí una conversación propia entre turnos; sí conserva el contexto que recibe durante cada ejecución, mientras OpenCode conserva el historial y decide cuánto reenviar. Mantener un proceso persistente de `agy` o usar `--conversation` sería una mejora aparte y requeriría asociar y limpiar una sesión de CLI por cada sesión/modelo de OpenCode.

## Límites conocidos y próximas tareas sugeridas

1. **Herramientas**: el provider se marca sin herramientas (`toolCall: false`). `agy` tiene sus propias herramientas de agente, pero OpenCode no traduce aún sus tool calls hacia/desde el protocolo de OpenCode. Mantenerlo así evita ejecuciones duplicadas o permisos inconsistentes.
2. **Thinking**: `agy` no expone el texto de razonamiento interno — solo el contador `thinking_tokens` en `usage`. Se reporta como `outputTokens.reasoning` y, mientras la primera `text_delta` tarda en llegar, se muestra un indicador “Thinking…” sintético (bloque `reasoning-start`/`reasoning-end` vacío). No existe texto de pensamiento real que mostrar (no hay flag `--verbose` ni eventos de razonamiento). Si Antigravity publica el pensamiento en `step_update`, el adaptador deberá convertir sus deltas en `reasoning-delta` reales.
3. **Conversación persistente**: cada llamada de OpenCode inicia un proceso de `agy` y una conversación nueva. Para una implementación más profunda, mantener un proceso por sesión y mandar varios mensajes NDJSON sin cerrar stdin; habría que diseñar cancelación, memoria y limpieza de procesos.
4. **Multimodalidad**: actualmente se convierte el prompt de OpenCode a texto. Adjuntos, imágenes y tool results complejos aún no se traducen de forma nativa.
5. **Coste monetario**: se calcula desde el catálogo por modelo y por contexto; si `agy` empieza a devolver `cost` real en sus eventos, el adaptador lo sobreescribirá con el valor facturado.
6. **Prueba manual completa**: hacer `/connect` desde la instancia local, completar OAuth, seleccionar cualquier modelo Antigravity, probar el cambio de variante (Ctrl+P → “switch model variant”) y confirmar que el panel muestra el indicador “Thinking…” mientras piensa y luego texto en streaming y uso de tokens.
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

> Continúa el fork `C:\Users\akong\OneDrive\Escritorio\trabajos\opencode-fork\opencode`. Lee primero `README-ANTIGRAVITY-HANDOFF.md`. El provider Antigravity debe invocar `agy.exe`, no HTTP. Conserva los IDs reales de Gemini, Claude y GPT-OSS, los límites por modelo (Gemini 1M, Claude 250k, GPT-OSS 131,072), el cálculo local de precios por modelo/contexto, el flujo OAuth de pegado de código y el protocolo NDJSON `event=user/message.content`. Antes de editar, reproduce el problema y revisa los logs sin exponer secretos.
