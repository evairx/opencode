import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, createEffect, on, onMount, onCleanup, For, Show } from "solid-js"
import { getAgyUsage, type AgyUsageBucket, type AgyUsageGroup } from "@opencode-ai/core/antigravity"
import { getCodexUsage } from "@opencode-ai/core/codex"
import { useLocal } from "../../context/local"
import { useDialog } from "../../ui/dialog"
import { DialogUsage } from "../../component/dialog-usage"

const id = "internal:sidebar-usage"

const USAGE_COLORS = {
  fill: "#ffb486",
  track: "#5b5b5d",
  percentage: "#f5f5f5",
} as const

const THIN_BAR = "▀".repeat(128)

function ThinProgressBar(props: { fraction: number }) {
  const fraction = () => Math.min(1, Math.max(0, props.fraction))
  const filledPercent = () => Math.round(fraction() * 100)
  const remainingPercent = () => 100 - filledPercent()

  return (
    <box flexDirection="row" flexGrow={1} flexBasis={0} minWidth={0} height={1} overflow="hidden">
      <Show when={filledPercent() > 0}>
        <box width={`${filledPercent()}%`} height={1} flexShrink={0} minWidth={0} overflow="hidden">
          <text fg={USAGE_COLORS.fill}>{THIN_BAR}</text>
        </box>
      </Show>
      <Show when={remainingPercent() > 0}>
        <box width={`${remainingPercent()}%`} height={1} flexShrink={0} minWidth={0} overflow="hidden">
          <text fg={USAGE_COLORS.track}>{THIN_BAR}</text>
        </box>
      </Show>
    </box>
  )
}

function groupNameFor(providerID: string | undefined, modelID: string): string {
  if (providerID === "codex") {
    return "Codex"
  }
  return modelID.startsWith("gemini") ? "Gemini Models" : "Claude and GPT models"
}

function getBucketLabel(bucket: AgyUsageBucket): string {
  const name = bucket.name.toLowerCase()
  if (bucket.window === "5h" || name.startsWith("five")) {
    return "5h Limit"
  }
  if (bucket.window === "weekly" || name.startsWith("weekly")) {
    return "Weekly Limit"
  }
  return bucket.name
}

function formatReset(resetTime: string | undefined): string | undefined {
  const at = resetTime ? Date.parse(resetTime) : NaN
  if (Number.isNaN(at)) return undefined
  const minutes = Math.ceil((at - Date.now()) / 60_000)
  if (minutes < 60) return `in ${Math.max(minutes, 1)}m`
  if (minutes < 48 * 60) return `in ${Math.ceil(minutes / 60)}h`
  return `in ${Math.ceil(minutes / (24 * 60))}d`
}

let sharedGroup: AgyUsageGroup | undefined
let sharedLastFetch = 0
const listeners = new Set<(g: AgyUsageGroup | undefined) => void>()
const refreshListeners = new Set<() => void>()

function updateSharedGroup(group: AgyUsageGroup | undefined) {
  sharedGroup = group
  sharedLastFetch = Date.now()
  for (const listener of listeners) {
    listener(group)
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const local = useLocal()
  const dialog = useDialog()

  const [group, setGroup] = createSignal<AgyUsageGroup | undefined>(sharedGroup)
  const [loading, setLoading] = createSignal(!sharedGroup)

  const model = () => local.model.current()
  const isQuota = createMemo(() => {
    const p = model()?.providerID
    return p === "codex" || p === "antigravity"
  })

  const fetchUsage = async (force = false) => {
    if (!isQuota()) return
    const currentModel = model()
    if (!currentModel) return

    setLoading(true)
    try {
      const groups =
        currentModel.providerID === "codex"
          ? await getCodexUsage(force)
          : await getAgyUsage(force)

      const wantedGroup = groupNameFor(currentModel.providerID, currentModel.modelID)
      const found = groups.find((item) => item.name === wantedGroup) ?? groups[0]
      if (found) {
        setGroup(found)
        updateSharedGroup(found)
      }
    } catch {
      // Ignore background errors in sidebar
    } finally {
      setLoading(false)
    }
  }

  onMount(() => {
    const groupListener = (g: AgyUsageGroup | undefined) => setGroup(g)
    listeners.add(groupListener)
    const onRefresh = () => void fetchUsage(true)
    refreshListeners.add(onRefresh)

    onCleanup(() => {
      listeners.delete(groupListener)
      refreshListeners.delete(onRefresh)
    })

    if (!sharedGroup || Date.now() - sharedLastFetch > 60_000) {
      void fetchUsage(false)
    }
  })

  createEffect(
    on(
      model,
      () => {
        if (isQuota()) {
          void fetchUsage(false)
        }
      },
      { defer: true },
    ),
  )

  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  createEffect(
    on(
      msg,
      () => {
        const last = msg().at(-1)
        if (last?.role === "assistant" && last.time.completed !== undefined) {
          void fetchUsage(true)
        }
      },
      { defer: true },
    ),
  )

  const buckets = createMemo(() => {
    const g = group()
    if (!g) return []
    return g.buckets.slice().sort((a, b) => Number(a.window === "weekly") - Number(b.window === "weekly"))
  })

  return (
    <box
      onMouseDown={() => {
        if (isQuota()) {
          dialog.replace(() => <DialogUsage />)
        }
      }}
    >
      <text fg={theme().text}>
        <b>Usage</b>
      </text>

      <Show
        when={isQuota()}
        fallback={<text fg={theme().textMuted}>No quota limits</text>}
      >
        <Show
          when={buckets().length > 0}
          fallback={<text fg={theme().textMuted}>{loading() ? "Loading usage…" : "No quota data"}</text>}
        >
          <box flexDirection="column" gap={1}>
            <For each={buckets()}>
              {(bucket) => {
                const fraction = () => Math.min(1, Math.max(0, bucket.remaining_fraction))
                const percent = () => Math.round(fraction() * 100)
                const label = () => getBucketLabel(bucket)
                const reset = () => formatReset(bucket.reset_time)

                return (
                  <box width="100%" flexDirection="column" gap={0}>
                    <box width="100%" flexDirection="row" alignItems="center" gap={1} height={1}>
                      <ThinProgressBar fraction={fraction()} />
                      <box width={4} height={1} flexShrink={0} alignItems="flex-end">
                        <text fg={USAGE_COLORS.percentage}>{percent()}%</text>
                      </box>
                    </box>
                    <box width="100%" flexDirection="row" gap={1} height={1}>
                      <text fg={theme().textMuted}>{label()}</text>
                      <Show when={reset()}>
                        <text fg={theme().textMuted}>· {reset()}</text>
                      </Show>
                    </box>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </Show>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  let wasBusy = false
  api.event.on("session.status", (event) => {
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      wasBusy = true
      return
    }
    if (event.properties.status.type === "idle" && wasBusy) {
      wasBusy = false
      for (const fn of refreshListeners) {
        fn()
      }
    }
  })

  api.slots.register({
    order: 350,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
