import React from "react";

interface LinedPaperProps {
  className?: string;
}

export default function LinedPaper({ className = "" }: LinedPaperProps) {
  return (
    <div className={`${className}`}>
      <div
        className="mx-auto h-full max-w-4xl border border-gray-300 bg-white shadow-lg"
        style={{
          backgroundImage: `
            linear-gradient(to bottom, #e5e7eb 1px, transparent 1px),
            linear-gradient(to right, #ef4444 2px, transparent 2px)
          `,
          backgroundSize: "100% 24px, 80px 100%",
          backgroundPosition: "0 0, 40px 0",
          backgroundRepeat: "repeat-y, repeat-y",
        }}
      />
    </div>
  );
}
