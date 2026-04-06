"use client";

import { LayoutGrid, List, Table } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export type ViewMode = "grid" | "list" | "table";

interface ViewToggleProps {
  currentView: ViewMode;
  onChange: (view: ViewMode) => void;
}

export function ViewToggle({ currentView, onChange }: ViewToggleProps) {
  return (
    <div className="flex items-center gap-1 border rounded-lg p-1">
      <Button
        variant={currentView === "grid" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("grid")}
        className={cn(
          "h-8 w-8 p-0",
          currentView === "grid" && "bg-blue-600 text-white hover:bg-blue-700"
        )}
        aria-label="Grid view"
      >
        <LayoutGrid className="h-4 w-4" />
      </Button>
      <Button
        variant={currentView === "list" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("list")}
        className={cn(
          "h-8 w-8 p-0",
          currentView === "list" && "bg-blue-600 text-white hover:bg-blue-700"
        )}
        aria-label="List view"
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        variant={currentView === "table" ? "default" : "ghost"}
        size="sm"
        onClick={() => onChange("table")}
        className={cn(
          "h-8 w-8 p-0",
          currentView === "table" && "bg-blue-600 text-white hover:bg-blue-700"
        )}
        aria-label="Table view"
      >
        <Table className="h-4 w-4" />
      </Button>
    </div>
  );
}
