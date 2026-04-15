"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { authFetch } from "@/lib/authFetch";
import { supabase } from "@/lib/supabase";
import type { AircraftWithMetrics } from "@/lib/types";
import type { HowardMessage } from "@/lib/howard/types";
import useSWR from "swr";
import { Send, Wrench, Globe, CloudSun, FileSearch, Database, BarChart3, Trash2 } from "lucide-react";
import { HowardIcon } from "@/components/shell/TrayIcons";
import { useToast } from "@/components/ToastProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import ProposedActionCard from "@/components/howard/ProposedActionCard";
import type { ProposedAction } from "@/lib/howard/proposedActions";

const SUGGESTIONS = [
  "What maintenance is coming due?",
  "Show me recent flight logs",
  "Any open squawks?",
  "When is my VOR check due?",
];

// Friendly label for tool-use indicator
function toolLabel(name: string): { label: string; Icon: any } {
  if (name === 'web_search') return { label: 'Searching the web', Icon: Globe };
  if (name === 'search_documents') return { label: 'Searching documents', Icon: FileSearch };
  if (name === 'get_weather_briefing' || name === 'get_aviation_hazards') return { label: 'Pulling weather', Icon: CloudSun };
  if (name.startsWith('get_')) return { label: 'Looking up ' + name.replace('get_', '').replace(/_/g, ' '), Icon: Database };
  return { label: 'Using ' + name, Icon: Wrench };
}

// Compact name for the tool-chip badge shown beneath finished assistant messages
function toolChipName(name: string): string {
  if (name === 'web_search') return 'web';
  if (name === 'search_documents') return 'docs';
  if (name === 'get_weather_briefing') return 'weather';
  if (name === 'get_aviation_hazards') return 'hazards';
  if (name === 'get_flight_logs') return 'flight logs';
  if (name === 'get_maintenance_items') return 'MX items';
  if (name === 'get_squawks') return 'squawks';
  if (name === 'get_service_events') return 'service';
  if (name === 'get_notes') return 'notes';
  if (name === 'get_reservations') return 'reservations';
  if (name === 'get_vor_checks') return 'VOR';
  if (name === 'get_tire_and_oil_logs') return 'tire/oil';
  if (name === 'get_system_settings') return 'settings';
  if (name === 'get_event_line_items') return 'line items';
  return name.replace(/_/g, ' ');
}

export default function HowardTab({
  aircraft, session
}: {
  aircraft: AircraftWithMetrics | null;
  session: any;
}) {
  const { showError, showSuccess } = useToast();
  const confirm = useConfirm();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data, mutate } = useSWR(
    aircraft ? `howard-${aircraft.id}` : null,
    async () => {
      const res = await authFetch(`/api/howard?aircraftId=${aircraft!.id}`);
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
    threadId ? `howard-actions-${threadId}` : null,
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
    if (!msg || !aircraft || isSending) return;

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
    mutate(prev => prev ? { ...prev, messages: [...prev.messages, optimisticUserMsg] } : prev, false);

    // Hoisted so the catch block can recover partial state if the stream
    // errors mid-response.
    let savedUserMsg: HowardMessage | null = null;
    let savedAssistantMsg: HowardMessage | null = null;
    let accumulated = '';

    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const res = await fetch('/api/howard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : {}),
        },
        body: JSON.stringify({ aircraftId: aircraft.id, message: msg }),
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
  }, [input, aircraft, isSending, mutate, mutateActions, showError]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleClearThread = useCallback(async () => {
    if (!aircraft || isSending) return;
    const ok = await confirm({
      title: 'Clear conversation?',
      message: `This will permanently delete your entire chat history with Howard for ${aircraft.tail_number}. Usage totals are unaffected.`,
      confirmText: 'Clear',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch(`/api/howard?aircraftId=${aircraft.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to clear conversation');
      mutate({ thread: null, messages: [] }, false);
      showSuccess('Conversation cleared.');
    } catch (err: any) {
      showError(err.message);
    }
  }, [aircraft, isSending, confirm, mutate, showSuccess, showError]);

  // Prefill handoff from AskHoward buttons elsewhere in the app.
  // sessionStorage key "aft_howard_prefill" (JSON: {prompt, autoSend})
  useEffect(() => {
    if (!aircraft || isSending) return;
    try {
      const raw = sessionStorage.getItem('aft_howard_prefill');
      if (!raw) return;
      sessionStorage.removeItem('aft_howard_prefill');
      const { prompt, autoSend } = JSON.parse(raw);
      if (typeof prompt !== 'string' || !prompt.trim()) return;
      if (autoSend) {
        handleSend(prompt);
      } else {
        setInput(prompt);
        textareaRef.current?.focus();
      }
    } catch {}
  }, [aircraft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aircraft) return null;

  const toolInfo = activeToolName ? toolLabel(activeToolName) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-full bg-[#0EA5E9]/10 shrink-0">
            <HowardIcon size={24} style={{ color: '#0EA5E9' }} />
          </div>
          <div className="min-w-0">
            <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Howard</h2>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#0EA5E9] truncate block">AI Copilot for {aircraft.tail_number}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('aft:navigate-howard-usage'))}
            title="View Howard usage"
            aria-label="View Howard usage"
            className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-[#0EA5E9] active:scale-95 transition-colors"
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-cream shadow-lg rounded-sm p-4 mb-3 min-h-[300px]">
        {messages.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <HowardIcon size={40} style={{ color: '#0EA5E9' }} />
            <p className="font-roboto text-sm text-navy mt-3 mb-1 font-bold">Hey, I&apos;m Howard.</p>
            <p className="font-roboto text-xs text-gray-500 mb-4 max-w-xs">
              I can look up your flight logs, maintenance items, squawks, VOR checks, and more. Ask me anything about {aircraft.tail_number}.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="text-[11px] font-roboto font-medium text-[#0EA5E9] bg-white border border-[#0EA5E9]/30 rounded-full px-3 py-1.5 hover:bg-[#0EA5E9]/5 active:scale-95 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map(msg => {
              const toolNames: string[] = msg.role === 'assistant' && Array.isArray(msg.tool_calls)
                ? Array.from(new Set((msg.tool_calls as any[]).map(t => t.name).filter(Boolean)))
                : [];

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
                    <p className="font-roboto text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {toolNames.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {toolNames.map(n => (
                          <span key={n} className="text-[8.5px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[#0EA5E9]/10 text-[#0EA5E9] border border-[#0EA5E9]/20">
                            {toolChipName(n)}
                          </span>
                        ))}
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
                    <div className="flex items-center gap-1.5 mb-1.5 text-[#0EA5E9]">
                      <toolInfo.Icon size={12} className="animate-pulse" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">{toolInfo.label}…</span>
                    </div>
                  )}
                  {streamingText && (
                    <p className="font-roboto text-sm whitespace-pre-wrap leading-relaxed">
                      {streamingText}
                      <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-[#0EA5E9] align-middle animate-pulse" />
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Pre-stream thinking indicator */}
            {isSending && !streamingText && !toolInfo && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0EA5E9] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

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
          className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-roboto text-navy resize-none focus:border-[#0EA5E9] outline-none disabled:opacity-50"
          style={{ backgroundColor: '#ffffff' }}
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isSending}
          className="bg-[#0EA5E9] text-white p-3 rounded-lg active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
