/**
 * Module-level "live stream" store.
 *
 * The agent chat stream must survive page navigation: switching routes
 * unmounts the Chat component, and state updates from an in-flight fetch
 * would be dropped by React (and localStorage writes inside state updaters
 * never run). This store keeps the stream bookkeeping OUTSIDE React, writes
 * progress straight to localStorage, and notifies whatever Chat instance is
 * currently mounted (none, one, or a remounted one after navigation) so the
 * running task stays visible when the user comes back.
 */
import { fetchEventSource } from '../api';

export interface LiveContextTokens {
  used: number;
  total: number;
  percent: number;
}

export interface LiveStream {
  chatId: string;
  assistantIndex: number;
  timeStr: string;
  lang: 'zh' | 'en';
  /** Fully applied assistant-message content (buffer already flushed). */
  content: string;
  /** Pending deltas not yet applied to content. */
  buffer: string;
  flushTimer: ReturnType<typeof setTimeout> | null;
  loading: boolean;
  abort?: AbortController;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  /** Messages sent to the server — reused verbatim when retrying. */
  messages: any[];
  /** Request body — reused verbatim when retrying. */
  body: Record<string, unknown>;
  contextLimit: number;
  contextTokens?: LiveContextTokens;
  cacheRate?: number;
  lastPersist: number;
}

const live = new Map<string, LiveStream>();
const listeners = new Set<(chatId: string) => void>();
const STORAGE_KEY = 'orca_conversations';
// Persist at most every 2s — matching the pre-stream-store debounce. Frequent
// JSON.stringify of a large conversation during a long task is heavy on the
// renderer (and localStorage writes are synchronous).
const PERSIST_DEBOUNCE = 2000;
const FLUSH_DELAY = 120;
const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;
// How long a finished stream stays in the live map after finalize. Subscribers
// (Chat.tsx applyLiveStream) coalesce live updates onto a ~250ms trailing-edge
// timer; deleting the entry synchronously in finalizeStream would make that
// timer find nothing — dropping the final content flush and the loading=false
// reset (stuck spinner + locked composer + missing reply tail).
const FINAL_CLEANUP_DELAY = 1000;
const finalCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleFinalCleanup(chatId: string): void {
  const existing = finalCleanupTimers.get(chatId);
  if (existing) clearTimeout(existing);
  finalCleanupTimers.set(chatId, setTimeout(() => {
    finalCleanupTimers.delete(chatId);
    live.delete(chatId);
  }, FINAL_CLEANUP_DELAY));
}

export function subscribeStreams(fn: (chatId: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getLive(chatId: string): LiveStream | undefined {
  return live.get(chatId);
}

export function listLive(): LiveStream[] {
  return [...live.values()];
}

/** True while a stream for this chat is active (including retry waits). */
export function isStreaming(chatId: string): boolean {
  return !!live.get(chatId)?.loading;
}

function notify(chatId: string): void {
  for (const fn of listeners) {
    try { fn(chatId); } catch { /* a bad subscriber must not kill the stream */ }
  }
}

// If the server ended the stream while a <think> block was still open
// (stall / hard-stop / error), append a closing tag so the thinking row
// collapses instead of counting seconds forever.
export function closeDanglingThink(content: string): string {
  if (!content) return content;
  const count = (re: RegExp) => (content.match(re) || []).length;
  const opens = count(/<think>/gi) + count(/<thinking>/gi);
  const closes = count(/<\/think>/gi) + count(/<\/thinking>/gi);
  return opens > closes ? content + '\n</think>\n' : content;
}

/** Merge the live content into the persisted conversations (debounced). */
function persistStream(st: LiveStream, force = false): void {
  const now = Date.now();
  if (!force && now - st.lastPersist < PERSIST_DEBOUNCE) return;
  st.lastPersist = now;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const convos = JSON.parse(raw);
    const conv = convos.find((c: any) => c.id === st.chatId);
    const msg = conv?.messages?.[st.assistantIndex];
    if (!conv || !msg) return;
    msg.content = st.content;
    if (!msg.timestamp) msg.timestamp = st.timeStr;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(convos));
  } catch { /* storage unreadable/corrupt — stream continues regardless */ }
}

