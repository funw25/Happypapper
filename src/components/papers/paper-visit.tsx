"use client";

import { useEffect } from "react";

// Serialize first visits so the signed visitor cookie is available before a
// second route records a view. Prefetching server components never counts.
let visits = Promise.resolve();
export function PaperVisit({ paperId }: { paperId: string }) {
  useEffect(() => {
    visits = visits.then(async () => {
      await fetch(`/api/papers/${paperId}/visit`, { method: "POST" });
    }).catch(() => {});
  }, [paperId]);
  return null;
}
