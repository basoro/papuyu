import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface TerminalProps {
  logs: string[];
  className?: string;
}

export function Terminal({ logs, className = "" }: TerminalProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  return (
    <div className={`terminal max-h-80 ${className}`}>
      {logs.length === 0 && (
        <span className="text-muted-foreground">No logs available.</span>
      )}
      <AnimatePresence>
        {logs.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="leading-6"
          >
            <span className="text-muted-foreground select-none mr-3 text-xs">{String(i + 1).padStart(3, " ")}</span>
            <span className={line.includes("error") || line.includes("failed") ? "text-destructive" : line.includes("Successfully") || line.includes("running") ? "text-success" : "text-foreground"}>
              {line}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}
