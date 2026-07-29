/** Direct terminal write bridge — avoids CustomEvent alloc on every PTY chunk. */

export type TermWriteHandler = (
  sessionId: string,
  terminalId: string,
  data: string | Uint8Array,
) => void;

let writeHandler: TermWriteHandler | null = null;

export function setTermWriteHandler(handler: TermWriteHandler | null) {
  writeHandler = handler;
}

export function emitTermWrite(
  sessionId: string,
  terminalId: string,
  data: string | Uint8Array,
) {
  writeHandler?.(sessionId, terminalId, data);
}
