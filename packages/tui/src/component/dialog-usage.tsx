import {
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js"

import { TextAttributes } from "@opentui/core"

import {
  getAgyUsage,
  type AgyUsageBucket,
  type AgyUsageGroup,
} from "@opencode-ai/core/antigravity"
import { getCodexUsage } from "@opencode-ai/core/codex"

import { useLocal } from "../context/local"
import { useSync } from "../context/sync"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { AntigravityConnect } from "./dialog-provider"


// ============================================================
// Antigravity auth detection
// ============================================================

const ANTIGRAVITY_AUTH_REQUIRED_RE =
  /(authentication required|authorization required|please visit the url to log in|accounts\.google\.com)/i

function isAntigravityAuthRequired(
  message: string,
): boolean {
  return ANTIGRAVITY_AUTH_REQUIRED_RE.test(
    message,
  )
}


// ============================================================
// Design
// ============================================================

const USAGE_COLORS = {
  background: "#111111",

  title: "#b080ff",

  fill: "#ffb486",
  track: "#5b5b5d",

  percentage: "#f5f5f5",

  text: "#ededed",
  muted: "#777777",

  skeleton: "#1c1c1e",
  skeletonSoft: "#242426",
  skeletonMedium: "#2b2b2e",
  skeletonBright: "#36363a",
} as const


// Repetimos suficientes caracteres para llenar cualquier barra.
// El contenedor hace clipping con overflow="hidden".
const THIN_BAR =
  "▀".repeat(256)

const SKELETON_SEGMENTS = 12


// ============================================================
// Helpers
// ============================================================

function percentWidth(
  value: number,
): `${number}%` {
  return `${value}%`
}


function groupNameFor(
  providerID: string | undefined,
  modelID: string,
): string {
  if (providerID === "codex") {
    return "Codex"
  }

  return modelID.startsWith("gemini")
    ? "Gemini Models"
    : "Claude and GPT models"
}


function providerName(
  providerID: string | undefined,
): string {
  if (providerID === "codex") {
    return "Codex"
  }

  return "Antigravity"
}


function formatReset(
  resetTime: string | undefined,
): string | undefined {
  const at = resetTime
    ? Date.parse(resetTime)
    : NaN

  if (Number.isNaN(at)) {
    return undefined
  }

  const minutes = Math.ceil(
    (at - Date.now()) / 60_000,
  )

  if (minutes < 60) {
    return `in ${Math.max(minutes, 1)}m`
  }

  if (minutes < 48 * 60) {
    return `in ${Math.ceil(minutes / 60)}h`
  }

  return `in ${Math.ceil(
    minutes / (24 * 60),
  )}d`
}


function getBucketLabel(
  bucket: AgyUsageBucket,
): string {
  const name =
    bucket.name.toLowerCase()

  if (
    bucket.window === "5h" ||
    name.startsWith("five")
  ) {
    return "5h Limit Remaining"
  }

  if (
    bucket.window === "weekly" ||
    name.startsWith("weekly")
  ) {
    return "Weekly Limit Remaining"
  }

  return bucket.name
}


// ============================================================
// Thin responsive progress bar
// ============================================================

function ThinProgressBar(
  props: {
    fraction: number
  },
) {
  const fraction = Math.min(
    1,
    Math.max(0, props.fraction),
  )

  const filledPercent =
    Math.round(fraction * 100)

  const remainingPercent =
    100 - filledPercent

  return (
    <box
      flexDirection="row"
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
      height={1}
      overflow="hidden"
    >
      {/* Filled */}
      <Show when={filledPercent > 0}>
        <box
          width={percentWidth(
            filledPercent,
          )}
          height={1}
          flexShrink={0}
          minWidth={0}
          overflow="hidden"
        >
          <text fg={USAGE_COLORS.fill}>
            {THIN_BAR}
          </text>
        </box>
      </Show>

      {/* Remaining */}
      <Show when={remainingPercent > 0}>
        <box
          width={percentWidth(
            remainingPercent,
          )}
          height={1}
          flexShrink={0}
          minWidth={0}
          overflow="hidden"
        >
          <text fg={USAGE_COLORS.track}>
            {THIN_BAR}
          </text>
        </box>
      </Show>
    </box>
  )
}


// ============================================================
// Usage bucket
// ============================================================

function Bucket(
  props: {
    bucket: AgyUsageBucket
  },
) {
  const { theme } = useTheme()

  const fraction = Math.min(
    1,
    Math.max(
      0,
      props.bucket.remaining_fraction,
    ),
  )

  const percent =
    `${Math.round(fraction * 100)}%`

  const refresh =
    formatReset(
      props.bucket.reset_time ??
        undefined,
    )

  const label =
    getBucketLabel(props.bucket)

  return (
    <box
      width="100%"
      flexDirection="column"
      gap={0}
    >

      {/* ==================================================
          Barra + porcentaje

          Todo el row ocupa 100%.

          La barra crece automáticamente y el porcentaje
          queda siempre alineado al borde derecho.
      ================================================== */}

      <box
        width="100%"
        flexDirection="row"
        alignItems="center"
        gap={2}
        height={1}
      >
        <ThinProgressBar
          fraction={fraction}
        />

        <box
          width={4}
          height={1}
          flexShrink={0}
          alignItems="flex-end"
        >
          <text
            fg={USAGE_COLORS.percentage}
          >
            {percent}
          </text>
        </box>
      </box>


      {/* ==================================================
          Texto

          Como la barra usa "▀", sólo ocupa la mitad
          superior de la celda.

          La mitad inferior queda vacía y genera
          aproximadamente 4-6 px visuales de separación.
      ================================================== */}

      <box
        width="100%"
        flexDirection="row"
        gap={1}
        height={1}
      >
        <text
          fg={theme.text}
          attributes={
            TextAttributes.BOLD
          }
        >
          {label}
        </text>

        <text
          fg={USAGE_COLORS.muted}
        >
          {refresh
            ? `- It is restored ${refresh}`
            : "- Quota available"}
        </text>
      </box>

    </box>
  )
}


// ============================================================
// Skeleton animation
// ============================================================

function getShimmerColor(
  index: number,
  phase: number,
) {
  const distance =
    Math.abs(index - phase)

  if (distance === 0) {
    return USAGE_COLORS.skeletonBright
  }

  if (distance === 1) {
    return USAGE_COLORS.skeletonMedium
  }

  if (distance === 2) {
    return USAGE_COLORS.skeletonSoft
  }

  return USAGE_COLORS.skeleton
}


// ============================================================
// Skeleton text
// ============================================================

function SkeletonText(
  props: {
    width: number
    phase: number
  },
) {
  return (
    <box
      width={props.width}
      height={1}
      flexDirection="row"
      overflow="hidden"
    >
      {Array.from(
        { length: props.width },
        (_, index) => {
          const normalized =
            Math.floor(
              (
                index /
                Math.max(
                  props.width - 1,
                  1,
                )
              ) *
                (SKELETON_SEGMENTS - 1),
            )

          return (
            <text
              fg={getShimmerColor(
                normalized,
                props.phase,
              )}
            >
              █
            </text>
          )
        },
      )}
    </box>
  )
}


// ============================================================
// Skeleton thin progress bar
// ============================================================

function SkeletonProgressBar(
  props: {
    phase: number
  },
) {
  return (
    <box
      flexDirection="row"
      flexGrow={1}
      flexBasis={0}
      minWidth={0}
      height={1}
      overflow="hidden"
    >
      {Array.from(
        {
          length:
            SKELETON_SEGMENTS,
        },
        (_, index) => (
          <box
            flexGrow={1}
            flexBasis={0}
            minWidth={0}
            height={1}
            overflow="hidden"
          >
            <text
              fg={getShimmerColor(
                index,
                props.phase,
              )}
            >
              {THIN_BAR}
            </text>
          </box>
        ),
      )}
    </box>
  )
}


// ============================================================
// Skeleton bucket
// ============================================================

function SkeletonBucket(
  props: {
    phase: number
    descriptionWidth: number
  },
) {
  return (
    <box
      width="100%"
      flexDirection="column"
      gap={0}
    >

      {/* Barra + percentage */}
      <box
        width="100%"
        flexDirection="row"
        alignItems="center"
        gap={2}
        height={1}
      >
        <SkeletonProgressBar
          phase={props.phase}
        />

        <box
          width={4}
          height={1}
          flexShrink={0}
          alignItems="flex-end"
        >
          <SkeletonText
            width={4}
            phase={props.phase}
          />
        </box>
      </box>


      {/* Mismo espacio visual que el texto real */}
      <SkeletonText
        width={props.descriptionWidth}
        phase={props.phase}
      />

    </box>
  )
}


// ============================================================
// Complete skeleton
// ============================================================

function SkeletonUsage(
  props: {
    titleWidth: number
  },
) {
  const [phase, setPhase] =
    createSignal(-3)

  let shimmerTimer:
    | ReturnType<typeof setInterval>
    | undefined


  onMount(() => {
    shimmerTimer =
      setInterval(() => {
        setPhase((current) => {
          const next =
            current + 1

          return next >
            SKELETON_SEGMENTS + 3
            ? -3
            : next
        })
      }, 75)
  })


  onCleanup(() => {
    if (shimmerTimer) {
      clearInterval(
        shimmerTimer,
      )
    }
  })


  return (
    <box
      width="100%"
      flexDirection="column"
      gap={0}
    >

      {/* Group title skeleton */}
      <SkeletonText
        width={props.titleWidth}
        phase={phase()}
      />


      {/* ==================================================
          ~15px:
          Gemini Models Usage -> primera barra
      ================================================== */}

      <box height={1} />


      {/* 5h skeleton */}
      <SkeletonBucket
        phase={phase()}
        descriptionWidth={41}
      />


      {/* Espacio entre buckets */}
      <box height={1} />


      {/* Weekly skeleton */}
      <SkeletonBucket
        phase={phase()}
        descriptionWidth={45}
      />

    </box>
  )
}


// ============================================================
// Dialog
// ============================================================

export function DialogUsage() {
  const { theme } =
    useTheme()

  const local =
    useLocal()

  const dialog =
    useDialog()

  const sync =
    useSync()


  const [loading, setLoading] =
    createSignal(true)

  const [error, setError] =
    createSignal<string>()

  const [group, setGroup] =
    createSignal<AgyUsageGroup>()

  const [elapsed, setElapsed] =
    createSignal(0)


  const model =
    local.model.current()


  let timer:
    | ReturnType<typeof setInterval>
    | undefined


  // ==========================================================
  // Fetch
  // ==========================================================

  const fetchUsage = async (
    force = false,
  ) => {
    setElapsed(0)
    setError(undefined)
    setLoading(true)


    if (timer) {
      clearInterval(timer)
    }


    timer =
      setInterval(() => {
        setElapsed(
          (value) =>
            value + 1,
        )
      }, 1000)


    try {
      const groups =
        model?.providerID === "codex"
          ? await getCodexUsage(force)
          : await getAgyUsage(force)


      const wantedGroup =
        groupNameFor(
          model?.providerID,
          model?.modelID ?? "",
        )


      const found =
        groups.find(
          (item) =>
            item.name ===
            wantedGroup,
        )


      if (!found) {
        setError(
          `No ${providerName(model?.providerID)} usage group for ${model?.modelID}`,
        )

        return
      }


      setGroup(found)
    }
    catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : String(cause)

      // Antigravity's CLI printed a login prompt instead of usage data:
      // stop showing a stuck usage popup and switch to the connect popup.
      // Once connected, the usage popup opens again automatically.
      if (
        model?.providerID === "antigravity" &&
        isAntigravityAuthRequired(message)
      ) {
        dialog.replace(() => (
          <AntigravityConnect
            onConnected={() =>
              dialog.replace(() => <DialogUsage />)
            }
          />
        ))
        return
      }

      setError(message)
    }
    finally {
      if (timer) {
        clearInterval(timer)
        timer = undefined
      }

      setLoading(false)
    }
  }


  // ==========================================================
  // Lifecycle
  // ==========================================================

  onMount(() => {
    dialog.setSizeSmall()

    // Antigravity keeps its session outside opencode (agy keyring). If no
    // credential is saved yet, running the usage CLI would just stall on a
    // login prompt. Go straight to the connect popup instead of a stuck
    // loading dialog, and reopen usage once the login finishes.
    if (
      model?.providerID === "antigravity" &&
      !sync.data.provider_next.connected.includes("antigravity")
    ) {
      dialog.replace(() => (
        <AntigravityConnect
          onConnected={() =>
            dialog.replace(() => <DialogUsage />)
          }
        />
      ))
      return
    }

    void fetchUsage()
  })


  onCleanup(() => {
    if (timer) {
      clearInterval(timer)
    }
  })


  // ==========================================================
  // Bindings
  // ==========================================================

  useBindings(() => ({
    bindings: [
      {
        key: "r",
        desc: "Refresh usage",
        group: "Dialog",

        cmd: () =>
          void fetchUsage(true),
      },
    ],
  }))


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <box
      width="100%"
      paddingLeft={3}
      paddingRight={3}
      paddingBottom={2}
      gap={0}
      backgroundColor={
        USAGE_COLORS.background
      }
    >

      {/* ==================================================
          HEADER

          Nunca desaparece.
      ================================================== */}

      <box
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        height={1}
      >
        <text
          attributes={
            TextAttributes.BOLD
          }
          fg={theme.text}
        >
          {providerName(
            model?.providerID,
          )} Usage
        </text>

        <text
          fg={theme.textMuted}
          onMouseUp={() =>
            dialog.clear()
          }
        >
          r refresh · esc close
        </text>
      </box>


      {/* ==================================================
          ~10px:
          Header -> Gemini Models Usage
      ================================================== */}

      <box height={1} />


      {/* ==================================================
          BODY
      ================================================== */}

      <Show
        when={group()}
        fallback={
          <Show
            when={loading()}
            fallback={
              <Show when={error()}>
                {(message) => (
                  <box
                    width="100%"
                    flexDirection="column"
                    gap={1}
                  >
                    <text
                      fg={theme.error}
                    >
                      {message()}
                    </text>

                    <text
                      fg={
                        theme.textMuted
                      }
                    >
                      {model?.providerID === "codex"
                        ? elapsed() > 15
                          ? "Codex is not answering. Check your ChatGPT plan or re-login with /connect."
                          : "Is Codex connected? Run /connect and pick Codex."
                        : elapsed() > 15
                          ? "agy is not answering from inside opencode (check with `agy --print /usage` in a terminal)."
                          : "Is Antigravity connected? Run /connect and pick Google OAuth."}
                    </text>
                  </box>
                )}
              </Show>
            }
          >
            <SkeletonUsage
              titleWidth={
                (
                  groupNameFor(
                    model?.providerID,
                    model?.modelID ?? "",
                  ) + " Usage"
                ).length
              }
            />
          </Show>
        }
      >
        {(current) => (
          <box
            width="100%"
            flexDirection="column"
            gap={0}
          >

            {/* ============================================
                Gemini Models Usage
            ============================================ */}

            <text
              fg={USAGE_COLORS.title}
            >
              {current().name} Usage
            </text>


            {/* ============================================
                ~15px:
                title -> primera barra
            ============================================ */}

            <box height={1} />


            {/* ============================================
                Usage buckets
            ============================================ */}

            <box
              width="100%"
              flexDirection="column"
              gap={1}
            >
              {current()
                .buckets
                .slice()
                .sort(
                  (a, b) =>
                    Number(
                      a.window ===
                        "weekly",
                    ) -
                    Number(
                      b.window ===
                        "weekly",
                    ),
                )
                .map(
                  (bucket) => (
                    <Bucket
                      bucket={
                        bucket
                      }
                    />
                  ),
                )}
            </box>

          </box>
        )}
      </Show>

    </box>
  )
}