/** Apply buffered deltas to content, persist and notify (batched). */
function flushStream(st: LiveStream): void {
  if (st.flushTimer) { clearTimeout(st.flushTimer); st.flushTimer = null; }
  if (st.buffer) {
    st.content += st.buffer;
    st.buffer = '';
    persistStream(st);
  }
  notify(st.chatId);
}

function scheduleFlush(st: LiveStream): void {
  if (!st.flushTimer) {
    st.flushTimer = setTimeout(() => flushStream(st), FLUSH_DELAY);
  }
}

function finalizeStream(st: LiveStream, outcome: 'done' | 'error' | 'aborted' = 'done'): void {
  flushStream(st);
  st.loading = false;
  st.abort = undefined;
  if (st.retryTimer) { clearTimeout(st.retryTimer); st.retryTimer = null; }
  st.retryCount = 0;
  persistStream(st, true);
  // P0-2: Browser-mode desktop notification when a task finishes while the
  // page is hidden. Electron mode is covered by the server-side IPC
  // notification, so skip it here to avoid double notifications.
  maybeNotifyDesktop(st, outcome);
  notify(st.chatId);
  // Do NOT delete synchronously — see FINAL_CLEANUP_DELAY above.
  scheduleFinalCleanup(st.chatId);
}

/**
 * Web Notification for long-running tasks: only when the tab is hidden, the
 * user did not stop the stream themselves, and permission is granted.
 * Requesting permission lazily on first completion avoids an upfront prompt.
 */
function maybeNotifyDesktop(st: LiveStream, outcome: 'done' | 'error' | 'aborted'): void {
  try {
    if (outcome === 'aborted') return;                       // user stopped — no nagging
    if (typeof document === 'undefined' || !document.hidden) return;
    if (navigator.userAgent.includes('Electron')) return;    // server-side IPC handles it
    if (!('Notification' in window)) return;
    const notify = () => {
      if (Notification.permission !== 'granted') return;
      const msgs = Array.isArray(st.body?.messages) ? st.body.messages as any[] : [];
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const goal = lastMsg && typeof lastMsg.content === 'string' ? lastMsg.content.slice(0, 80) : '';
      const title = outcome === 'error'
        ? (st.lang === 'en' ? 'Orca task failed' : 'Orca 任务出错')
        : (st.lang === 'en' ? 'Orca task completed' : 'Orca 任务完成');
      const body = goal ? `${goal}${goal.length >= 80 ? '…' : ''}` : (st.lang === 'en' ? 'Your task has finished.' : '你的任务已结束。');
      new Notification(title, { body });
    };
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((p) => { if (p === 'granted') notify(); });
    } else {
      notify();
    }
  } catch { /* notifications must never break the stream */ }
}

