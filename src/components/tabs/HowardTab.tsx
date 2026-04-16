"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { authFetch } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import { swrKeys } from "@/lib/swrKeys";
import type { AircraftWithMetrics } from "@/lib/types";
import type { HowardMessage } from "@/lib/howard/types";
import useSWR from "swr";
import { Send, Wrench, Globe, CloudSun, FileSearch, Database, BarChart3, Trash2, X } from "lucide-react";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import ProposedActionCard from "@/components/howard/ProposedActionCard";
import type { ProposedAction } from "@/lib/howard/proposedActions";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Tight markdown preset — Howard writes conversationally, so we want
 * bold / italic / lists / inline code to render, but we don't want big
 * heading chrome. Pass as `components` to ReactMarkdown.
 */
const MARKDOWN_COMPONENTS = {
  p: (props: any) => <p className="font-roboto text-sm leading-relaxed mb-2 last:mb-0" {...props} />,
  strong: (props: any) => <strong className="font-bold text-navy" {...props} />,
  em: (props: any) => <em className="italic" {...props} />,
  ul: (props: any) => <ul className="list-none pl-0 my-2 space-y-1 text-sm marker:text-[#e6651b] [&>li]:relative [&>li]:pl-4 [&>li]:before:content-['•'] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:text-[#e6651b] [&>li]:before:font-bold" {...props} />,
  ol: (props: any) => <ol className="list-decimal pl-5 my-2 space-y-1 text-sm marker:text-[#e6651b] marker:font-bold" {...props} />,
  li: (props: any) => <li className="leading-relaxed" {...props} />,
  code: (props: any) => <code className="font-mono text-[0.85em] bg-[#e6651b]/10 text-[#c35617] px-1.5 py-0.5 rounded border border-[#e6651b]/20" {...props} />,
  a: (props: any) => <a className="text-[#e6651b] underline" target="_blank" rel="noopener noreferrer" {...props} />,
  // Howard is told not to use headers, but if one slips through, render
  // as a bold lead-in rather than big heading chrome.
  h1: (props: any) => <p className="font-bold text-sm mt-2 mb-1" {...props} />,
  h2: (props: any) => <p className="font-bold text-sm mt-2 mb-1" {...props} />,
  h3: (props: any) => <p className="font-bold text-sm mt-2 mb-1" {...props} />,
  h4: (props: any) => <p className="font-bold text-sm mt-2 mb-1" {...props} />,
  // Callout block — good for a one-line caveat or advisory handoff.
  blockquote: (props: any) => (
    <blockquote
      className="relative my-2 pl-3 pr-3 py-2 rounded-r bg-[#e6651b]/5 border-l-4 border-[#e6651b] text-sm text-navy italic [&>p]:mb-0"
      {...props}
    />
  ),
  // Visible separator — Howard may use `---` to split a status header
  // from the detail beneath.
  hr: () => <hr className="my-3 border-t border-dashed border-[#e6651b]/30" />,
};

const SUGGESTIONS = [
  "What maintenance is coming due?",
  "Show me recent flight logs",
  "Any open squawks?",
  "When is my VOR check due?",
];

const EMPTY_FLEET_SUGGESTIONS = [
  "How do I add my first aircraft?",
  "What's a good pre-buy inspection checklist?",
  "Explain 91.205 VFR equipment requirements",
];

// Friendly label for tool-use indicator
function toolLabel(name: string): { label: string; Icon: any } {
  if (name === 'web_search') return { label: 'Searching the web', Icon: Globe };
  if (name === 'search_documents') return { label: 'Searching documents', Icon: FileSearch };
  if (name === 'get_weather_briefing' || name === 'get_aviation_hazards') return { label: 'Pulling weather', Icon: CloudSun };
  if (name.startsWith('get_')) return { label: 'Looking up ' + name.replace('get_', '').replace(/_/g, ' '), Icon: Database };
  return { label: 'Using ' + name, Icon: Wrench };
}

