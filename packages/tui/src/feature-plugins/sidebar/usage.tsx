import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, createSignal, createEffect, on, onMount, onCleanup, Show } from "solid-js"
import { getAgyUsage, type AgyUsageBucket, type AgyUsageGroup } from "@opencode-ai/core/antigravity"
import { getCodexUsage } from "@opencode-ai/core/codex"
import { useLocal } from "../../context/local"

const id = "internal:sidebar-usage"

const USAGE_COLORS = {
  fill: "#ffb486",
  track: "#5b5b5d",
  percentage: "#f5f5f5",
} as const

const THIN_BAR = "━".repeat(64)

function ThinProgressBar(props: { fraction: number; width?: number }) {
  const fraction = () => Math.min(1, Math.max(0, props.fraction))
  const filledPercent = () => Math.round(fraction() * 100)
  const remainingPercent = () => 100 - filledPercent()
  const barWidth = props.width ?? 18

  return (
    <box width={barWidth} flexDirection="row" height={1} overflow="hidden">
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
      // Ignore background errors in sidebar silently
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

  // Select only the 5h limit bucket
  const bucket = createMemo(() => {
    const g = group()
    if (!g) return undefined
    return (
      g.buckets.find(
        (b) =>
          b.window === "5h" ||
          b.name.toLowerCase().startsWith("five") ||
          b.name.toLowerCase().includes("5h"),
      ) ?? g.buckets[0]
    )
  })

  const fraction = () => {
    const b = bucket()
    return b ? Math.min(1, Math.max(0, b.remaining_fraction)) : 0
  }
  const percent = () => Math.round(fraction() * 100)

  return (
    <box>
      <text fg={theme().text}>
        <b>USAGE</b>
      </text>

      <Show
        when={isQuota()}
        fallback={<text fg={theme().textMuted}>No quota limits</text>}
      >
        <Show
          when={bucket()}
          fallback={<text fg={theme().textMuted}>{loading() ? "Loading usage…" : "No quota data"}</text>}
        >
          <box flexDirection="row" alignItems="center" gap={1} height={1} marginTop={1}>
            <ThinProgressBar fraction={fraction()} width={18} />
            <text fg={USAGE_COLORS.percentage} flexShrink={0}>
              {percent()}%
            </text>
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
