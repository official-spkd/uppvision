import React, { useEffect, useRef, useState } from 'react';
import { GripVertical, Minus, Maximize2, X } from 'lucide-react';

export default function FloatingWindow({ serial, title, index, active, onActivate, onClose, children }) {
  const element = useRef(null), drag = useRef(null);
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState(() => ({ x: Math.max(12, window.innerWidth - 540 - index * 28), y: 92 + index * 28 }));
  const clamp = (x, y) => {
    const rect = element.current?.getBoundingClientRect();
    return { x: Math.max(8, Math.min(x, window.innerWidth - (rect?.width || 520) - 8)), y: Math.max(8, Math.min(y, window.innerHeight - (rect?.height || 48) - 8)) };
  };
  useEffect(() => {
    element.current?.querySelector('.floating-titlebar')?.focus();
    const fit = () => setPosition(old => { const next = clamp(old.x, old.y); return old.x === next.x && old.y === next.y ? old : next; });
    const observer = new ResizeObserver(fit);
    if (element.current) observer.observe(element.current);
    window.addEventListener('resize', fit); fit();
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, []);
  const down = event => {
    if (event.button !== 0 || event.target.closest('button')) return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
  };
  const move = event => {
    if (!drag.current) return;
    setPosition(clamp(drag.current.left + event.clientX - drag.current.x, drag.current.top + event.clientY - drag.current.y));
  };
  const keyboardMove = event => {
    if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    setPosition(clamp(position.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), position.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)));
  };
  return <section ref={element} className={`floating-window ${active ? 'floating-active' : ''} ${minimized ? 'floating-minimized' : ''}`} data-device-window={serial} role="dialog" aria-label={`Layar ${title}`} style={{ left: position.x, top: position.y, zIndex: active ? 60 : 30 + index }} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
    <header className="floating-titlebar" tabIndex={0} aria-label={`Geser jendela ${title}; gunakan tombol panah untuk memindahkan`} onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={keyboardMove}>
      <GripVertical size={17} /><div><strong>{title}</strong><span>Geser bagian atas untuk memindahkan</span></div>
      <button type="button" className="icon-button" title={minimized ? 'Perbesar jendela' : 'Minimalkan jendela'} aria-label={minimized ? `Perbesar ${title}` : `Minimalkan ${title}`} onClick={() => setMinimized(value => !value)}>{minimized ? <Maximize2 size={16} /> : <Minus size={18} />}</button>
      <button type="button" className="icon-button" title="Tutup layar" aria-label={`Tutup layar ${title}`} onClick={onClose}><X size={18} /></button>
    </header>
    <div className="floating-contents" hidden={minimized}>{children}</div>
  </section>;
}