export default function HowardTab({
  currentAircraft, userFleet = [], session, compact = false,
}: {
  /** Aircraft currently selected in the surrounding UI — purely a hint
   * for Howard. Conversations are user-scoped; each aircraft-specific
   * tool call carries a `tail` resolved from the conversation. */
  currentAircraft: AircraftWithMetrics | null;
  /** The full fleet the user has access to. Used to render an aircraft
   * picker when Howard is waiting for tail confirmation. */
  userFleet?: AircraftWithMetrics[];
  session: any;
  /** Render without the "Howard" logo header (used when embedded in the
   * launcher popup, which has its own header). */
  compact?: boolean;
}) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  // Contextual follow-up chips (set by the launcher prefill). Shown beneath
  // the latest assistant reply so the user can drill into depth without
  // retyping. Cleared when the user sends a manual (typed) message.
  const [followUps, setFollowUps] = useState<{ label: string; prompt: string }[]>([]);
  // The launcher flags aircraft-specific prompts with kind='aircraft'.
  // We stay in "awaiting tail confirmation" until Howard actually calls
  // a tool (he needed aircraft context to answer) or the user types
  // manually (they've moved on to something else).
  const [awaitingAircraftChoice, setAwaitingAircraftChoice] = useState(false);
  // Free-text tail input used when the fleet is big enough that chips
  // alone aren't enough (typeahead fallback for the picker).
  const [pickerFilter, setPickerFilter] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Prevents the single-aircraft auto-confirm effect from firing twice.
  const autoConfirmedTailRef = useRef<string | null>(null);
  // Tracks the last aircraft tail we showed the "you switched to…"
  // banner for. When currentAircraft.tail_number differs from this,
  // and there are actual messages in the thread, the banner appears.
  // Null until we've had at least one conversation with an aircraft
  // in context.
  const [acknowledgedTail, setAcknowledgedTail] = useState<string | null>(null);

  const userId = session?.user?.id;
  const { data, mutate } = useSWR(
    userId ? swrKeys.howardUser(userId) : null,
    async () => {
      const res = await authFetch(`/api/howard`);
      if (!res.ok) throw new Error('Failed to load conversation');
      return await res.json() as { thread: any; messages: HowardMessage[] };
    },
    // Focus/reconnect revalidation mid-stream can wipe optimistic/streamed
    // state. Load once, and only refetch when we explicitly call mutate().
    { revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false }
  );

  const messages = data?.messages || [];
  const threadId = data?.thread?.id;

  // Proposed actions for this thread, keyed by id.
  const { data: actionsData, mutate: mutateActions } = useSWR(
    threadId ? swrKeys.howardActions(threadId) : null,
    async () => {
      const res = await authFetch(`/api/howard/actions?threadId=${threadId}`);
      if (!res.ok) throw new Error('Failed to load actions');
      return await res.json() as { actions: ProposedAction[] };
    }
  );
  const actionsById: Record<string, ProposedAction> = {};
  for (const a of actionsData?.actions || []) actionsById[a.id] = a;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, activeToolName]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || !userId || isSending) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsSending(true);
    setStreamingText('');
    setActiveToolName(null);

    const optimisticUserMsg: HowardMessage = {
      id: 'pending-user',
      thread_id: '',
      role: 'user',
      content: msg,
      tool_calls: null,
      tool_results: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_create_tokens: null,
      model: null,
      created_at: new Date().toISOString(),
    };
    // When launched from an "Ask Howard" button elsewhere in the app,
    // HowardTab may still be mounting and SWR may not have resolved yet,
    // so prev is undefined. Seed an empty base so the optimistic user
    // bubble renders immediately instead of waiting for the server.
    mutate(prev => {
      const base = prev ?? { thread: null, messages: [] };
      return { ...base, messages: [...base.messages, optimisticUserMsg] };
    }, false);

    // Hoisted so the catch block can recover partial state if the stream
    // errors mid-response.
    let savedUserMsg: HowardMessage | null = null;
    let savedAssistantMsg: HowardMessage | null = null;
    let accumulated = '';

    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      // Send the pilot's IANA timezone so Howard can resolve relative
      // times ("9am today", "tomorrow 7pm") without asking. Falls back
      // to UTC on the server if absent.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch('/api/howard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : {}),
        },
        body: JSON.stringify({
          message: msg,
          currentTail: currentAircraft?.tail_number ?? null,
          timeZone: tz,
        }),
      });

      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({ error: 'Failed to send message' }));
        throw new Error(d.error || 'Failed to send message');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6);
          let ev: any;
          try { ev = JSON.parse(payload); } catch { continue; }

          if (ev.type === 'user_saved') {
            savedUserMsg = ev.userMessage;
          } else if (ev.type === 'text_delta') {
            accumulated += ev.delta;
            setStreamingText(accumulated);
            setActiveToolName(null);
          } else if (ev.type === 'tool_use_start') {
            setActiveToolName(ev.name);
            // A tool call means Howard has the aircraft context he
            // needed — we can drop the pending-confirmation state.
            setAwaitingAircraftChoice(false);
          } else if (ev.type === 'tool_use_end') {
            setActiveToolName(null);
          } else if (ev.type === 'done') {
            savedAssistantMsg = ev.assistantMessage;
          } else if (ev.type === 'error') {
            throw new Error(ev.error || 'Stream error');
          }
        }
      }

      // Replace optimistic + streaming placeholder with persisted records.
      // If the stream ended cleanly but never sent a `done` event (e.g.
      // the serverless function was cut off), fall back to the text we
      // already streamed so the user doesn't lose the reply.
      const partialFallback = !savedAssistantMsg && accumulated.trim()
        ? {
            id: `local-partial-${Date.now()}`,
            thread_id: '',
            role: 'assistant' as const,
            content: accumulated,
            tool_calls: null,
            tool_results: null,
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_create_tokens: null,
            model: null,
            created_at: new Date().toISOString(),
          }
        : null;
      // flushSync forces the mutate-triggered re-render to complete
      // before we fall into the finally that clears streamingText.
      // Without this, SWR's subscription update and the finally's
      // setStates can land in separate renders, producing a one-frame
      // gap where the streaming bubble has hidden but the saved
      // message hasn't appeared yet — which reads as a vanishing reply.
      flushSync(() => {
        mutate(prev => {
          const base = prev ?? { thread: null, messages: [] };
          const filtered = base.messages.filter(m => m.id !== 'pending-user');
          const next = [...filtered];
          if (savedUserMsg) next.push(savedUserMsg);
          if (savedAssistantMsg) next.push(savedAssistantMsg);
          else if (partialFallback) next.push(partialFallback);
          return { ...base, messages: next };
        }, false);
      });
      if (!savedAssistantMsg && partialFallback) {
        showError('Connection cut off before Howard finished. Partial reply kept.');
      }

      // If Howard created any proposed actions, pick them up for the cards.
      mutateActions();
    } catch (err: any) {
      showError(err.message);
      // Preserve whatever text already streamed so the user doesn't lose
      // the reply when the connection drops mid-response.
      const partial = accumulated.trim();
      flushSync(() => {
        mutate(prev => {
          const base = prev ?? { thread: null, messages: [] };
          const filtered = base.messages.filter(m => m.id !== 'pending-user');
          const next = [...filtered];
          if (savedUserMsg) next.push(savedUserMsg);
          if (partial) {
            next.push({
              id: `local-partial-${Date.now()}`,
              thread_id: '',
              role: 'assistant',
              content: partial,
              tool_calls: null,
              tool_results: null,
              input_tokens: null,
              output_tokens: null,
              cache_read_tokens: null,
              cache_create_tokens: null,
              model: null,
              created_at: new Date().toISOString(),
            });
          }
          return { ...base, messages: next };
        }, false);
      });
    } finally {
      setIsSending(false);
      setStreamingText('');
      setActiveToolName(null);
    }
  }, [input, userId, currentAircraft, isSending, mutate, mutateActions, showError]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Manual (typed) send ends the launcher's follow-up / tail-
      // confirmation context — user has moved on on their own.
      setFollowUps([]);
      setAwaitingAircraftChoice(false);
      handleSend();
    }
  }, [handleSend]);

  const handleClearThread = useCallback(async () => {
    if (isSending) return;
    const ok = await confirm({
      title: 'Clear conversation?',
      message: `This will permanently delete your entire chat history with Howard. Usage totals are unaffected.`,
      confirmText: 'Clear',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch(`/api/howard`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to clear conversation');
      mutate({ thread: null, messages: [] }, false);
      showSuccess('Conversation cleared.');
    } catch (err: any) {
      showError(err.message);
    }
  }, [isSending, confirm, mutate, showSuccess, showError]);

  // Single-aircraft auto-confirm — if Howard asks "which aircraft?" and
  // the user only has one, there's no real choice to make. Send the
  // confirmation automatically instead of rendering a one-button picker.
  useEffect(() => {
    if (isSending) return;
    if (!awaitingAircraftChoice) return;
    if (userFleet.length !== 1) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    const lastHasTools = Array.isArray(last.tool_calls) && last.tool_calls.length > 0;
    if (lastHasTools) return;
    const onlyTail = userFleet[0].tail_number;
    if (autoConfirmedTailRef.current === onlyTail) return;
    autoConfirmedTailRef.current = onlyTail;
    handleSend(`Yes, ${onlyTail}.`);
  }, [awaitingAircraftChoice, userFleet, messages, isSending, handleSend]);

  // Reset the guard when we leave the awaiting state so a later
  // conversation can trigger the auto-confirm again.
  useEffect(() => {
    if (!awaitingAircraftChoice) autoConfirmedTailRef.current = null;
  }, [awaitingAircraftChoice]);

  // Prefill handoff from the floating HowardLauncher (or any caller).
  // sessionStorage key "aft_howard_prefill" (JSON: {prompt, autoSend, followUps?})
  useEffect(() => {
    if (isSending) return;
    try {
      const raw = sessionStorage.getItem('aft_howard_prefill');
      if (!raw) return;
      sessionStorage.removeItem('aft_howard_prefill');
      const { prompt, autoSend, followUps: fu, kind } = JSON.parse(raw);
      if (Array.isArray(fu)) {
        setFollowUps(fu.filter((x: any) => typeof x?.label === 'string' && typeof x?.prompt === 'string'));
      }
      if (kind === 'aircraft') setAwaitingAircraftChoice(true);
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      if (autoSend) {
        handleSend(prompt);
      } else {
        setInput(prompt);
        textareaRef.current?.focus();
      }
    } catch {}
  }, [currentAircraft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toolInfo = activeToolName ? toolLabel(activeToolName) : null;

  // Aircraft-switch detection. Initialize the baseline once we have
  // both an aircraft context and a non-empty thread. When the selected
  // tail diverges from that baseline, show the switch banner.
  const currentTail = currentAircraft?.tail_number || null;
  useEffect(() => {
    if (acknowledgedTail === null && currentTail && messages.length > 0) {
      setAcknowledgedTail(currentTail);
    }
  }, [currentTail, messages.length, acknowledgedTail]);
  const showSwitchBanner =
    currentTail != null &&
    acknowledgedTail != null &&
    currentTail !== acknowledgedTail &&
    messages.length > 0 &&
    !isSending;

  // Quick prompts offered when the pilot switches aircraft mid-
  // conversation. Keeps parity with the HowardLauncher menu so the
  // pilot gets the same four angles they'd get from the FAB.
  const aircraftSwitchPrompts: { label: string; prompt: string }[] = [
    { label: 'Airworthiness', prompt: `Is my aircraft airworthy right now? Walk me through it.` },
    { label: 'Maintenance', prompt: `What's the maintenance picture — anything overdue, due soon, open squawks, ADs to act on? Order by urgency.` },
    { label: 'Recent activity', prompt: `What's been happening the last 30 days — flights, squawks, MX work?` },
    { label: 'Book time', prompt: `I'd like to book some time. Ask me for the details you need.` },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header — hidden in compact mode (the launcher popup has its
       * own). Uses the brand logo to match the floating FAB. The PIC-
       * authority disclaimer below the header lives on the full-page
       * surface only; the popup has its own copy in HowardLauncher. */}
      {!compact && (
        <>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 border border-[#e6651b]/20">
                <img src="/howard-logo.svg" alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
              <div className="min-w-0">
                <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Howard</h2>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#e6651b] truncate block">
                  {currentAircraft ? `Hangar helper · ${currentAircraft.tail_number}` : 'Hangar helper'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent('aft:navigate-howard-usage'))}
                title="View Howard usage"
                aria-label="View Howard usage"
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#e6651b] active:scale-95 transition-colors"
              >
                <BarChart3 size={14} />
                <span className="hidden sm:inline">Usage</span>
              </button>
              {messages.length > 0 && (
                <button
                  onClick={handleClearThread}
                  disabled={isSending}
                  title="Clear conversation"
                  aria-label="Clear conversation"
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#CE3732] active:scale-95 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={14} />
                  <span className="hidden sm:inline">Clear</span>
                </button>
              )}
            </div>
          </div>
          <div className="mb-4 px-3 py-2 bg-[#e6651b]/5 border border-[#e6651b]/20 rounded">
            <p className="text-[11px] font-roboto italic text-gray-600 leading-snug">
              The PIC retains all legal authority over airworthiness and go/no-go decisions. Howard provides data and helps you think through it — not legal or operational advice.
            </p>
          </div>
        </>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-cream shadow-lg rounded-sm p-4 mb-3 min-h-[300px]">
        {messages.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <div className="w-14 h-14 rounded-full overflow-hidden border border-[#e6651b]/20 mb-1">
              <img src="/howard-logo.svg" alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
            <p className="font-roboto text-sm text-navy mt-3 mb-1 font-bold">Hey, I&apos;m Howard.</p>
            <p className="font-roboto text-xs text-gray-500 mb-4 max-w-xs">
              {userFleet.length === 0
                ? "You haven't added an aircraft yet. Once you do, I can dig into maintenance, squawks, airworthiness, and flight briefings. For now I can answer general aviation questions."
                : 'Ask me about any aircraft in your fleet — maintenance, squawks, airworthiness, flight briefings. I\u2019ll pull real data, never guess.'}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {(userFleet.length === 0 ? EMPTY_FLEET_SUGGESTIONS : SUGGESTIONS).map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[11px] font-roboto font-medium text-[#e6651b] bg-white border border-[#e6651b]/30 rounded-full px-3 py-1.5 hover:bg-[#e6651b]/5 active:scale-95 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map(msg => {
              // Find any propose_* tool calls and their resulting
              // proposed_action_ids (parsed from tool_results).
              const proposedActions: ProposedAction[] = [];
              if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && Array.isArray(msg.tool_results)) {
                const resultById = new Map<string, any>();
                for (const r of msg.tool_results as any[]) {
                  if (r?.tool_use_id) resultById.set(r.tool_use_id, r.result);
                }
                for (const call of msg.tool_calls as any[]) {
                  if (!call?.name?.startsWith('propose_')) continue;
                  const raw = resultById.get(call.id);
                  if (!raw) continue;
                  try {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    const id = parsed?.proposed_action_id;
                    if (id && actionsById[id]) {
                      proposedActions.push(actionsById[id]);
                    }
                  } catch {}
                }
              }

              return (
                <div key={msg.id} className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                    msg.role === 'user'
                      ? 'bg-[#3AB0FF] text-white'
                      : 'bg-white border border-gray-200 text-navy'
                  }`}>
                    {msg.role === 'user' ? (
                      <p className="font-roboto text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <div className="howard-markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                    <span className={`block text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                      {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>

                  {proposedActions.map(a => (
                    <div key={a.id} className="max-w-[85%] w-full">
                      <ProposedActionCard action={a} onChange={() => mutateActions()} />
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Streaming assistant bubble */}
            {isSending && (streamingText || toolInfo) && (
              <div className="flex justify-start">
                <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl px-4 py-2.5 text-navy">
                  {toolInfo && (
                    <div className="flex items-center gap-1.5 mb-1.5 text-[#e6651b]">
                      <toolInfo.Icon size={12} className="animate-pulse" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">{toolInfo.label}…</span>
                    </div>
                  )}
                  {streamingText && (
                    <div className="howard-markdown">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                        {streamingText}
                      </ReactMarkdown>
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[#e6651b] align-middle animate-pulse" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Pre-stream thinking indicator */}
            {isSending && !streamingText && !toolInfo && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#e6651b] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#e6651b] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#e6651b] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {(() => {
              if (isSending) return null;
              const last = messages[messages.length - 1];
              if (!last || last.role !== 'assistant') return null;
              const lastHasTools = Array.isArray(last.tool_calls) && last.tool_calls.length > 0;

              // Aircraft picker — render while Howard is waiting on a tail
              // confirmation (launcher sent an aircraft-specific prompt and
              // Howard hasn't called any tools yet). Clicking a button
              // sends "Yes, <tail>" style confirmation. Skip for
              // single-aircraft users (the auto-confirm effect handles
              // them) and for empty fleets (nothing to pick).
              if (awaitingAircraftChoice && !lastHasTools && userFleet.length > 1) {
                const normalizedFilter = pickerFilter.trim().toUpperCase();
                const filteredFleet = normalizedFilter
                  ? userFleet.filter(a => a.tail_number.toUpperCase().includes(normalizedFilter))
                  : userFleet;
                const needsScroll = userFleet.length > 6;
                const listWrapperCls = needsScroll
                  ? 'flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1'
                  : 'flex flex-wrap gap-1.5';
                return (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 pl-1">Which aircraft?</span>
                    {needsScroll && (
                      <input
                        type="text"
                        value={pickerFilter}
                        onChange={e => setPickerFilter(e.target.value)}
                        placeholder="Type to filter by tail…"
                        autoCapitalize="characters"
                        maxLength={10}
                        className="text-xs font-roboto uppercase px-2.5 py-1.5 rounded border border-gray-300 focus:border-[#e6651b] outline-none"
                        style={{ backgroundColor: '#ffffff' }}
                      />
                    )}
                    <div className={listWrapperCls}>
                      {filteredFleet.map(a => {
                        const isCurrent = currentAircraft?.id === a.id;
                        return (
                          <button
                            key={a.id}
                            onClick={() => { setPickerFilter(''); handleSend(`Yes, ${a.tail_number}.`); }}
                            className={`text-[11px] font-roboto font-medium rounded-full px-3 py-1.5 border active:scale-95 transition-all ${
                              isCurrent
                                ? 'text-white bg-[#e6651b] border-[#e6651b] hover:bg-[#c35617]'
                                : 'text-[#e6651b] bg-white border-[#e6651b]/40 hover:bg-[#e6651b]/10'
                            }`}
                          >
                            {a.tail_number}
                          </button>
                        );
                      })}
                      {filteredFleet.length === 0 && (
                        <span className="text-[11px] font-roboto text-gray-400 px-1 py-1.5">No tails match &quot;{pickerFilter}&quot;.</span>
                      )}
                    </div>
                  </div>
                );
              }

              // Follow-up depth chips — only after Howard actually pulled
              // data (tool_calls on the latest reply). Prevents chips
              // showing beneath a bare confirmation question.
              if (followUps.length > 0 && lastHasTools) {
                return (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-gray-400 pl-1">Dig in?</span>
                    <div className="flex flex-wrap gap-1.5">
                      {followUps.map(f => (
                        <button
                          key={f.label}
                          onClick={() => handleSend(f.prompt)}
                          className="text-[11px] font-roboto font-medium text-[#e6651b] bg-white border border-[#e6651b]/40 rounded-full px-3 py-1.5 hover:bg-[#e6651b]/10 active:scale-95 transition-all"
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              return null;
            })()}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Aircraft-switch banner — appears above the input when the
       * pilot changes tail mid-conversation. Re-offers the same
       * angles the FAB quick-prompts present. */}
      {showSwitchBanner && (
        <div className="mb-2 bg-[#e6651b]/5 border border-[#e6651b]/30 rounded-lg p-3 animate-fade-in">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-navy">
              Switched to <code className="font-mono text-[#e6651b] normal-case">{currentTail}</code>
              {' — '}want me to check?
            </span>
            <button
              onClick={() => setAcknowledgedTail(currentTail)}
              className="text-gray-400 hover:text-navy p-1 -m-1 shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {aircraftSwitchPrompts.map(p => (
              <button
                key={p.label}
                onClick={() => {
                  setAcknowledgedTail(currentTail);
                  setFollowUps([]);
                  setAwaitingAircraftChoice(false);
                  handleSend(p.prompt);
                }}
                className="text-[11px] font-roboto font-medium text-[#e6651b] bg-white border border-[#e6651b]/40 rounded-full px-3 py-1.5 hover:bg-[#e6651b]/10 active:scale-95 transition-all"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask Howard anything..."
          maxLength={2000}
          rows={1}
          disabled={isSending}
          className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-roboto text-navy resize-none focus:border-[#e6651b] outline-none disabled:opacity-50"
          style={{ backgroundColor: '#ffffff' }}
        />
        <button
          onClick={() => { setFollowUps([]); setAwaitingAircraftChoice(false); handleSend(); }}
          disabled={!input.trim() || isSending}
          className="bg-[#e6651b] text-white p-3 rounded-lg active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
