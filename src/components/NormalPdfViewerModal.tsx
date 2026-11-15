import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as PdfjsTypes from 'pdfjs-dist';
import {
  Download,
  ExternalLink,
  FileText,
  Loader2,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

interface NormalPdfViewerModalProps {
  url: string;
  title: string;
  fileName?: string;
  onClose: () => void;
}

interface PdfPageCanvasProps {
  pdfDoc: PdfjsTypes.PDFDocumentProxy;
  pageNumber: number;
  containerWidth: number;
  zoom: number;
  onVisible?: (pageNum: number) => void;
}

function ensurePdfBrowserPolyfills() {
  if (
    typeof Promise !== 'undefined' &&
    typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function'
  ) {
    (
      Promise as unknown as {
        withResolvers: <T>() => {
          promise: Promise<T>;
          resolve: (v: T | PromiseLike<T>) => void;
          reject: (r?: unknown) => void;
        };
      }
    ).withResolvers = function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  containerWidth,
  zoom,
  onVisible,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(pageNumber <= 3);
  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({
    width: Math.max(300, Math.min(860, containerWidth - 24)),
    height: Math.round(Math.max(300, Math.min(860, containerWidth - 24)) * 1.414),
  });
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsVisible(true);
            if (entry.intersectionRatio >= 0.35) {
              onVisible?.(pageNumber);
            }
          }
        }
      },
      { rootMargin: '800px 0px', threshold: [0, 0.35] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageNumber, onVisible]);

  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    let renderTask: PdfjsTypes.RenderTask | null = null;

    void (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const targetDisplayWidth =
          Math.max(280, Math.min(980, containerWidth - 24)) * zoom;
        const cssScale = targetDisplayWidth / Math.max(1, baseViewport.width);
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const renderViewport = page.getViewport({ scale: cssScale * dpr });

        const displayW = Math.round(baseViewport.width * cssScale);
        const displayH = Math.round(baseViewport.height * cssScale);

        setPageSize({
          width: displayW,
          height: displayH,
        });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${displayW}px`;
        canvas.style.height = `${displayH}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;

        renderTask = page.render({
          canvas,
          canvasContext: ctx,
          viewport: renderViewport,
        });
        await renderTask.promise;
        if (!cancelled) setIsRendered(true);
      } catch {
        // Ignore cancelled render task errors during zoom/unmount
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore
      }
    };
  }, [pdfDoc, pageNumber, containerWidth, zoom, isVisible]);

  return (
    <div
      ref={wrapperRef}
      style={{
        width: `${pageSize.width}px`,
        minHeight: `${pageSize.height}px`,
      }}
      className="relative mx-auto bg-white rounded-xl shadow-2xl overflow-hidden border border-slate-700/60"
    >
      <canvas ref={canvasRef} className="block bg-white" />
      {!isRendered && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/5 text-slate-500 text-xs font-bold gap-1.5">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
          <span>Rendering Page {pageNumber}...</span>
        </div>
      )}
      <div className="absolute bottom-2 right-2.5 px-2 py-0.5 rounded-md bg-slate-900/75 text-white text-[10px] font-mono-tabular font-bold pointer-events-none">
        Page {pageNumber}
      </div>
    </div>
  );
};

