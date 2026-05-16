'use client';

import { useChat } from '@ai-sdk/react';
import { useRef, useEffect, useState } from 'react';

export function PreviewChat() {
  const [sessionKey, setSessionKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    id: `preview-${sessionKey}`,
    api: '/api/chat',
    headers: {
      'x-api-key': 'dev_test_key',
      'x-preview': 'true',
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const reset = () => setSessionKey((k) => k + 1);

  return (
    <div className="bg-white rounded-xl border border-[#E5E5E5] sticky top-8">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[#E5E5E5] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#171717]">Preview Chat</h3>
        <button
          onClick={reset}
          className="text-xs text-[#2563EB] hover:text-[#1D4ED8] font-medium transition"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col">
        {/* Messages */}
        <div className="h-[420px] overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="mb-3">
                <rect x="2" y="4" width="28" height="20" rx="4" stroke="#A3A3A3" strokeWidth="1.5" />
                <path d="M10 28L6 24h20l-4 4H10Z" stroke="#A3A3A3" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
              <p className="text-sm text-[#A3A3A3]">Test your chatbot</p>
              <p className="text-xs text-[#A3A3A3] mt-1 max-w-[180px]">Send a message to preview how it responds</p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`px-4 py-2.5 text-sm max-w-[85%] ${
                  msg.role === 'user'
                    ? 'bg-[#2563EB] text-white rounded-2xl rounded-br-md ml-auto'
                    : 'bg-[#F5F5F5] text-[#171717] rounded-2xl rounded-bl-md'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-[#F5F5F5] px-4 py-2.5 rounded-2xl rounded-bl-md inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#A3A3A3] animate-pulse" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A3A3A3] animate-pulse [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[#A3A3A3] animate-pulse [animation-delay:0.4s]" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-[#E5E5E5] p-3 flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 text-sm focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] outline-none transition"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5" />
              <path d="M5 12l7-7 7 7" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
