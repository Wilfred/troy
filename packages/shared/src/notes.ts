// NOTES.md read/write helpers shared between the Troy and Duck bots.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Read the current contents of NOTES.md, or an empty string if it does not
// exist yet.
export function readNotes(notesPath: string): string {
  return existsSync(notesPath) ? readFileSync(notesPath, "utf-8") : "";
}

// Append text to the end of NOTES.md, creating the file if needed.
export function appendNote(notesPath: string, content: string): string {
  writeFileSync(notesPath, readNotes(notesPath) + content, "utf-8");
  return "Done.";
}

// Replace the first occurrence of oldText in NOTES.md with newText. Returns an
// error string if oldText is not present (or the file does not exist).
export function editNote(
  notesPath: string,
  oldText: string,
  newText: string,
): string {
  const current = readNotes(notesPath);
  if (!current.includes(oldText)) {
    return "Error: old_text not found in NOTES.md.";
  }
  writeFileSync(notesPath, current.replace(oldText, newText), "utf-8");
  return "Done.";
}