export const NormalPdfViewerModal: React.FC<NormalPdfViewerModalProps> = ({
  url,
  title,
  fileName,
  onClose,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PdfjsTypes.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(1);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 900
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'native'>('canvas');
  const [reloadNonce, setReloadNonce] = useState<number>(0);
  const [localBlobUrl, setLocalBlobUrl] = useState<string | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);

  const suggestedDownloadName = useMemo(() => {
    const raw = (fileName || title || 'Vs_Tests_Document').trim();
    return raw.toLowerCase().endsWith('.pdf') ? raw : `${raw}.pdf`;
  }, [fileName, title]);

  const handleDownloadPdf = useCallback(async () => {
    if (!url || isDownloading) return;
    setIsDownloading(true);
    try {
      let blobUrlToUse = localBlobUrl;
      let createdTempUrl = false;

      if (!blobUrlToUse) {
        if (pdfBytesRef.current && pdfBytesRef.current.byteLength > 0) {
          const blob = new Blob([pdfBytesRef.current], { type: 'application/pdf' });
          blobUrlToUse = URL.createObjectURL(blob);
          createdTempUrl = true;
        } else {
          const fetchUrl =
            url.startsWith('data:') || url.startsWith('blob:')
              ? url
              : url.includes('?')
                ? `${url}&download=1`
                : `${url}?download=1`;
          const res = await fetch(fetchUrl, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          const blob = new Blob([buf], { type: 'application/pdf' });
          blobUrlToUse = URL.createObjectURL(blob);
          createdTempUrl = true;
        }
      }

      const a = document.createElement('a');
      a.href = blobUrlToUse;
      a.download = suggestedDownloadName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      if (createdTempUrl && blobUrlToUse) {
        window.setTimeout(() => URL.revokeObjectURL(blobUrlToUse!), 15000);
      }
    } catch (err) {
      console.warn('Direct Blob PDF download fallback:', err);
      const fallbackHref =
        url.startsWith('data:') || url.startsWith('blob:')
          ? url
          : url.includes('?')
            ? `${url}&download=1`
            : `${url}?download=1`;
      const a = document.createElement('a');
      a.href = fallbackHref;
      a.download = suggestedDownloadName;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setIsDownloading(false);
    }
  }, [url, isDownloading, localBlobUrl, suggestedDownloadName]);

  useEffect(() => {
    const updateWidth = () => {
      const w = scrollContainerRef.current?.clientWidth || window.innerWidth;
      if (w > 100) setContainerWidth(w);
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let loadingTask: PdfjsTypes.PDFDocumentLoadingTask | null = null;
    let loadedDoc: PdfjsTypes.PDFDocumentProxy | null = null;
    let createdObjectUrl: string | null = null;

    setIsLoading(true);
    setLoadError(null);
    setPdfDoc(null);
    setNumPages(0);
    setCurrentPage(1);

    void (async () => {
      try {
        ensurePdfBrowserPolyfills();

        // 1. Fetch exact PDF binary upfront so both inline viewer and Download PDF work 100% inside iframes/WebViews
        const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) {
          throw new Error(`PDF fetch failed with HTTP ${res.status}`);
        }
        const arrayBuf = await res.arrayBuffer();
        if (cancelled) return;
        if (!arrayBuf || arrayBuf.byteLength < 16) {
          throw new Error('PDF file is empty');
        }

        pdfBytesRef.current = arrayBuf;

        const pdfBlob = new Blob([arrayBuf], { type: 'application/pdf' });
        createdObjectUrl = URL.createObjectURL(pdfBlob);
        setLocalBlobUrl(createdObjectUrl);

        // 2. Load PDF.js + in-process worker handler (zero external Worker URL / CSP / ServiceWorker failures!)
        const [pdfjsMod, pdfWorkerMod] = await Promise.all([
          import('pdfjs-dist/legacy/build/pdf.min.mjs'),
          import('pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
        ]);
        if (cancelled) return;

        (globalThis as unknown as { pdfjsWorker?: unknown }).pdfjsWorker = pdfWorkerMod;
        const pdfjsLib = pdfjsMod as unknown as typeof PdfjsTypes;

        // Pass a fresh copy of Uint8Array so pdfBytesRef.current stays intact for downloading
        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuf.slice(0)),
          useSystemFonts: true,
        });
        const doc = await loadingTask.promise;
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        loadedDoc = doc;
        setPdfDoc(doc);
        setNumPages(doc.numPages || 1);
      } catch (err) {
        if (!cancelled) {
          console.warn('PDF.js inline render warning:', err);
          setLoadError(
            'Could not render PDF inline on this browser. Click "Download PDF" or "Native View" below.'
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
      try {
        void loadingTask?.destroy();
      } catch {
        // ignore
      }
      try {
        void loadedDoc?.cleanup();
      } catch {
        // ignore
      }
    };
  }, [url, reloadNonce]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[80] bg-slate-950/92 backdrop-blur-sm flex flex-col"
    >
      {/* Top Toolbar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2.5 bg-slate-900 border-b border-slate-700 text-white shrink-0"
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
              <span>Vs Tests · Exact Original PDF</span>
              {numPages > 0 && viewMode === 'canvas' && (
                <span className="px-1.5 py-0.5 rounded bg-slate-800 text-sky-300 font-mono-tabular">
                  Page {currentPage} / {numPages}
                </span>
              )}
            </div>
            <h3 className="text-xs sm:text-sm font-extrabold truncate">{title}</h3>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {viewMode === 'canvas' && (
            <div className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-xl px-1.5 py-1">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.15).toFixed(2))))}
                className="p-1 rounded-lg hover:bg-slate-700 text-slate-200"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="px-1.5 text-[11px] font-mono-tabular font-extrabold text-sky-300"
                title="Reset to Fit Width"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))}
                className="p-1 rounded-lg hover:bg-slate-700 text-slate-200"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setViewMode((m) => (m === 'canvas' ? 'native' : 'canvas'))}
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-bold"
            title="Switch between Exact Page View and Browser Native PDF View"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {viewMode === 'canvas' ? 'Native View' : 'Exact PDF View'}
            </span>
          </button>

          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-extrabold transition cursor-pointer"
          >
            {isDownloading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{isDownloading ? 'Downloading...' : 'Download PDF'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white text-xs font-extrabold cursor-pointer"
          >
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      </div>

      {/* PDF Pages Area */}
      <div
        ref={scrollContainerRef}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 bg-slate-950 overflow-y-auto overflow-x-auto p-3 sm:p-5"
      >
        {viewMode === 'native' ? (
          <iframe
            src={`${localBlobUrl || url}#toolbar=1&navpanes=0`}
            title={title}
            className="w-full h-full min-h-[75vh] border-0 rounded-xl bg-white"
          />
        ) : isLoading ? (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-white gap-3">
            <Loader2 className="w-9 h-9 animate-spin text-emerald-400" />
            <div className="text-sm font-extrabold">Opening Original PDF...</div>
            <div className="text-xs text-slate-400">
              Rendering exact original pages without any changes
            </div>
          </div>
        ) : loadError || !pdfDoc ? (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center text-white gap-4 max-w-md mx-auto">
            <FileText className="w-12 h-12 text-amber-400" />
            <p className="text-sm font-bold text-slate-200">
              {loadError || 'Unable to load PDF preview.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" /> Retry
              </button>
              <button
                type="button"
                onClick={() => setViewMode('native')}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-extrabold cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" /> Open in Browser View
              </button>
              <button
                type="button"
                disabled={isDownloading}
                onClick={() => void handleDownloadPdf()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold cursor-pointer"
              >
                <Download className="w-4 h-4" /> Download Original PDF
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-8">
            {Array.from({ length: numPages }, (_, idx) => (
              <PdfPageCanvas
                key={`${reloadNonce}_${idx + 1}`}
                pdfDoc={pdfDoc}
                pageNumber={idx + 1}
                containerWidth={containerWidth}
                zoom={zoom}
                onVisible={setCurrentPage}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
