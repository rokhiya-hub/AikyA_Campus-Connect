import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client.js";
export function useCampusChat(initial = []) {
  const [messages, setMessages] = useState(initial),
    [loading, setLoading] = useState(false),
    [allowExternalAI, setExternal] = useState(false);
  const request = useRef(null),
    mounted = useRef(true),
    busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const send = useCallback(
    async (question) => {
      const text = question.trim();
      if (!text || text.length > 1000 || busy.current) return;
      const external = allowExternalAI;
      setExternal(false);
      busy.current = true;
      setLoading(true);
      setMessages((previous) => [...previous, { role: "user", text }]);
      const controller = new AbortController();
      request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 18000);
      try {
        const result = await api.sendChatMessage(
          text,
          external,
          controller.signal,
        );
        if (mounted.current)
          setMessages((previous) => [
            ...previous,
            {
              role: "answer",
              text: result.answer,
              status: result.status,
              notices: result.notices || [],
              sources: result.sources || [],
              retryable: result.retryable,
              question: text,
              escalated: result.escalated,
            },
          ]);
      } catch (error) {
        if (mounted.current)
          setMessages((previous) => [
            ...previous,
            {
              role: "answer",
              text:
                error.status === 429
                  ? "The campus assistant is busy. Wait a moment, then retry."
                  : controller.signal.aborted
                    ? "The campus assistant timed out. Please retry."
                    : "The campus service is unavailable. Please retry or browse the directories.",
              status: "unavailable",
              sources: [],
              retryable:
                !error.status || error.status === 429 || error.status >= 500,
              question: text,
            },
          ]);
      } finally {
        clearTimeout(timeout);
        busy.current = false;
        if (mounted.current) setLoading(false);
      }
    },
    [allowExternalAI],
  );
  return { messages, loading, send, allowExternalAI, setExternal };
}
