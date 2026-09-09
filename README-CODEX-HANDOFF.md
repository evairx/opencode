# Handoff: fork OpenCode + provider Codex (ChatGPT)

Este documento permite continuar el trabajo en otra sesión o con otro agente.

## Objetivo del fork

Este fork añade **Codex (ChatGPT)** como un provider nativo de OpenCode, separado del provider `openai`. El transporte y la identidad están portados de **OpenClaude** (`@gitlawb/openclaude`) adaptados al esqueleto de providers de este fork (mismo patrón que `Antigravity`/`CommandCode`), reutilizando el flujo OAuth de Codex que ya traía upstream.

No ejecuta el CLI `codex` ni la app de ChatGPT: es **HTTP puro** contra `https://chatgpt.com/backend-api/codex/responses` con las credenciales del OAuth oficial del Codex CLI.

Flujo esperado:

1. `/connect` → **Codex** → elegir *Sign in with ChatGPT* (abre el navegador) o *Enter a code from ChatGPT* (código para entornos sin navegador/SSH).
2. Se abre `auth.openai.com` presentándose como el **Codex CLI oficial** (`originator=codex_cli_rs`, `codex_cli_simplified_flow=true`, scopes con connectors, client_id `app_EMoamEEZ73f0CkXaXp7hrann`).
3. OpenCode guarda el token OAuth en `auth.json` bajo `codex`.
4. Cada turno usa `@ai-sdk/openai` (Responses) contra el backend de Codex con `Authorization: Bearer`, `chatgpt-account-id`, residencia condicional, y limpieza del header `authorization` del SDK antes de reinyectarlo (portado de OpenClaude).
5. `/usage` (Ctrl+P) reutiliza el **mismo popup de Antigravity**, mostrando cuotas del plan desde `chatgpt.com/backend-api/wham/usage`.

## Archivos modificados o creados

### Núcleo compartido

- `packages/core/src/codex.ts` **(nuevo)**
  - Constantes de identidad (issuer, client_id, puerto 1455, scopes, originator, endpoint, WHAM).
  - JWT: `parseCodexJwt`, `extractCodexAccountId`, `extractCodexResidency`.
  - PKCE + OAuth: `buildCodexAuthorizeUrl`, `exchangeCodexCodeForTokens`, `refreshCodexTokens`, `exchangeCodexIdTokenForApiKey` (token-exchange `id_token → openai-api-key` del Codex CLI, hoy no persistido).
  - Interop: `readCodexAuthJson()` lee `~/.codex/auth.json` del `codex login` oficial; `readStoredCodexAuth` lee la sesión guardada por OpenCode.
  - Catálogo `CODEX_MODELS`: `gpt-6-astra` (**GPT 6 Astra** $10/$50), `gpt-5.6-sol` (**GPT 5.6 Sol** $4/$20), `gpt-5.6-terra` (**GPT 5.6 Terra** $2/$12), `gpt-5.6-luna` (**GPT 5.6 Luna** $0.20/$1.20), `gpt-5.5` (**GPT 5.5** $5/$30), `gpt-5.3-codex-spark` (**GPT 5.3 Codex Spark** $1.75/$14, sin variantes). Todos con contexto 400k y precio input/output por 1M tokens (estimación de coste local; `/usage` muestra además cuotas WHAM del plan).
  - Uso: `getCodexUsage(force)` + `normalizeCodexUsagePayload` → normaliza WHAM al mismo shape `AgyUsageGroup`/`AgyUsageBucket` de Antigravity. Memo 60s + coalescing.

### Provider V2 (core)

- `packages/core/src/plugin/provider/codex.ts` **(nuevo)**
  - Dos métodos OAuth ("Sign in with ChatGPT" y "Enter a code from ChatGPT") registrados en la integración `codex`.
  - Catálogo con los modelos `CODEX_MODELS` (package `@ai-sdk/openai`, url `CODEX_BASE_URL`) y hook de lenguaje `responses`.
- `packages/core/src/plugin/provider.ts`
  - Registra `CodexPlugin` en `ProviderPlugins`.

### Provider V1 (runtime real de la TUI/servidor)

