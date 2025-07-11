// src/components/ClientList.tsx

"use client";
//*******************************************************************************************/
// This component uses Zustand (a lightweight state manager) to persist selected client IDs
// across navigation. When users select clients via checkboxes, their selections are stored
// in a global store (useClientSelection.ts).
// This allows us to:
// - keep selections when navigating to /clients/[id]/edit, or /clients/new
// - restore checkbox states after returning from those views
// - avoid passing state via the URL (e.g., ?ids=...) after the initial navigation
//*******************************************************************************************/

import { Suspense } from "react";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Spinner from "./ui/Spinner";
import ClientCard from "./ClientCard";
import EmptyState from "./ui/EmptyState";
import ClientListHeader from "./ClientListHeader";
import { useClientSelection } from "@/store/useClientSelection";
import { useCanvasStore } from "@/store/useCanvasStore";
import { signIn } from "next-auth/react";

type Client = {
  id: number;
  name: string;
  address?: string | null;
  industry?: string | null;
  logoBlob?: string | null;
  logoType?: string | null;
};

const LIMIT = 20;

export default function ClientList() {
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(10); // countdown to redirect --> '/'

  const router = useRouter();
  const searchParams = useSearchParams();

  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const selectedClients = useClientSelection((s) => s.selectedClients);
  const toggleClient = useClientSelection((s) => s.toggleClient);
  //
  const resetSelection = useClientSelection((s) => s.resetSelection);
  const resetCanvas = useCanvasStore((s) => s.resetCanvas);

  // Resets the selections and canvas
  const handleReset = () => {
    resetSelection(); // cleans up selections
    resetCanvas([]); // clears canvas to empty (no logo = empty layout)
  };

  const allVisibleSelected =
    clients.length > 0 && clients.every((c) => selectedClients.includes(c.id));
  const handleSelectAllVisible = () => {
    const visibleIds = clients.map((c) => c.id);
    if (allVisibleSelected) {
      // Deselect all visible
      visibleIds.forEach((id) => {
        if (selectedClients.includes(id)) toggleClient(id);
      });
    } else {
      // Select all visible
      visibleIds.forEach((id) => {
        if (!selectedClients.includes(id)) toggleClient(id);
      });
    }
  };

  // redirect --> '/'
  // Automatic redirect if not logged in
  useEffect(() => {
    if (error && error.toLowerCase().includes("logged in")) {
      const interval = setInterval(() => {
        setCountdown((c) => c - 1);
      }, 1000);

      if (countdown <= 1) {
        router.push("/");
      }

      return () => clearInterval(interval);
    }
  }, [error, countdown, router]);

  // We assemble the query string from filters
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    const name = searchParams.get("name");
    const industry = searchParams.get("industry");
    if (name) params.set("name", name);
    if (industry) params.set("industry", industry);
    return params.toString();
  }, [searchParams]);

  // Reset of customer list when changing filters
  useEffect(() => {
    setClients([]);
    setPage(0);
    setHasMore(true);
  }, [queryString]);

  // Downloading clients from the API (base64)
  // Fetch clients, ONLY when the page or queryString changes!
  useEffect(() => {
    const controller = new AbortController();

    const fetchClients = async () => {
      if (!hasMore && page > 0) return;
      setLoading(true);
      setError(null);

      const params = new URLSearchParams(queryString);
      params.set("skip", String(page * LIMIT));
      params.set("limit", String(LIMIT));
      try {
        const res = await fetch(`/api/clients?${params.toString()}`, {
          signal: controller.signal,
        });

        let data: Client[] | { error: string } = [];
        try {
          data = await res.json();
        } catch {
          setError("Error parsing response from server.");
          setClients([]);
          return;
        }

        if (!res.ok) {
          // Special handling 401
          if ("error" in data && res.status === 401) {
            setError("You must be logged in to view customers.");
          } else {
            setError(
              typeof data === "object" && "error" in data
                ? data.error
                : "Error downloading clients."
            );
          }
          setClients([]);
          setHasMore(false);
          return;
        }

        if (!Array.isArray(data)) {
          setError("Unexpected response from API.");
          setClients([]);
          setHasMore(false);
          return;
        }

        setClients((prev) => {
          const ids = new Set(prev.map((c) => c.id));
          const newClients = data.filter((c) => !ids.has(c.id));
          return page === 0 ? newClients : [...prev, ...newClients];
        });

        if (data.length < LIMIT) {
          setHasMore(false);
        }
      } catch (err) {
        // typing errors
        if (
          typeof err === "object" &&
          err !== null &&
          "name" in err &&
          (err as { name: string }).name !== "AbortError"
        ) {
          setError("Network or API connection error.");
          setClients([]);
          setHasMore(false);
          // log error if you want
        }
      } finally {
        setLoading(false);
      }
    };

    fetchClients();
    return () => controller.abort();
  }, [page, queryString]);

  // Infinite scroll
  const lastClientRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (loading || !hasMore) return;

      if (observerRef.current) observerRef.current.disconnect();

      observerRef.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setPage((prev) => prev + 1);
        }
      });

      if (node) observerRef.current.observe(node);
    },
    [loading, hasMore]
  );

  // Move to generate and clear the selection
  const handleGenerate = () => {
    if (selectedClients.length > 0) {
      const query = new URLSearchParams();
      query.set("ids", selectedClients.join(","));

      const name = searchParams.get("name");
      const industry = searchParams.get("industry");
      if (name) query.set("name", name);
      if (industry) query.set("industry", industry);

      resetSelection(); // deletes selection - checkboxes status!

      router.push(`/generate?${query.toString()}`);
    }
  };

  return (
    <Suspense
      fallback={
        <div className="flex justify-center my-6">
          <Spinner />
        </div>
      }
    >
      <div>
        {error ? (
          <div className="flex flex-col items-center text-yellow-500 text-center py-10 font-semibold gap-4">
            <div>{error}</div>
            {error.toLowerCase().includes("logged in") && (
              <>
                <button
                  onClick={() => signIn("google")}
                  className="px-5 py-2 mt-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md shadow font-semibold"
                >
                  Log in with Google
                </button>
                <div className="mt-4 text-gray-300">
                  You will be redirected to the homepage in{" "}
                  <span className="font-bold text-white">{countdown}</span>s...
                </div>
                {/* animated bar here */}
                <div className="w-32 h-2 bg-gray-700 mt-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-500 transition-all"
                    style={{ width: `${(countdown / 10) * 100}%` }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <ClientListHeader
              selectedCount={selectedClients.length}
              onReset={handleReset}
              onGenerate={handleGenerate}
              layout={layout}
              onToggleLayout={() =>
                setLayout((prev) => (prev === "grid" ? "list" : "grid"))
              }
              onSelectAll={handleSelectAllVisible}
              allSelected={allVisibleSelected}
            />

            <div
              className={`grid gap-6 ${
                layout === "grid" ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"
              }`}
            >
              {clients.map((client, index) => {
                const isLast = index === clients.length - 1;
                return (
                  <div key={client.id} ref={isLast ? lastClientRef : null}>
                    <ClientCard
                      id={client.id}
                      name={client.name}
                      industry={client.industry}
                      logoBlob={client.logoBlob}
                      logoType={client.logoType}
                      selected={selectedClients.includes(client.id)}
                      toggle={() => toggleClient(client.id)}
                      queryString={queryString}
                      selectedIds={selectedClients}
                    />
                  </div>
                );
              })}
            </div>

            {!loading && clients.length === 0 && (
              <EmptyState message="No clients found matching the selected filters." />
            )}

            {loading && (
              <div className="flex justify-center my-6">
                <Spinner />
              </div>
            )}
          </>
        )}
      </div>
    </Suspense>
  );
}
