/**
 * OpenCode - Claude (Anthropic) Pricing Scraper & Model Catalog
 *
 * Scraper especializado para obtener y procesar los precios y modelos de Claude (Anthropic)
 * desde la documentación oficial de pricing:
 *   URL: https://platform.claude.com/docs/en/about-claude/pricing
 *
 * Contenedor principal:
 *   <div data-cds="Prose" data-prose-font="sans" data-prose-heading-font="serif" data-prose-spacing="lg" data-size="sm" class="prose docs-prose">
 *
 * Estructura de la tabla de precios:
 *   - Model (Name & Description)
 *   - Base tokens: Input | Output
 *   - Prompt caching: 5m writes | 1h writes | Hits and refreshes (Cache read)
 *
 * Modelos soportados:
 *   - Claude Fable 5.1
 *   - Claude Opus 5.5
 *   - Claude Sonnet 5.5
 *   - Claude Haiku 4.5
 *   - Claude Mythos 5.1
 *   - Claude Fable 5
 *   - Claude Mythos 5
 *   - Claude Opus 5
 *   - Claude Opus 4.8
 *   - Claude Opus 4.7
 *   - Claude Opus 4.6
 *   - Claude Opus 4.5
 *   - Claude Opus 4.1
 *   - Claude Opus 4
 *   - Claude Sonnet 5
 *   - Claude Sonnet 4.6
 *   - Claude Sonnet 4.5
 *   - Claude Sonnet 4
 *   - Claude Haiku 3.5
 *
 * Uso:
 *   bun index.js            # Muestra la tabla completa en consola con precios y caché
 *   bun index.js --json     # Exporta los modelos en formato JSON
 *   bun index.js --claude   # Genera el array TypeScript compatible con ClaudeModel[]
 */

export const TARGET_URL = "https://platform.claude.com/docs/en/about-claude/pricing";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

/**
 * Realiza la petición HTTP con timeout
 */