- `packages/opencode/src/plugin/codex.ts` **(nuevo)**
  - `CodexProviderAuthPlugin`: `auth.provider = "codex"`, loader con fetch que refresca el token y reinyecta `Bearer`, `chatgpt-account-id`, `originator`, UA y `x-openai-internal-codex-residency`; reescribe `/v1/responses`, `/responses` y `/chat/completions` a `CODEX_API_ENDPOINT`.
  - Métodos: *Sign in with ChatGPT* (servidor local puerto 1455 con fallback a puerto efímero si el plugin OpenAI ya lo ocupa), *Enter a code from ChatGPT* (device flow) y *Paste an API key*.
  - `chat.params` limpia `maxOutputTokens` para Codex (igual que el CLI).
- `packages/opencode/src/plugin/index.ts`
  - Registra `CodexProviderAuthPlugin` en `internalPlugins`.
- `packages/opencode/src/provider/provider.ts`
  - Loader `custom(dep).codex` (`autoload: true`, `getModel → sdk.responses`, `baseURL` de Codex), builder `codexProvider(): Info` y merge en el catálogo.
- `packages/opencode/src/session/session.ts`
  - Override de coste por `metadata.codex.cost` (igual que Antigravity).

### UI

- `packages/tui/src/component/dialog-usage.tsx`
  - Generalizado: `groupNameFor`/`providerName` por provider; `fetchUsage` despacha `getCodexUsage` cuando el modelo es `codex`. El popup es el mismo de Antigravity.
- `packages/tui/src/app.tsx`
  - Comando de paleta `usage.model` (antes `antigravity.usage`) habilitado para `antigravity` y `codex`.
- `packages/tui/src/component/dialog-provider.tsx`
  - `AutoMethod` abre el navegador automáticamente cuando `providerID === "codex"`.
- `packages/app/src/components/dialog-connect-provider.tsx`
  - `OAuthAutoView` abre el navegador automáticamente para `codex`.

## Tests

- `packages/core/test/codex.test.ts` — JWT/account-id/residency y normalización WHAM→grupos.
- `packages/core/test/plugin/provider-codex.test.ts` — registro en `ProviderPlugins`.

Ejecutar desde `packages/core`:

```powershell
bun test test/codex.test.ts test/plugin/provider-codex.test.ts
```

## Verificación

Typechecks:

```powershell
bun run --cwd packages/core typecheck
bun run --cwd packages/opencode typecheck
bun run --cwd packages/tui typecheck
```

> Nota: `packages/app` typecheck falla por un error **preexistente** en `src/custom-elements.d.ts` (TS1128), ajeno a este cambio.

Prueba manual (con cuenta ChatGPT Plus):

1. `bun run dev` desde `packages/opencode`.
2. `/connect` → Codex → *Sign in with ChatGPT* (o *Enter a code from ChatGPT* ingresando el código en `https://auth.openai.com/codex/device`).
3. Elegir `GPT 5.6 Sol` (o `GPT 5.6 Terra`) y cambiar la variante de reasoning con Ctrl+P → “switch model variant” cuando aplique; `GPT 5.3 Codex Spark` no expone variantes.
4. Confirmar streaming, uso de tokens y que `/usage` muestra cuotas del plan.
5. Modelos no disponibles en tu plan fallan con error del backend → ajustar `CODEX_MODELS` si hace falta.

Diagnóstico rápido:

```powershell
Get-Content "$env:USERPROFILE\.local\share\opencode\log\opencode.log" -Tail 200
```

## Anti-baneo (lo que sí hace y lo que no)

- **Sí**: se presenta como el Codex CLI oficial en OAuth; usa credenciales oficiales; no filtra headers de Anthropic/otros; body estable; refresh single-flight; respeta el patrón del endpoint oficial.
- **No**: no rota user-agents, no genera device-ids, no hace pool de cuentas ni evasión agresiva. Uso fuera del CLI oficial es zona gris ToS: riesgo no nulo (igual que el flujo ChatGPT Pro/Plus que ya trae upstream bajo `openai`).
- Opcional pendiente: espejar exactamente los headers que manda el CLI real capturando una petición con un proxy de depuración (`originator`/UA), y persistir el `openai-api-key` del token-exchange de OpenClaude.

## Instrucción breve para el próximo agente

> El provider Codex debe hablar HTTP directo a `chatgpt.com/backend-api/codex/responses` con el OAuth del Codex CLI oficial (client_id `app_EMoamEEZ73f0CkXaXp7hrann`, `originator=codex_cli_rs`), no ejecutar binarios. Conserva `CODEX_MODELS`, la identidad de headers, el interop con `~/.codex/auth.json`, la reutilización del popup `DialogUsage` para `/usage` y los typechecks de `core`/`opencode`/`tui`.
