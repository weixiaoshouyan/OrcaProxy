import { useState, useEffect, useRef } from 'react';

const STREAM_THROTTLE_MS = 80;

/**
 * Throttles content updates during streaming to prevent expensive ReactMarkdown
 * re-rendering on every single character arrival.
 */
export function useStreamingThrottle(content: string, isStreaming: boolean): string {
  const [displayContent, setDisplayContent] = useState(content);
  const lastUpdateRef = useRef(0);
  const latestContentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestContentRef.current = content;
  }, [content]);

  useEffect(() => {
    if (!isStreaming || !content) {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      setDisplayContent(content);
      return;
    }

    const now = Date.now();
    if (now - lastUpdateRef.current >= STREAM_THROTTLE_MS) {
      // Gap long enough: flush immediately.
      lastUpdateRef.current = now;
      setDisplayContent(content);
    } else if (!timerRef.current) {
      // Schedule a single trailing flush; read the latest content at fire time.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastUpdateRef.current = Date.now();
        setDisplayContent(latestContentRef.current);
      }, STREAM_THROTTLE_MS);
    }
    // NOTE: no cleanup cancelling the timer here — cancelling on every content
    // change would reset the trailing flush during fast streaming.
  }, [content, isStreaming]);

  return displayContent;
}