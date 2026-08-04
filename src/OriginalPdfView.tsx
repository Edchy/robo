import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './OriginalPdfView.css';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
type HighlightRect = { left: number; top: number; width: number; height: number };

export default function OriginalPdfView({
  file,
  highlight,
  open,
  onClose,
}: {
  file: File;
  highlight: string;
  open: boolean;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PdfDocument | null>(null);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [highlights, setHighlights] = useState<HighlightRect[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = window.document.activeElement as HTMLElement | null;
    const panel = closeButton.current?.closest('.original-pdf');
    const shell = panel?.parentElement;
    // Everything beside the panel goes inert while the viewer is open, so focus
    // and the screen reader stay inside it.
    const background = Array.from(shell?.children ?? []).filter(
      (element) => element !== panel
    ) as HTMLElement[];
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    background.forEach((element) => {
      element.inert = true;
    });
    window.document.body.classList.add('pdf-view-is-open');
    window.addEventListener('keydown', onKeyDown);
    closeButton.current?.focus();
    return () => {
      window.document.body.classList.remove('pdf-view-is-open');
      window.removeEventListener('keydown', onKeyDown);
      background.forEach((element) => {
        element.inert = false;
      });
      previousFocus?.focus();
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let loaded: PdfDocument | null = null;
    setLoading(true);
    setError(null);
    setZoom(1);
    setHighlights([]);

    void file
      .arrayBuffer()
      .then((buffer) => pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise)
      .then((pdf) => {
        loaded = pdf;
        if (!cancelled) setDocument(pdf);
      })
      .catch(() => {
        if (!cancelled) setError('Kunde inte visa originalfilen. Välj PDF-filen igen.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      setDocument(null);
      void loaded?.destroy();
    };
  }, [file, open]);

  useEffect(() => {
    if (!open || !viewer.current) return;
    const element = viewer.current;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!document || !canvas.current || width === 0) return;
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']> | null = null;

    setHighlights([]);
    void document.getPage(1).then(async (pdfPage) => {
      if (cancelled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.min(832, Math.max(280, width - 32));
      const cssScale = (availableWidth / base.width) * zoom;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const cssViewport = pdfPage.getViewport({ scale: cssScale });
      const renderViewport = pdfPage.getViewport({ scale: cssScale * pixelRatio });
      const element = canvas.current;
      const context = element.getContext('2d');
      if (!context) return;

      element.width = Math.floor(renderViewport.width);
      element.height = Math.floor(renderViewport.height);
      element.style.width = `${cssViewport.width}px`;
      element.style.height = `${cssViewport.height}px`;
      setPageSize({ width: cssViewport.width, height: cssViewport.height });

      renderTask = pdfPage.render({ canvasContext: context, viewport: renderViewport });
      const [content] = await Promise.all([pdfPage.getTextContent(), renderTask.promise]);
      if (cancelled) return;

      const matches = content.items.flatMap((item) => {
        if (!('str' in item) || item.str.trim() !== highlight || !item.transform) return [];
        const itemWidth = Math.max(item.width + 16, 28);
        const itemHeight = Math.max(item.height + 4, 11);
        const itemX = item.transform[4] - (itemWidth - item.width) / 2;
        const itemY = item.transform[5] - (itemHeight - item.height) / 2;
        const [x1, y1, x2, y2] = cssViewport.convertToViewportRectangle([
          itemX,
          itemY,
          itemX + itemWidth,
          itemY + itemHeight,
        ]);
        return [{
          left: Math.min(x1, x2),
          top: Math.min(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
        }];
      });
      setHighlights(matches);
    }).catch((reason: unknown) => {
      if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) {
        setError('Kunde inte rita den här sidan i PDF-filen.');
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [document, highlight, width, zoom]);

  return (
    <section
      className={`original-pdf ${open ? 'original-pdf--open' : ''}`}
      aria-label="Original-PDF"
      aria-hidden={!open}
    >
      <header className="original-pdf__header">
        <div className="original-pdf__header-inner">
          <button
            ref={closeButton}
            className="original-pdf__back"
            onClick={onClose}
            aria-label="Till schemat"
          >
            <ArrowLeftIcon />
          </button>
          <div className="original-pdf__identity">
            <strong>Original-PDF</strong>
            <span title={file.name}>{file.name}</span>
          </div>
          <span className="original-pdf__local"><LockIcon /> Bara på enheten</span>
        </div>
      </header>

      <div
        ref={viewer}
        className={`original-pdf__viewer ${zoom > 1 ? 'original-pdf__viewer--zoomed' : ''}`}
      >
        {loading && <div className="original-pdf__status" role="status">Öppnar originalet…</div>}
        {error && <div className="original-pdf__status original-pdf__status--error" role="alert">{error}</div>}
        {!loading && !error && (
          <div
            className="original-pdf__page"
            style={{ width: pageSize.width, height: pageSize.height }}
          >
            <canvas ref={canvas} aria-label="Original-PDF" />
            {highlights.map((rect, index) => (
              <span
                key={index}
                className="original-pdf__highlight"
                style={rect}
                aria-hidden="true"
              />
            ))}
          </div>
        )}
      </div>

      <footer className="original-pdf__controls">
        <div className="original-pdf__zoom" aria-label="Zoom">
          <button onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={zoom <= 1} aria-label="Zooma ut">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} disabled={zoom >= 2.5} aria-label="Zooma in">+</button>
        </div>
      </footer>
    </section>
  );
}

const ArrowLeftIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.5 8h-10M7 4.5 3.5 8 7 11.5" />
  </svg>
);

const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);
