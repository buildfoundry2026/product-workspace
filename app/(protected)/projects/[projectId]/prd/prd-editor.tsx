"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useEffect } from "react";
import type { Block, BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

export type PrdEditorInstance = BlockNoteEditor;

type Props = {
  /** Saved BlockNote document to start from; only read on mount. */
  initialBlocks: Block[] | null;
  editable: boolean;
  onReady: (editor: PrdEditorInstance) => void;
  onChange: () => void;
};

/** BlockNote is browser-only; load this via next/dynamic with ssr: false. */
export default function PrdEditor({ initialBlocks, editable, onReady, onChange }: Props) {
  const editor = useCreateBlockNote({
    initialContent: initialBlocks && initialBlocks.length > 0 ? initialBlocks : undefined,
  });

  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={onChange}
      theme="light"
      className="min-h-[60vh] py-4"
    />
  );
}
