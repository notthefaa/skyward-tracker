"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/authFetch";
import type { AircraftWithMetrics } from "@/lib/types";
import type { ChuckMessage } from "@/lib/chuck/types";
import useSWR from "swr";
import { Send, Loader2 } from "lucide-react";
import { ChuckIcon } from "@/components/shell/TrayIcons";
import { useToast } from "@/components/ToastProvider";

const SUGGESTIONS = [
  "What maintenance is coming due?",
  "Show me recent flight logs",
  "Any open squawks?",
  "When is my VOR check due?",
];

export default function ChuckTab({
  aircraft, session
}: {
  aircraft: AircraftWithMetrics | null;
  session: any;
}) {
  const { showError } = useToast();
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load conversation thread
  const { data, mutate } = useSWR(
    aircraft ? `chuck-${aircraft.id}` : null,
    async () => {
      const res = await authFetch(`/api/chuck?aircraftId=${aircraft!.id}`);
      if (!res.ok) throw new Error('Failed to load conversation');
      return await res.json() as { thread: any; messages: ChuckMessage[] };
    }
  );

  const messages = data?.messages || [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isSending]);

  // Auto-resize textarea
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

    // Optimistic update — add user message immediately
    const optimisticUserMsg: ChuckMessage = {
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

    try {
      const res = await authFetch('/api/chuck', {
        method: 'POST',
        body: JSON.stringify({ aircraftId: aircraft.id, message: msg }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to send message');
      }

      const { userMessage, assistantMessage } = await res.json();

      // Replace optimistic message with real data
      mutate(prev => {
        if (!prev) return prev;
        const filtered = prev.messages.filter(m => m.id !== 'pending-user');
        return { ...prev, messages: [...filtered, userMessage, assistantMessage] };
      }, false);
    } catch (err: any) {
      showError(err.message);
      // Remove optimistic message on failure
      mutate(prev => {
        if (!prev) return prev;
        return { ...prev, messages: prev.messages.filter(m => m.id !== 'pending-user') };
      }, false);
    } finally {
      setIsSending(false);
    }
  }, [input, aircraft, isSending, mutate, showError]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  if (!aircraft) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-full bg-[#0EA5E9]/10">
          <ChuckIcon size={24} style={{ color: '#0EA5E9' }} />
        </div>
        <div>
          <h2 className="font-oswald text-2xl md:text-3xl font-bold uppercase text-navy m-0 leading-none">Chuck</h2>
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#0EA5E9]">AI Copilot for {aircraft.tail_number}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-cream shadow-lg rounded-sm p-4 mb-3 min-h-[300px]">
        {messages.length === 0 && !isSending ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <ChuckIcon size={40} style={{ color: '#0EA5E9' }} />
            <p className="font-roboto text-sm text-navy mt-3 mb-1 font-bold">Hey, I&apos;m Chuck.</p>
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
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  msg.role === 'user'
                    ? 'bg-[#3AB0FF] text-white'
                    : 'bg-white border border-gray-200 text-navy'
                }`}>
                  <p className="font-roboto text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  <span className={`block text-[9px] mt-1 ${msg.role === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
            {isSending && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin text-[#0EA5E9]" />
                  <span className="text-xs text-gray-400 font-roboto">Chuck is thinking...</span>
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
          placeholder="Ask Chuck anything..."
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
