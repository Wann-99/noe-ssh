import { useCallback, useRef, useState } from 'react';

type Props = {
  /** vertical = drag left/right to change width */
  orientation?: 'vertical' | 'horizontal';
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  /** When true, drag increases size when moving left (for right-side panels) */
  reverse?: boolean;
};

export function Splitter({
  orientation = 'vertical',
  onDrag,
  onDragEnd,
  reverse = false,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const lastPos = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    lastPos.current = orientation === 'vertical' ? e.clientX : e.clientY;
    setDragging(true);
    document.body.classList.add('splitter-active');
  }, [orientation]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const pos = orientation === 'vertical' ? e.clientX : e.clientY;
    const raw = pos - lastPos.current;
    lastPos.current = pos;
    if (raw === 0) return;
    onDrag(reverse ? -raw : raw);
  }, [dragging, onDrag, orientation, reverse]);

  const endDrag = useCallback(() => {
    if (!dragging) return;
    setDragging(false);
    document.body.classList.remove('splitter-active');
    onDragEnd?.();
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('ssh-layout-resize'));
  }, [dragging, onDragEnd]);

  return (
    <div
      className={`splitter splitter-${orientation}${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