async function runFetch(st: LiveStream): Promise<void> {
  const chatId = st.chatId;
  const controller = new AbortController();
  st.abort = controller;

  await fetchEventSource(
    '/v1/chat/completions',
    st.body,
    (data) => {
      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content || '';
        if (parsed.usage) {
          const used = parsed.usage.prompt_tokens || 0;
          const total = parsed.usage.total_tokens || 0;
          if (used > 0 && total > 0) {
            st.contextTokens = {
              used,
              total: st.contextLimit,
              percent: Math.min(100, Math.round((used / st.contextLimit) * 100)),
            };
          }
          const cached = parsed.usage.prompt_tokens_details?.cached_tokens
            ?? parsed.usage.input_token_details?.cache_read
            ?? 0;
          if (used > 0) st.cacheRate = Math.round((cached / used) * 100);
        }
        if (delta) {
          st.buffer += delta;
          scheduleFlush(st);
        }
      } catch { /* non-JSON frame — ignore */ }
    },
    () => {
      // Stream ended cleanly (EOF after [DONE]) — flush, close any dangling
      // <think> the server left open, persist and drop the live entry.
      flushStream(st);
      st.content = closeDanglingThink(st.content);
      finalizeStream(st, 'done');
    },
    (err) => {
      if ((err as Error)?.name === 'AbortError') {
        // User pressed stop: abort() rejects the fetch — append the marker.
        flushStream(st);
        st.content = closeDanglingThink(st.content)
          + (st.lang === 'en' ? '\n\n---\n*[Stream interrupted]*' : '\n\n---\n*[流已中断]*');
        finalizeStream(st, 'aborted');
        return;
      }
      console.error(err);
      flushStream(st);
      if (st.retryCount < MAX_RETRIES) {
        st.retryCount += 1;
        const retryNum = st.retryCount;
        const retryMsg = st.lang === 'en'
          ? `\n\n[Connection lost. Reconnecting (${retryNum}/${MAX_RETRIES})...]`
          : `\n\n[连接中断，正在重新连接 (${retryNum}/${MAX_RETRIES})…]`;
        st.content += retryMsg;
        persistStream(st, true);
        notify(chatId);
        st.abort = undefined;
        st.retryTimer = setTimeout(() => {
          st.retryTimer = null;
          if (live.has(chatId)) void runFetch(st);
        }, RETRY_DELAY);
        return;
      }
      // Retries exhausted — surface the error and stop.
      st.content = closeDanglingThink(st.content)
        + (st.lang === 'en'
          ? '\n\n[Error: Failed after retries. Please check network and provider settings.]'
          : '\n\n[错误: 重试后仍无法获取响应，请检查网络和供应商配置。]');
      finalizeStream(st, 'error');
    },
    controller.signal
  );
}

/**
 * Begin (or resume via retry) the live stream for a chat. The assistant
 * placeholder message must already exist at `assistantIndex` in the
 * conversation; the store owns the stream state from here on.
 */
export function startStream(
  chatId: string,
  assistantIndex: number,
  timeStr: string,
  lang: 'zh' | 'en',
  body: Record<string, unknown>,
  messages: any[],
  contextLimit: number
): void {
  const existing = live.get(chatId);
  if (existing) {
    existing.assistantIndex = assistantIndex;
    existing.timeStr = timeStr;
    existing.lang = lang;
    existing.body = body;
    existing.messages = messages;
    existing.contextLimit = contextLimit;
    existing.retryCount = 0;
    if (!existing.loading) {
      // Finished (or awaiting final cleanup) — restart the stream fresh.
      existing.loading = true;
      notify(chatId);
      void runFetch(existing);
    } else if (!existing.abort) {
      // Loading but no fetch in flight (retry wait) — resume the retry loop.
      notify(chatId);
      void runFetch(existing);
    } else {
      // Already streaming: never start a second concurrent fetch (deltas would
      // interleave into the same message). Update metadata and keep the
      // running stream. Callers guard with isStreaming(), this is a backstop.
      notify(chatId);
    }
    return;
  }
  const st: LiveStream = {
    chatId,
    assistantIndex,
    timeStr,
    lang,
    content: '',
    buffer: '',
    flushTimer: null,
    loading: true,
    retryCount: 0,
    retryTimer: null,
    messages,
    body,
    contextLimit,
    lastPersist: 0,
  };
  live.set(chatId, st);
  notify(chatId);
  void runFetch(st);
}

/** User pressed stop: abort the in-flight fetch (marker appended by the
 *  AbortError handler) or cancel a pending retry-wait. */
export function abortStream(chatId: string): void {
  const st = live.get(chatId);
  if (!st) return;
  if (st.retryTimer) { clearTimeout(st.retryTimer); st.retryTimer = null; }
  if (st.abort) { st.abort.abort(); return; }
  // No fetch in flight (user stopped during the retry wait): end silently.
  st.loading = false;
  persistStream(st, true);
  notify(chatId);
  scheduleFinalCleanup(chatId);
}
