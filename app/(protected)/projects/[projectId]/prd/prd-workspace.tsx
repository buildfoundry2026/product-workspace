"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Block } from "@blocknote/core";
import { savePrd } from "@/app/actions/prd";
import type { PrdEditorInstance } from "./prd-editor";

const PrdEditor = dynamic(() => import("./prd-editor"), {
  ssr: false,
  loading: () => <div className="min-h-[60vh] animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />,
});

type Props = {
  projectId: string;
  initialArtifact: { id: string; version: number; blocks: Block[] } | null;
  /** Null when generation is allowed; otherwise the reason it is not. */
  generateBlockedReason: string | null;
  readOnly: boolean;
};

type Phase = "idle" | "streaming" | "saving";
type Notice = { kind: "success" | "error" | "warning"; text: string };

export function PrdWorkspace({ projectId, initialArtifact, generateBlockedReason, readOnly }: Props) {
  const editorRef = useRef<PrdEditorInstance | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [streamed, setStreamed] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [savedArtifactId, setSavedArtifactId] = useState(initialArtifact?.id ?? null);
  const [savedVersion, setSavedVersion] = useState(initialArtifact?.version ?? null);
  const [dirty, setDirty] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);

  const handleReady = useCallback((editor: PrdEditorInstance) => {
    editorRef.current = editor;
  }, []);
  const handleChange = useCallback(() => setDirty(true), []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function generate() {
    if (dirty && !window.confirm("Replace the editor content with a new PRD? Unsaved edits will be lost.")) {
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("streaming");
    setStreamed("");
    setNotices([]);

    let text = "";
    try {
      const res = await fetch(`/api/projects/${projectId}/prd`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `PRD generation failed (${res.status}).`);
      }
      const newRunId = res.headers.get("X-Run-Id");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setStreamed(text);
      }
      text += decoder.decode();

      const markdown = stripCodeFence(text);
      const editor = editorRef.current;
      if (!markdown.trim()) throw new Error("The model returned an empty PRD. Try again.");
      if (!editor) throw new Error("The editor is still loading. Try again in a moment.");

      editor.replaceBlocks(editor.document, editor.tryParseMarkdownToBlocks(markdown));
      setRunId(newRunId);
      setDirty(true);
      setNotices([{ kind: "success", text: "PRD generated. Review and edit it, then save." }]);
    } catch (error) {
      const aborted = controller.signal.aborted;
      setNotices([
        {
          kind: aborted ? "warning" : "error",
          text: aborted
            ? "Generation cancelled. The editor was not changed."
            : `${error instanceof Error ? error.message : "PRD generation failed."} The editor was not changed.`,
        },
      ]);
    } finally {
      abortRef.current = null;
      setPhase("idle");
    }
  }

  async function save() {
    const editor = editorRef.current;
    if (!editor) return;
    const blocks = editor.document;
    const markdown = editor.blocksToMarkdownLossy(blocks);
    if (!markdown.trim()) {
      setNotices([{ kind: "error", text: "The PRD is empty. Generate or write content before saving." }]);
      return;
    }

    setPhase("saving");
    setNotices([]);
    try {
      const result = await savePrd({
        projectId,
        blocks,
        markdown,
        runId,
        previousArtifactId: savedArtifactId,
      });
      if (!result.ok) {
        setNotices([{ kind: "error", text: result.message }]);
        return;
      }
      setSavedArtifactId(result.artifactId);
      setSavedVersion(result.version);
      setRunId(null);
      setDirty(false);
      const next: Notice[] = [{ kind: "success", text: `Saved as version ${result.version}.` }];
      if (result.unknownCitations.length > 0) {
        next.push({
          kind: "warning",
          text: `These citations do not match any evidence and should be reviewed: ${result.unknownCitations
            .map((c) => `[${c}]`)
            .join(", ")}.`,
        });
      }
      setNotices(next);
    } catch {
      setNotices([{ kind: "error", text: "Could not reach the server. Your edits are still in the editor." }]);
    } finally {
      setPhase("idle");
    }
  }

  const streaming = phase === "streaming";
  const busy = phase !== "idle";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {savedVersion ? `Version ${savedVersion}` : "Not saved yet"}
          {dirty && <span className="text-amber-700 dark:text-amber-400"> · Unsaved changes</span>}
        </p>
        <div className="flex items-center gap-2">
          {streaming ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className={secondaryButton}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={generate}
              disabled={busy || readOnly || !!generateBlockedReason}
              title={generateBlockedReason ?? undefined}
              className={secondaryButton}
            >
              {savedVersion || dirty ? "Regenerate PRD" : "Generate PRD"}
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || readOnly || !dirty}
            aria-busy={phase === "saving"}
            className={primaryButton}
          >
            {phase === "saving" && <Spinner />}
            {phase === "saving" ? "Saving…" : "Save PRD"}
          </button>
        </div>
      </div>

      {generateBlockedReason && !readOnly && (
        <p className="text-sm text-zinc-500">{generateBlockedReason}</p>
      )}

      <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
        {notices.map((notice) => (
          <p
            key={notice.text}
            role={notice.kind === "error" ? "alert" : undefined}
            className={`rounded-lg border px-4 py-2 text-sm ${NOTICE_STYLES[notice.kind]}`}
          >
            {notice.text}
          </p>
        ))}
      </div>

      {streaming && (
        <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <Spinner dark />
            Writing PRD… it will open in the editor when finished.
          </p>
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            {streamed || "Waiting for the model…"}
          </pre>
        </div>
      )}

      <div
        className={`overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 ${streaming ? "hidden" : ""}`}
      >
        <PrdEditor
          initialBlocks={initialArtifact?.blocks ?? null}
          editable={!readOnly && !busy}
          onReady={handleReady}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}

/** Some models wrap the whole document in a ```markdown fence despite instructions. */
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```$/);
  return match ? match[1] : text;
}

function Spinner({ dark = false }: { dark?: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-3.5 animate-spin rounded-full border-2 ${
        dark
          ? "border-zinc-900/20 border-t-zinc-900 dark:border-zinc-100/20 dark:border-t-zinc-100"
          : "border-white/30 border-t-white dark:border-zinc-900/30 dark:border-t-zinc-900"
      }`}
    />
  );
}

const NOTICE_STYLES: Record<Notice["kind"], string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300",
  error: "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300",
};

const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800";

const primaryButton =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