export async function fetchClaudePricingHtml(timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(TARGET_URL, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} al consultar ${TARGET_URL}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convierte el nombre visible de Claude en un slug ID canónico
 * ej: "Claude Opus 5.5" -> "claude-opus-5-5"
 *     "Claude Sonnet 4.6" -> "claude-sonnet-4-6"
 */
export function modelNameToId(name) {
  return name
    .toLowerCase()
    .replace(/\./g, "-")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Extrae y parsea los modelos y precios de Claude desde el HTML oficial
 */
export function parseClaudePricingHtml(html) {
  // 1. Localizar el contenedor <div data-cds="Prose"...> solicitado por el usuario
  let proseBlock = html;
  const proseMatch = html.match(/<div[^>]*data-cds="Prose"[^>]*>([\s\S]*?)<\/div>/i);
  if (proseMatch) {
    proseBlock = proseMatch[0];
  }

  // 2. Extraer la primera tabla dentro del contenedor o del documento
  const tableMatch = proseBlock.match(/<table[\s\S]*?<\/table>/i) || html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error("No se encontró la tabla de precios en la página de Claude.");
  }

  const tableHtml = tableMatch[0];
  const rows = [...tableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  const models = [];

  const parseNumber = (val) => {
    if (typeof val === "number") return val;
    if (!val || val === "-" || val === "—") return 0;
    const clean = String(val).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim();
    const match = clean.match(/\$([0-9.]+)/);
    return match ? parseFloat(match[1]) : 0;
  };

  for (const rowMatch of rows) {
    const row = rowMatch[0];
    const cells = [...row.matchAll(/<td[\s\S]*?<\/td>/gi)].map((c) => c[0]);

    // La tabla de precios estándar de Claude tiene 6 columnas:
    // [0] Model Name, [1] Input, [2] Output, [3] 5m Cache Write, [4] 1h Cache Write, [5] Cache Read
    if (cells.length < 6) continue;

    // Extraer nombre del modelo (preferir enlace o texto resaltado)
    let rawName = "";
    const linkMatch = cells[0].match(/<a[^>]*>([^<]+)<\/a>/i);
    const boldMatch = cells[0].match(/class="[^"]*font-medium[^"]*"[^>]*>([^<]+)</i);

    if (linkMatch) {
      rawName = linkMatch[1];
    } else if (boldMatch) {
      rawName = boldMatch[1];
    } else {
      const text = cells[0].replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      rawName = text.split("For ")[0].trim();
    }

    // Limpiar caracteres unicode privados de iconos como  o 
    const cleanName = rawName.replace(/[\uE000-\uF8FF]/g, "").trim();
    if (!cleanName || !cleanName.toLowerCase().includes("claude")) continue;

    const id = modelNameToId(cleanName);

    // Filtro: solo los modelos del plan Claude que deben aparecer en OpenCode
    const ALLOWED_MODELS = new Set([
      "claude-sonnet-4-6", "claude-sonnet-5", "claude-sonnet-5-5",
      "claude-fable-5", "claude-fable-5-1",
      "claude-opus-4-6", "claude-opus-4-7", "claude-opus-4-8", "claude-opus-5", "claude-opus-5-5",
      "claude-haiku-4-5",
    ]);
    if (!ALLOWED_MODELS.has(id)) continue;
    const inputPrice = parseNumber(cells[1]);
    const outputPrice = parseNumber(cells[2]);
    const cache5m = parseNumber(cells[3]);
    const cache1h = parseNumber(cells[4]);
    const cacheRead = parseNumber(cells[5]);

    // Extraer descripción opcional del modelo
    const descMatch = cells[0].match(/<span[^>]*class="[^"]*text-secondary[^"]*"[^>]*>([^<]+)<\/span>/i);
    const description = descMatch ? descMatch[1].trim() : undefined;

    models.push({
      id,
      name: cleanName,
      family: "claude",
      description,
      context: 200_000,
      input: 200_000,
      output: 64_000,
      price: {
        input: inputPrice,
        output: outputPrice,
        cache: {
          read: cacheRead,
          write: cache5m, // 5m standard cache write
          write1h: cache1h, // 1h extended cache write
        },
      },
      variants: ["low", "medium", "high", "xhigh", "max"],
    });
  }

  return models;
}

/**
 * Consulta la web y devuelve los modelos de Claude con precios actualizados
 */
export async function scrapeClaudePricing() {
  const html = await fetchClaudePricingHtml();
  return parseClaudePricingHtml(html);
}

/**
 * Genera el código TypeScript para packages/core/src/claude.ts
 */
export function generateClaudeTypeScript(models) {
  const formatted = models.map((m) => ({
    id: m.id,
    name: m.name,
    family: m.family,
    context: m.context,
    input: m.input,
    output: m.output,
    price: {
      input: m.price.input,
      output: m.price.output,
      cache: {
        read: m.price.cache.read,
        write: m.price.cache.write,
      },
    },
    variants: m.variants,
  }));

  return `// Modelos Claude actualizados automáticamente desde ${TARGET_URL}\nexport const CLAUDE_MODELS: ClaudeModel[] = ${JSON.stringify(formatted, null, 2)}\n`;
}

// ==========================================
// CLI Execution
// ==========================================
async function main() {
  const args = process.argv.slice(2);
  const isJson = args.includes("--json");
  const isClaude = args.includes("--claude");

  if (!isJson && !isClaude) {
    console.log("==================================================================");
    console.log("   OpenCode - Claude (Anthropic) Pricing Web Scraper");
    console.log("==================================================================");
    console.log(`Consultando: ${TARGET_URL}...`);
  }

  const models = await scrapeClaudePricing();

  if (isJson) {
    console.log(JSON.stringify(models, null, 2));
    return;
  }

  if (isClaude) {
    console.log(generateClaudeTypeScript(models));
    return;
  }

  console.log(`\nModelos Claude encontrados en la documentación oficial: ${models.length}\n`);

  console.table(
    models.map((m) => ({
      Model: m.name,
      ID: m.id,
      "Input / MTok": `$${m.price.input.toFixed(2)}`,
      "Output / MTok": `$${m.price.output.toFixed(2)}`,
      "5m Cache Write": `$${m.price.cache.write.toFixed(2)}`,
      "1h Cache Write": `$${m.price.cache.write1h.toFixed(2)}`,
      "Cache Read": `$${m.price.cache.read.toFixed(2)}`,
    }))
  );

  console.log("\nOpciones disponibles:");
  console.log("  bun index.js          # Ver la tabla en consola con precios y caché");
  console.log("  bun index.js --json   # Exportar datos completos en JSON");
  console.log("  bun index.js --claude # Generar estructura TypeScript para CLAUDE_MODELS");
}

if (import.meta.main || process.argv[1]?.endsWith("index.js")) {
  main().catch((err) => {
    console.error("Error en index.js:", err);
    process.exit(1);
  });
}
