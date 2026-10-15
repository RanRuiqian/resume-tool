import { useEffect, useRef, useState } from 'react';
import { useL } from '../i18n';

const VIEW_H = 320;
/** 照片裁剪：比例（证件照 3:4 / 方形 1:1）、缩放、拖动定位；输出 JPEG data URL */
export function PhotoCropper({ src, onDone, onCancel }: { src: string; onDone: (dataUrl: string, aspect: number) => void; onCancel: () => void }) {
  const L = useL();
  const [aspect, setAspect] = useState(0.75);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState<{ x: number; y: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const viewW = Math.round(VIEW_H * aspect);

  useEffect(() => { const i = new Image(); i.onload = () => setImg(i); i.src = src; }, [src]);
  // 基础缩放：图片恰好覆盖裁剪框
  const base = img ? Math.max(viewW / img.width, VIEW_H / img.height) : 1;
  const sc = base * zoom;
  const w = (img?.width ?? 0) * sc, h = (img?.height ?? 0) * sc;
  const clamp = (o: { x: number; y: number }) => ({ x: Math.min(0, Math.max(viewW - w, o.x)), y: Math.min(0, Math.max(VIEW_H - h, o.y)) });
  const pos = clamp(off ?? { x: (viewW - w) / 2, y: (VIEW_H - h) / 2 });

  const done = () => {
    if (!img) return;
    const outH = 800, outW = Math.round(outH * aspect), k = outH / VIEW_H;
    const c = document.createElement('canvas'); c.width = outW; c.height = outH;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(img, pos.x * k, pos.y * k, w * k, h * k);
    onDone(c.toDataURL('image/jpeg', 0.88), aspect);
  };
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal cropper" onClick={(e) => e.stopPropagation()}>
        <h3>{L('调整照片', 'Adjust photo')}</h3>
        <div className="row">
          {[[0.75, L('证件照 3:4', 'ID photo 3:4')], [1, L('方形 1:1', 'Square 1:1')]].map(([a, t]) => (
            <button key={String(a)} className={aspect === a ? 'active' : ''} onClick={() => { setAspect(a as number); setOff(null); }}>{t}</button>
          ))}
        </div>
        <div className="crop-view" style={{ width: viewW, height: VIEW_H }}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y }; }}
          onPointerMove={(e) => { if (drag.current) setOff(clamp({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })); }}
          onPointerUp={() => { drag.current = null; }}
          onWheel={(e) => setZoom((z) => Math.min(4, Math.max(1, z - e.deltaY * 0.002)))}>
          {img && <img src={src} draggable={false} style={{ width: w, height: h, transform: `translate(${pos.x}px, ${pos.y}px)` }} />}
        </div>
        <label>{L('缩放', 'Zoom')}<input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        <div className="muted small">{L('拖动图片调整位置，滚轮或滑块缩放。', 'Drag to position; use the wheel or slider to zoom.')}</div>
        <div className="row end"><button onClick={onCancel}>{L('取消', 'Cancel')}</button><button className="primary" disabled={!img} onClick={done}>{L('使用这张照片', 'Use photo')}</button></div>
      </div>
    </div>
  );
}
