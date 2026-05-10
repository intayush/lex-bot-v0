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
    <div className="bg-white rounded-lg shadow sticky top-4">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <h3 className="font-semibold text-sm">Preview Chat</h3>
        <button onClick={reset} className="text-xs text-blue-600 hover:underline">Reset</button>
      </div>

      <div className="h-96 flex flex-col">
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && (
            <p className="text-xs text-gray-400 text-center mt-8">Send a message to test the chatbot...</p>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-2 rounded text-sm max-w-[85%] ${
                msg.role === 'user'
                  ? 'bg-blue-100 ml-auto'
                  : 'bg-gray-100'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {isLoading && (
            <div className="bg-gray-100 p-2 rounded text-sm text-gray-500">Typing...</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={handleSubmit} className="border-t p-2 flex gap-2">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Type a message..."
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
