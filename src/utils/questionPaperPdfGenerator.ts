import { CbtQuestion, CbtTestMeta } from '../types';
import { parseCbtHtmlFile } from './htmlTestParser';

export interface QuestionPaperPdfStats {
  score: number;
  maxMarks: number;
  correctCount: number;
  wrongCount: number;
  unattemptedCount: number;
  accuracy: number;
  totalTimeSpent: number;
}

export interface GenerateQuestionPaperPdfOptions {
  testMeta: CbtTestMeta;
  questions: CbtQuestion[];
  rawHtmlContent?: string;
  answers: Record<number, string>;
  stats: QuestionPaperPdfStats;
  studentName?: string;
  studentBatch?: string;
  includeSolutions?: boolean;
  onProgress?: (currentStep: string, percent: number) => void;
}

/**
 * Strips HTML tags while preserving line breaks, subscripts/superscripts, and decoding common HTML entities.
 */
function cleanHtmlText(raw?: string): string {
  if (!raw) return '';
  let text = String(raw);
  // Remove embedded <img ...> tags from text since images are extracted separately
  text = text.replace(/<img[^>]*>/gi, '');
  // Convert <br>, </p>, </div>, </li> to newlines
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ');
  // Convert common sub/sup to readable unicode where possible
  const supMap: Record<string, string> = {
    '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
    '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
    '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ'
  };
  const subMap: Record<string, string> = {
    '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
    '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
    '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎'
  };
  text = text.replace(/<sup>(.*?)<\/sup>/gi, (_, inner) =>
    String(inner)
      .split('')
      .map((ch: string) => supMap[ch] || ch)
      .join('')
  );
  text = text.replace(/<sub>(.*?)<\/sub>/gi, (_, inner) =>
    String(inner)
      .split('')
      .map((ch: string) => subMap[ch] || ch)
      .join('')
  );
  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');
  // Decode HTML entities
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&times;': '×',
    '&divide;': '÷',
    '&plusmn;': '±',
    '&deg;': '°',
    '&rarr;': '→',
    '&larr;': '←',
    '&harr;': '↔',
    '&rArr;': '⇒',
    '&le;': '≤',
    '&ge;': '≥',
    '&ne;': '≠',
    '&approx;': '≈',
    '&alpha;': 'α',
    '&beta;': 'β',
    '&gamma;': 'γ',
    '&delta;': 'δ',
    '&Delta;': 'Δ',
    '&theta;': 'θ',
    '&lambda;': 'λ',
    '&mu;': 'μ',
    '&pi;': 'π',
    '&sigma;': 'σ',
    '&omega;': 'ω',
    '&Omega;': 'Ω',
    '&infin;': '∞',
    '&radic;': '√',
  };
  text = text.replace(/&[a-zA-Z0-9#]+;/g, (match) => entities[match] || match);
  // Collapse excessive blank lines
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
    .join('\n')
    .trim();
}

/**
 * Extracts all <img src="..."> URLs or base64 data URIs embedded inside an HTML snippet,
 * or returns the raw string itself if it starts with `data:image/`.
 */
function extractEmbeddedImageSrcs(htmlOrDataUrl?: string | null): string[] {
  if (!htmlOrDataUrl) return [];
  const trimmed = String(htmlOrDataUrl).trim();
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return [trimmed];
  }
  const results: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    if (match[1] && !results.includes(match[1])) {
      results.push(match[1]);
    }
  }
  return results;
}

/**
 * Loads an image from a data URL or HTTP URL with a safe timeout so one broken image never blocks PDF generation.
 */
function loadImageSafe(src: string, timeoutMs = 6000): Promise<HTMLImageElement | null> {
  if (!src || typeof src !== 'string') return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    img.onload = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(img);
      }
    };
    img.onerror = () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timer);
        resolve(null);
      }
    };
    img.src = src;
  });
}

/**
 * Wraps multiline text into lines that fit within maxWidth on the given CanvasRenderingContext2D.
 */
function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) {
      continue;
    }
    const words = trimmed.split(' ');
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
        // Handle extremely long single words/urls
        while (ctx.measureText(currentLine).width > maxWidth && currentLine.length > 4) {
          let splitIdx = currentLine.length - 1;
          while (
            splitIdx > 1 &&
            ctx.measureText(currentLine.slice(0, splitIdx)).width > maxWidth
          ) {
            splitIdx--;
          }
          lines.push(currentLine.slice(0, splitIdx));
          currentLine = currentLine.slice(splitIdx);
        }
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }
  return lines;
}

/**
 * Converts a base64 data URL (`data:image/jpeg;base64,...`) into a Uint8Array of raw JPEG bytes.
 */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64Idx = dataUrl.indexOf(';base64,');
  const base64 = base64Idx >= 0 ? dataUrl.slice(base64Idx + 8) : dataUrl;
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Assembles an array of JPEG page images into a valid, multi-page PDF 1.4 binary Blob (`application/pdf`).
 * Zero external dependencies — works offline and preserves 100% of Hindi Devanagari + math + diagrams + VS watermark.
 */
function buildMultiPagePdfFromJpegs(
  pages: Array<{ jpegBytes: Uint8Array; widthPx: number; heightPx: number }>
): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let byteOffset = 0;
  const xrefOffsets: number[] = [0]; // Object 0 is free

  const pushStr = (str: string) => {
    const arr = encoder.encode(str);
    chunks.push(arr);
    byteOffset += arr.byteLength;
  };

  const pushBytes = (arr: Uint8Array) => {
    chunks.push(arr);
    byteOffset += arr.byteLength;
  };

  // Standard A4 dimensions in PDF points (72 DPI)
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;

  // PDF Header (with high-bit comment indicating binary content)
  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const numPages = pages.length;

  // Obj 1: Catalog
  xrefOffsets[1] = byteOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  const kidsRefs = pages.map((_, idx) => `${3 + idx * 3} 0 R`).join(' ');
  xrefOffsets[2] = byteOffset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [ ${kidsRefs} ] /Count ${numPages} >>\nendobj\n`
  );

  for (let i = 0; i < numPages; i++) {
    const { jpegBytes, widthPx, heightPx } = pages[i];
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const imgName = `/Im${i + 1}`;

    // Content stream places the image across the full A4 page
    const contentStream = `q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n${imgName} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);

    // Page object
    xrefOffsets[pageObjId] = byteOffset;
    pushStr(
      `${pageObjId} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)} ] ` +
        `/Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> ` +
        `/Contents ${contentObjId} 0 R >>\n` +
        `endobj\n`
    );

    // Content object
    xrefOffsets[contentObjId] = byteOffset;
    pushStr(
      `${contentObjId} 0 obj\n<< /Length ${contentBytes.byteLength} >>\nstream\n`
    );
    pushBytes(contentBytes);
    pushStr('\nendstream\nendobj\n');

    // Image XObject (DCTDecode raw JPEG)
    xrefOffsets[imageObjId] = byteOffset;
    pushStr(
      `${imageObjId} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\n` +
        `stream\n`
    );
    pushBytes(jpegBytes);
    pushStr('\nendstream\nendobj\n');
  }

  // Cross-reference table
  const totalObjects = 2 + numPages * 3 + 1;
  const xrefStart = byteOffset;
  pushStr(`xref\n0 ${totalObjects}\n`);
  pushStr('0000000000 65535 f \n');
  for (let objId = 1; objId < totalObjects; objId++) {
    const off = String(xrefOffsets[objId] || 0).padStart(10, '0');
    pushStr(`${off} 00000 n \n`);
  }

  // Trailer
  pushStr(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/**
 * Draws the background repeating diagonal "VS" / "VS TESTS" pattern watermark on a page canvas
 * (called before drawing questions).
 */
function drawPageBackgroundWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate((-32 * Math.PI) / 180);

  for (let y = -height; y <= height; y += 310) {
    for (let x = -width; x <= width; x += 440) {
      // Draw subtle "VS" circular badge watermark
      ctx.beginPath();
      ctx.arc(x - 115, y - 14, 34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 132, 199, 0.05)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(2, 132, 199, 0.09)';
      ctx.stroke();

      ctx.font = '900 30px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(2, 132, 199, 0.09)';
      ctx.textAlign = 'center';
      ctx.fillText('VS', x - 115, y - 3);

      ctx.textAlign = 'left';
      ctx.font = '900 38px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(15, 23, 42, 0.055)';
      ctx.fillText('VS TESTS', x - 68, y);

      ctx.font = '700 14px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(2, 132, 199, 0.075)';
      ctx.fillText('NEET UG & PARAMEDICAL PORTAL', x - 68, y + 22);
    }
  }
  ctx.restore();
}

/**
 * Draws a prominent foreground diagonal "VS" / "VS TESTS" watermark stamp on top of page content
 * so that even questions that consist of full-width white JPEG diagrams clearly show the "VS" watermark!
 */
function drawPageForegroundVsWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  ctx.save();

  const positions = [
    { cx: width * 0.5, cy: height * 0.34 },
    { cx: width * 0.5, cy: height * 0.72 },
  ];

  for (const pos of positions) {
    ctx.save();
    ctx.translate(pos.cx, pos.cy);
    ctx.rotate((-28 * Math.PI) / 180);

    // Outer double ring shield
    ctx.beginPath();
    ctx.arc(-195, -12, 64, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.14)';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-195, -12, 54, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.11)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Giant "VS" inside emblem
    ctx.font = '900 62px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(2, 132, 199, 0.14)';
    ctx.textAlign = 'center';
    ctx.fillText('VS', -195, 10);

    // Giant "VS TESTS" text next to emblem
    ctx.textAlign = 'left';
    ctx.font = '900 84px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(15, 23, 42, 0.095)';
    ctx.fillText('VS TESTS', -112, 12);

    ctx.font = '800 22px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(2, 132, 199, 0.13)';
    ctx.fillText('OFFICIAL QUESTION PAPER • VS WATERMARK', -108, 46);

    ctx.restore();
  }

  ctx.restore();
}

/**
 * Draws the official top header and bottom footer on every A4 page.
 */
function drawPageHeaderAndFooter(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  testMeta: CbtTestMeta,
  pageNumber: number
) {
  const marginX = 48;

  // Top Header Bar
  const headerGrad = ctx.createLinearGradient(0, 0, width, 0);
  headerGrad.addColorStop(0, '#0f172a');
  headerGrad.addColorStop(0.6, '#1e293b');
  headerGrad.addColorStop(1, '#0369a1');
  ctx.fillStyle = headerGrad;
  ctx.fillRect(0, 0, width, 96);

  // Accent sky bottom stripe on header
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, 92, width, 4);

  // VS Logo Badge in Header
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(marginX, 18, 60, 60, 14);
  ctx.fillStyle = '#0284c7';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#7dd3fc';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 28px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('VS', marginX + 30, 58);
  ctx.restore();

  // Brand & Test Title in Header
  ctx.save();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#38bdf8';
  ctx.font = '800 15px Inter, system-ui, sans-serif';
  ctx.fillText(
    'VS TESTS • OFFICIAL NEET UG & PARAMEDICAL QUESTION PAPER WITH SOLUTIONS',
    marginX + 76,
    38
  );

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 24px Inter, system-ui, sans-serif';
  const titleText =
    testMeta.title.length > 56
      ? testMeta.title.slice(0, 53) + '...'
      : testMeta.title;
  ctx.fillText(titleText, marginX + 76, 70);

  // Right side badge in Header
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e0f2fe';
  ctx.font = '800 16px Inter, system-ui, sans-serif';
  ctx.fillText(
    `${testMeta.subject || 'All Subjects'} • ${testMeta.totalQuestions} Qs`,
    width - marginX,
    42
  );
  ctx.fillStyle = '#94a3b8';
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.fillText(`Page ${pageNumber}`, width - marginX, 68);
  ctx.restore();

  // Bottom Footer Bar
  const footerY = height - 54;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, footerY, width, 54);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(width, footerY);
  ctx.stroke();

  ctx.fillStyle = '#0284c7';
  ctx.font = '900 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(
    'VS TESTS OFFICIAL QUESTION PAPER & ANSWER KEY (VS WATERMARKED)',
    marginX,
    footerY + 32
  );

  ctx.fillStyle = '#64748b';
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  const dateStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  ctx.fillText(
    `Generated on ${dateStr} • VS Tests Portal • Page ${pageNumber}`,
    width - marginX,
    footerY + 32
  );
}

interface HydratedQuestionAssets {
  q: CbtQuestion;
  qImgHi: HTMLImageElement | null;
  qImgEn: HTMLImageElement | null;
  solImgHi: HTMLImageElement | null;
  solImgEn: HTMLImageElement | null;
}

/**
 * Generates a complete, multi-page A4 Question Paper + Answer Key + Solutions PDF with VS Watermark
 * and returns `{ blob, fileName }`. Also triggers an automatic browser download if `autoDownload` is true.
 */
export async function generateQuestionPaperPdfWithWatermark(
  options: GenerateQuestionPaperPdfOptions,
  autoDownload = true
): Promise<{ blob: Blob; fileName: string }> {
  const {
    testMeta,
    rawHtmlContent,
    answers,
    stats,
    studentName = 'Student',
    studentBatch = 'NEET UG Target Batch',
    includeSolutions = true,
    onProgress,
  } = options;

  let questions = Array.isArray(options.questions) ? [...options.questions] : [];

  // Step 1: Re-hydrate stripped question/solution diagrams from rawHtmlContent if needed
  onProgress?.('Preparing questions & diagrams...', 5);
  const needsHydration =
    Boolean(rawHtmlContent && rawHtmlContent.trim().length > 200) &&
    (questions.length === 0 ||
      questions.some(
        (q) =>
          !q.imageHi &&
          !q.imageEn &&
          !q.imageUrl &&
          !q.explanation?.hi?.includes('data:image/') &&
          !q.explanation?.en?.includes('data:image/')
      ));

  if (needsHydration && rawHtmlContent) {
    try {
      const parsed = parseCbtHtmlFile(rawHtmlContent, testMeta.title);
      if (parsed.questions && parsed.questions.length > 0) {
        if (questions.length === 0) {
          questions = parsed.questions;
        } else {
          const parsedById = new Map<number, CbtQuestion>();
          parsed.questions.forEach((pq, idx) => {
            parsedById.set(pq.id || idx + 1, pq);
          });
          questions = questions.map((q, idx) => {
            const pq = parsedById.get(q.id || idx + 1) || parsed.questions[idx];
            if (!pq) return q;
            return {
              ...pq,
              ...q,
              imageHi: q.imageHi || pq.imageHi,
              imageEn: q.imageEn || pq.imageEn,
              imageUrl: q.imageUrl || pq.imageUrl,
              questionHi: q.questionHi || pq.questionHi || '',
              questionEn: q.questionEn || pq.questionEn || '',
              explanation: {
                hi:
                  q.explanation?.hi && q.explanation.hi.length >= (pq.explanation?.hi?.length || 0)
                    ? q.explanation.hi
                    : pq.explanation?.hi || q.explanation?.hi || '',
                en:
                  q.explanation?.en && q.explanation.en.length >= (pq.explanation?.en?.length || 0)
                    ? q.explanation.en
                    : pq.explanation?.en || q.explanation?.en || '',
              },
            };
          });
        }
      }
    } catch (err) {
      console.warn('Could not re-hydrate HTML diagrams for PDF:', err);
    }
  }

  // Step 2: Preload all question and solution images in parallel batches
  const totalQ = questions.length;
  const hydratedList: HydratedQuestionAssets[] = [];
  const batchSize = 12;

  for (let start = 0; start < totalQ; start += batchSize) {
    const end = Math.min(totalQ, start + batchSize);
    const pct = 10 + Math.round((start / Math.max(1, totalQ)) * 35);
    onProgress?.(`Loading diagrams (${start + 1}–${end} of ${totalQ})...`, pct);

    const chunk = await Promise.all(
      questions.slice(start, end).map(async (q) => {
        const hiSrc =
          q.imageHi ||
          q.imageUrl ||
          extractEmbeddedImageSrcs(q.questionHi)[0] ||
          '';
        const enSrc =
          q.imageEn ||
          extractEmbeddedImageSrcs(q.questionEn)[0] ||
          '';
        const solHiSrc = extractEmbeddedImageSrcs(q.explanation?.hi)[0] || '';
        const solEnSrc = extractEmbeddedImageSrcs(q.explanation?.en)[0] || '';

        const isSameQImg = Boolean(hiSrc && enSrc && hiSrc === enSrc);
        const isSameSolImg = Boolean(solHiSrc && solEnSrc && solHiSrc === solEnSrc);

        const [qImgHi, qImgEn, solImgHi, solImgEn] = await Promise.all([
          hiSrc ? loadImageSafe(hiSrc) : Promise.resolve(null),
          enSrc && !isSameQImg ? loadImageSafe(enSrc) : Promise.resolve(null),
          solHiSrc ? loadImageSafe(solHiSrc) : Promise.resolve(null),
          solEnSrc && !isSameSolImg ? loadImageSafe(solEnSrc) : Promise.resolve(null),
        ]);

        return {
          q,
          qImgHi,
          qImgEn: isSameQImg ? null : qImgEn,
          solImgHi,
          solImgEn: isSameSolImg ? null : solImgEn,
        };
      })
    );
    hydratedList.push(...chunk);
  }

  // Step 3: Render A4 Pages (1240 x 1754 px at 150 DPI)
  const PAGE_W = 1240;
  const PAGE_H = 1754;
  const MARGIN_X = 48;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;
  const TOP_START_Y = 118;
  const BOTTOM_LIMIT_Y = PAGE_H - 72;

  const pageJpegs: Array<{ jpegBytes: Uint8Array; widthPx: number; heightPx: number }> = [];

  const createNewPageCanvas = (pageNum: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = PAGE_W;
    canvas.height = PAGE_H;
    const ctx = canvas.getContext('2d')!;
    // White paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    // Background VS watermark pattern
    drawPageBackgroundWatermark(ctx, PAGE_W, PAGE_H);
    // Official VS Header & Footer
    drawPageHeaderAndFooter(ctx, PAGE_W, PAGE_H, testMeta, pageNum);
    return { canvas, ctx };
  };

  let currentPageNum = 1;
  let { canvas: currentCanvas, ctx: currentCtx } = createNewPageCanvas(currentPageNum);
  let cursorY = TOP_START_Y;

  const finalizeCurrentPage = () => {
    // Draw prominent foreground diagonal "VS / VS TESTS" watermark over the finished page
    drawPageForegroundVsWatermark(currentCtx, PAGE_W, PAGE_H);
    const dataUrl = currentCanvas.toDataURL('image/jpeg', 0.84);
    pageJpegs.push({
      jpegBytes: dataUrlToUint8Array(dataUrl),
      widthPx: PAGE_W,
      heightPx: PAGE_H,
    });
  };

  const startNextPage = () => {
    finalizeCurrentPage();
    currentPageNum += 1;
    const next = createNewPageCanvas(currentPageNum);
    currentCanvas = next.canvas;
    currentCtx = next.ctx;
    cursorY = TOP_START_Y;
  };

  const posMarks = testMeta.correctMarks || 4;
  const negMarks = testMeta.negativeMarks ?? 1;

  // --- Draw Student Score & Summary Card at Top of Page 1 ---
  onProgress?.('Rendering scorecard & answer key...', 50);
  {
    const summaryH = 148;
    currentCtx.save();
    currentCtx.beginPath();
    currentCtx.roundRect(MARGIN_X, cursorY, CONTENT_W, summaryH, 16);
    currentCtx.fillStyle = '#f8fafc';
    currentCtx.fill();
    currentCtx.lineWidth = 2;
    currentCtx.strokeStyle = '#bae6fd';
    currentCtx.stroke();

    // Left: Candidate & Test Meta
    currentCtx.textAlign = 'left';
    currentCtx.fillStyle = '#0284c7';
    currentCtx.font = '800 15px Inter, system-ui, sans-serif';
    currentCtx.fillText('CANDIDATE PERFORMANCE & QUESTION PAPER REPORT', MARGIN_X + 24, cursorY + 32);

    currentCtx.fillStyle = '#0f172a';
    currentCtx.font = '900 22px Inter, system-ui, sans-serif';
    currentCtx.fillText(`Student: ${studentName} (${studentBatch})`, MARGIN_X + 24, cursorY + 64);

    currentCtx.fillStyle = '#475569';
    currentCtx.font = '700 16px Inter, system-ui, sans-serif';
    currentCtx.fillText(
      `Marking Scheme: +${posMarks} Correct  |  -${negMarks} Wrong  |  Duration: ${testMeta.durationMinutes} Mins`,
      MARGIN_X + 24,
      cursorY + 96
    );

    currentCtx.fillStyle = '#0369a1';
    currentCtx.font = '800 15px Inter, system-ui, sans-serif';
    currentCtx.fillText(
      `Total Questions: ${totalQ}  •  Official VS Watermarked Question Paper & Solutions`,
      MARGIN_X + 24,
      cursorY + 126
    );

    // Right: Score Pill Boxes
    const statBoxes = [
      { label: 'SCORE', value: `${stats.score}/${stats.maxMarks}`, bg: '#eff6ff', border: '#93c5fd', color: '#1d4ed8' },
      { label: 'CORRECT', value: String(stats.correctCount), bg: '#ecfdf5', border: '#6ee7b7', color: '#047857' },
      { label: 'WRONG', value: String(stats.wrongCount), bg: '#fff1f2', border: '#fda4af', color: '#be123c' },
      { label: 'SKIPPED', value: String(stats.unattemptedCount), bg: '#f1f5f9', border: '#cbd5e1', color: '#334155' },
      { label: 'ACCURACY', value: `${stats.accuracy}%`, bg: '#f0f9ff', border: '#7dd3fc', color: '#0369a1' },
    ];

    const boxW = 104;
    const boxH = 96;
    const gap = 10;
    const totalBoxesW = statBoxes.length * boxW + (statBoxes.length - 1) * gap;
    let bx = MARGIN_X + CONTENT_W - totalBoxesW - 20;
    const by = cursorY + 26;

    for (const sb of statBoxes) {
      currentCtx.beginPath();
      currentCtx.roundRect(bx, by, boxW, boxH, 12);
      currentCtx.fillStyle = sb.bg;
      currentCtx.fill();
      currentCtx.lineWidth = 1.5;
      currentCtx.strokeStyle = sb.border;
      currentCtx.stroke();

      currentCtx.textAlign = 'center';
      currentCtx.fillStyle = sb.color;
      currentCtx.font = '900 22px Inter, system-ui, sans-serif';
      currentCtx.fillText(sb.value, bx + boxW / 2, by + 46);

      currentCtx.font = '800 12px Inter, system-ui, sans-serif';
      currentCtx.fillText(sb.label, bx + boxW / 2, by + 74);
      bx += boxW + gap;
    }

    currentCtx.restore();
    cursorY += summaryH + 22;
  }

  // Helper to resolve student's selected answer whether `answers` is 0-indexed (`idx`) or 1-indexed (`q.id`)
  const getStudentAnswer = (idx: number, qId: number): string => {
    if (answers[idx] !== undefined && answers[idx] !== '') return String(answers[idx]);
    if (answers[qId] !== undefined && answers[qId] !== '') return String(answers[qId]);
    return '';
  };

  // --- Step 4: Render Every Question Card ---
  for (let idx = 0; idx < hydratedList.length; idx++) {
    const item = hydratedList[idx];
    const { q, qImgHi, qImgEn, solImgHi, solImgEn } = item;
    const qNum = idx + 1;

    if (idx % 5 === 0 || idx === hydratedList.length - 1) {
      const pct = 52 + Math.round(((idx + 1) / Math.max(1, hydratedList.length)) * 40);
      onProgress?.(`Formatting Question ${idx + 1} of ${hydratedList.length}...`, pct);
      await new Promise((r) => window.setTimeout(r, 0));
    }

    const userAns = getStudentAnswer(idx, q.id || qNum);
    const corrAns = String(q.correctAnswer || '1');
    const isAttempted = Boolean(userAns);
    const isCorrect =
      isAttempted &&
      (userAns === corrAns || (q.alsoCorrect && userAns === String(q.alsoCorrect)));

    // Clean question stems
    const hiStemRaw = cleanHtmlText(q.questionHi);
    const enStemRaw = cleanHtmlText(q.questionEn);
    const isSameStem = hiStemRaw && enStemRaw && hiStemRaw === enStemRaw;

    const innerPadX = 24;
    const textMaxW = CONTENT_W - innerPadX * 2;

    currentCtx.font = '600 19px Inter, system-ui, sans-serif';
    const hiLines = hiStemRaw ? wrapCanvasText(currentCtx, hiStemRaw, textMaxW) : [];
    const enLines =
      enStemRaw && !isSameStem ? wrapCanvasText(currentCtx, enStemRaw, textMaxW) : [];

    // Calculate Question Diagram heights
    const calcScaledDims = (img: HTMLImageElement | null, maxW: number, maxH: number) => {
      if (!img || !img.naturalWidth || !img.naturalHeight) return null;
      const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1.45);
      return {
        w: Math.round(img.naturalWidth * ratio),
        h: Math.round(img.naturalHeight * ratio),
      };
    };

    const qHiDims = calcScaledDims(qImgHi, textMaxW - 20, 460);
    const qEnDims = calcScaledDims(qImgEn, textMaxW - 20, 460);

    // Calculate Match-the-Column table height if present
    const tableRows = q.tableData?.rows || q.tableData?.rowsHi || q.tableData?.rowsEn || [];
    const tableHeaders =
      q.tableData?.headers || q.tableData?.headersHi || q.tableData?.headersEn || [];
    const hasTable = Boolean(tableRows.length > 0);
    const tableRowH = 40;
    const tableH = hasTable ? (tableRows.length + (tableHeaders.length > 0 ? 1 : 0)) * tableRowH + 16 : 0;

    // Options layout
    const optsHi = Array.isArray(q.optionsHi) ? q.optionsHi : [];
    const optsEn = Array.isArray(q.optionsEn) ? q.optionsEn : [];
    const numOpts = Math.max(optsHi.length, optsEn.length);

    const optionLinesList: Array<{
      id: string;
      text: string;
      lines: string[];
    }> = [];

    if (numOpts > 0) {
      currentCtx.font = '700 17px Inter, system-ui, sans-serif';
      for (let oi = 0; oi < numOpts; oi++) {
        const optId = String(optsHi[oi]?.id || optsEn[oi]?.id || oi + 1);
        const hiOpt = cleanHtmlText(optsHi[oi]?.text);
        const enOpt = cleanHtmlText(optsEn[oi]?.text);
        const combinedOpt =
          hiOpt && enOpt && hiOpt !== enOpt
            ? `${hiOpt}  /  ${enOpt}`
            : hiOpt || enOpt || `Option (${optId})`;
        const lines = wrapCanvasText(currentCtx, combinedOpt, textMaxW - 90);
        optionLinesList.push({
          id: optId,
          text: combinedOpt,
          lines: lines.length > 0 ? lines : [`Option (${optId})`],
        });
      }
    }

    const useCompactGridOptions =
      optionLinesList.length === 4 &&
      optionLinesList.every((o) => o.lines.length === 1 && o.text.length <= 32);

    const optionsTotalH = useCompactGridOptions
      ? 108
      : optionLinesList.reduce((acc, o) => acc + Math.max(44, o.lines.length * 24 + 18) + 8, 0);

    // Solution / Explanation layout (skip raw base64 string if explanation is a data:image URI)
    const rawSolHi = q.explanation?.hi || '';
    const rawSolEn = q.explanation?.en || '';
    const solHiText =
      includeSolutions && !rawSolHi.trim().startsWith('data:image/')
        ? cleanHtmlText(rawSolHi)
        : '';
    const solEnText =
      includeSolutions && !rawSolEn.trim().startsWith('data:image/')
        ? cleanHtmlText(rawSolEn)
        : '';
    const isSameSolText = solHiText && solEnText && solHiText === solEnText;

    currentCtx.font = '600 16px Inter, system-ui, sans-serif';
    const solHiLines = solHiText ? wrapCanvasText(currentCtx, solHiText, textMaxW - 32) : [];
    const solEnLines =
      solEnText && !isSameSolText ? wrapCanvasText(currentCtx, solEnText, textMaxW - 32) : [];

    const solHiDims = includeSolutions ? calcScaledDims(solImgHi, textMaxW - 40, 380) : null;
    const solEnDims = includeSolutions ? calcScaledDims(solImgEn, textMaxW - 40, 380) : null;

    const hasAnySolution =
      includeSolutions &&
      (solHiLines.length > 0 || solEnLines.length > 0 || Boolean(solHiDims) || Boolean(solEnDims));

    const solBoxH = hasAnySolution
      ? 42 +
        solHiLines.length * 23 +
        (solEnLines.length > 0 ? solEnLines.length * 23 + 8 : 0) +
        (solHiDims ? solHiDims.h + 14 : 0) +
        (solEnDims ? solEnDims.h + 14 : 0) +
        16
      : 0;

    // Total height of this Question Card
    const headerBarH = 48;
    const hiStemH = hiLines.length > 0 ? hiLines.length * 27 + 10 : 0;
    const enStemH = enLines.length > 0 ? enLines.length * 26 + 10 : 0;
    const qHiImgH = qHiDims ? qHiDims.h + 16 : 0;
    const qEnImgH = qEnDims ? qEnDims.h + 16 : 0;

    const totalCardH =
      headerBarH +
      16 +
      hiStemH +
      enStemH +
      qHiImgH +
      qEnImgH +
      tableH +
      optionsTotalH +
      (hasAnySolution ? solBoxH + 14 : 0) +
      20;

    if (cursorY + totalCardH > BOTTOM_LIMIT_Y && cursorY > TOP_START_Y + 40) {
      startNextPage();
    }

    let effectiveQHiDims = qHiDims;
    let effectiveQEnDims = qEnDims;
    let effectiveSolHiDims = solHiDims;
    let effectiveSolEnDims = solEnDims;

    const availablePageH = BOTTOM_LIMIT_Y - cursorY;
    if (totalCardH > availablePageH) {
      const totalImgH =
        (qHiDims?.h || 0) +
        (qEnDims?.h || 0) +
        (solHiDims?.h || 0) +
        (solEnDims?.h || 0);
      const excessH = totalCardH - availablePageH + 20;
      if (totalImgH > 150 && excessH > 0) {
        const scaleFactor = Math.max(0.45, (totalImgH - excessH) / totalImgH);
        if (effectiveQHiDims) {
          effectiveQHiDims = {
            w: Math.round(effectiveQHiDims.w * scaleFactor),
            h: Math.round(effectiveQHiDims.h * scaleFactor),
          };
        }
        if (effectiveQEnDims) {
          effectiveQEnDims = {
            w: Math.round(effectiveQEnDims.w * scaleFactor),
            h: Math.round(effectiveQEnDims.h * scaleFactor),
          };
        }
        if (effectiveSolHiDims) {
          effectiveSolHiDims = {
            w: Math.round(effectiveSolHiDims.w * scaleFactor),
            h: Math.round(effectiveSolHiDims.h * scaleFactor),
          };
        }
        if (effectiveSolEnDims) {
          effectiveSolEnDims = {
            w: Math.round(effectiveSolEnDims.w * scaleFactor),
            h: Math.round(effectiveSolEnDims.h * scaleFactor),
          };
        }
      }
    }

    const finalSolBoxH = hasAnySolution
      ? 42 +
        solHiLines.length * 23 +
        (solEnLines.length > 0 ? solEnLines.length * 23 + 8 : 0) +
        (effectiveSolHiDims ? effectiveSolHiDims.h + 14 : 0) +
        (effectiveSolEnDims ? effectiveSolEnDims.h + 14 : 0) +
        16
      : 0;

    const finalCardH =
      headerBarH +
      16 +
      hiStemH +
      enStemH +
      (effectiveQHiDims ? effectiveQHiDims.h + 16 : 0) +
      (effectiveQEnDims ? effectiveQEnDims.h + 16 : 0) +
      tableH +
      optionsTotalH +
      (hasAnySolution ? finalSolBoxH + 14 : 0) +
      20;

    // Draw Question Card Container
    currentCtx.save();
    currentCtx.beginPath();
    currentCtx.roundRect(MARGIN_X, cursorY, CONTENT_W, finalCardH, 16);
    currentCtx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    currentCtx.fill();
    currentCtx.lineWidth = 1.8;
    currentCtx.strokeStyle = !isAttempted
      ? '#cbd5e1'
      : isCorrect
      ? '#6ee7b7'
      : '#fda4af';
    currentCtx.stroke();

    // Card Top Strip
    currentCtx.beginPath();
    currentCtx.roundRect(MARGIN_X, cursorY, CONTENT_W, headerBarH, [16, 16, 0, 0]);
    currentCtx.fillStyle = !isAttempted
      ? '#f1f5f9'
      : isCorrect
      ? '#ecfdf5'
      : '#fff1f2';
    currentCtx.fill();

    // Question Number & Chapter Badge
    currentCtx.textAlign = 'left';
    currentCtx.fillStyle = '#0f172a';
    currentCtx.font = '900 18px Inter, system-ui, sans-serif';
    currentCtx.fillText(
      `Question ${qNum}  •  ${q.chapter || testMeta.subject || 'NEET UG'}`,
      MARGIN_X + innerPadX,
      cursorY + 31
    );

    // Right Status & Official Answer Key Badge
    currentCtx.textAlign = 'right';
    const statusLabel = !isAttempted
      ? `SKIPPED (0)  |  Your Ans: —  |  Correct Ans: (${corrAns})`
      : isCorrect
      ? `CORRECT (+${posMarks})  |  Your Ans: (${userAns})  |  Correct Ans: (${corrAns})`
      : `WRONG (-${negMarks})  |  Your Ans: (${userAns})  |  Correct Ans: (${corrAns})`;

    currentCtx.fillStyle = !isAttempted
      ? '#475569'
      : isCorrect
      ? '#047857'
      : '#be123c';
    currentCtx.font = '800 15px Inter, system-ui, sans-serif';
    currentCtx.fillText(statusLabel, MARGIN_X + CONTENT_W - innerPadX, cursorY + 31);

    let qCursorY = cursorY + headerBarH + 22;

    // Draw Hindi Question Stem
    if (hiLines.length > 0) {
      currentCtx.textAlign = 'left';
      currentCtx.fillStyle = '#0f172a';
      currentCtx.font = '700 19px Inter, system-ui, sans-serif';
      for (const line of hiLines) {
        currentCtx.fillText(line, MARGIN_X + innerPadX, qCursorY);
        qCursorY += 27;
      }
      qCursorY += 8;
    }

    // Draw English Question Stem
    if (enLines.length > 0) {
      currentCtx.textAlign = 'left';
      currentCtx.fillStyle = '#334155';
      currentCtx.font = '600 18px Inter, system-ui, sans-serif';
      for (const line of enLines) {
        currentCtx.fillText(line, MARGIN_X + innerPadX, qCursorY);
        qCursorY += 26;
      }
      qCursorY += 8;
    }

    // Draw Question Diagram (Hindi / Primary)
    if (qImgHi && effectiveQHiDims) {
      const imgX = MARGIN_X + innerPadX + Math.round((textMaxW - effectiveQHiDims.w) / 2);
      currentCtx.drawImage(
        qImgHi,
        imgX,
        qCursorY,
        effectiveQHiDims.w,
        effectiveQHiDims.h
      );
      qCursorY += effectiveQHiDims.h + 16;
    }

    // Draw Question Diagram (English if distinct)
    if (qImgEn && effectiveQEnDims) {
      const imgX = MARGIN_X + innerPadX + Math.round((textMaxW - effectiveQEnDims.w) / 2);
      currentCtx.drawImage(
        qImgEn,
        imgX,
        qCursorY,
        effectiveQEnDims.w,
        effectiveQEnDims.h
      );
      qCursorY += effectiveQEnDims.h + 16;
    }

    // Draw Match-the-Column Table if present
    if (hasTable) {
      const numCols = Math.max(2, tableHeaders.length || (tableRows[0]?.length ?? 2));
      const colW = Math.floor(textMaxW / numCols);
      const tX = MARGIN_X + innerPadX;

      if (tableHeaders.length > 0) {
        currentCtx.fillStyle = '#e2e8f0';
        currentCtx.fillRect(tX, qCursorY, textMaxW, tableRowH);
        currentCtx.strokeStyle = '#94a3b8';
        currentCtx.lineWidth = 1;
        currentCtx.strokeRect(tX, qCursorY, textMaxW, tableRowH);

        currentCtx.fillStyle = '#0f172a';
        currentCtx.font = '800 15px Inter, system-ui, sans-serif';
        currentCtx.textAlign = 'left';
        for (let ci = 0; ci < tableHeaders.length; ci++) {
          currentCtx.fillText(
            String(tableHeaders[ci] || '').slice(0, 42),
            tX + ci * colW + 12,
            qCursorY + 25
          );
        }
        qCursorY += tableRowH;
      }

      for (const row of tableRows) {
        currentCtx.fillStyle = '#f8fafc';
        currentCtx.fillRect(tX, qCursorY, textMaxW, tableRowH);
        currentCtx.strokeStyle = '#cbd5e1';
        currentCtx.lineWidth = 1;
        for (let ci = 0; ci < numCols; ci++) {
          currentCtx.strokeRect(tX + ci * colW, qCursorY, colW, tableRowH);
          currentCtx.fillStyle = '#1e293b';
          currentCtx.font = '600 15px Inter, system-ui, sans-serif';
          currentCtx.textAlign = 'left';
          currentCtx.fillText(
            String(row[ci] || '').slice(0, 48),
            tX + ci * colW + 12,
            qCursorY + 25
          );
        }
        qCursorY += tableRowH;
      }
      qCursorY += 14;
    }

    // Draw Options
    if (useCompactGridOptions) {
      const optW = Math.floor((textMaxW - 16) / 2);
      const optH = 44;
      for (let oi = 0; oi < optionLinesList.length; oi++) {
        const opt = optionLinesList[oi];
        const col = oi % 2;
        const row = Math.floor(oi / 2);
        const ox = MARGIN_X + innerPadX + col * (optW + 16);
        const oy = qCursorY + row * (optH + 10);

        const isCorrectOpt =
          opt.id === corrAns || (q.alsoCorrect && opt.id === String(q.alsoCorrect));
        const isUserSelected = opt.id === userAns;

        currentCtx.beginPath();
        currentCtx.roundRect(ox, oy, optW, optH, 10);
        currentCtx.fillStyle = isCorrectOpt
          ? '#ecfdf5'
          : isUserSelected
          ? '#fff1f2'
          : '#f8fafc';
        currentCtx.fill();
        currentCtx.lineWidth = isCorrectOpt || isUserSelected ? 2 : 1.2;
        currentCtx.strokeStyle = isCorrectOpt
          ? '#10b981'
          : isUserSelected
          ? '#f43f5e'
          : '#cbd5e1';
        currentCtx.stroke();

        currentCtx.textAlign = 'left';
        currentCtx.fillStyle = isCorrectOpt
          ? '#047857'
          : isUserSelected
          ? '#be123c'
          : '#1e293b';
        currentCtx.font = '800 16px Inter, system-ui, sans-serif';
        const badgeSuffix = isCorrectOpt
          ? '  ✓ [Correct]'
          : isUserSelected
          ? '  ✗ [Your Choice]'
          : '';
        currentCtx.fillText(
          `(${opt.id})  ${opt.lines[0]}${badgeSuffix}`,
          ox + 14,
          oy + 28
        );
      }
      qCursorY += 108;
    } else {
      for (const opt of optionLinesList) {
        const isCorrectOpt =
          opt.id === corrAns || (q.alsoCorrect && opt.id === String(q.alsoCorrect));
        const isUserSelected = opt.id === userAns;
        const boxH = Math.max(44, opt.lines.length * 24 + 18);

        currentCtx.beginPath();
        currentCtx.roundRect(MARGIN_X + innerPadX, qCursorY, textMaxW, boxH, 10);
        currentCtx.fillStyle = isCorrectOpt
          ? '#ecfdf5'
          : isUserSelected
          ? '#fff1f2'
          : '#f8fafc';
        currentCtx.fill();
        currentCtx.lineWidth = isCorrectOpt || isUserSelected ? 2 : 1.2;
        currentCtx.strokeStyle = isCorrectOpt
          ? '#10b981'
          : isUserSelected
          ? '#f43f5e'
          : '#cbd5e1';
        currentCtx.stroke();

        // Option Circle Badge
        currentCtx.beginPath();
        currentCtx.arc(MARGIN_X + innerPadX + 24, qCursorY + 22, 13, 0, Math.PI * 2);
        currentCtx.fillStyle = isCorrectOpt
          ? '#10b981'
          : isUserSelected
          ? '#f43f5e'
          : '#e2e8f0';
        currentCtx.fill();

        currentCtx.textAlign = 'center';
        currentCtx.fillStyle = isCorrectOpt || isUserSelected ? '#ffffff' : '#334155';
        currentCtx.font = '800 14px Inter, system-ui, sans-serif';
        currentCtx.fillText(opt.id, MARGIN_X + innerPadX + 24, qCursorY + 27);

        // Option Lines
        currentCtx.textAlign = 'left';
        currentCtx.fillStyle = isCorrectOpt
          ? '#065f46'
          : isUserSelected
          ? '#9f1239'
          : '#1e293b';
        currentCtx.font = '700 17px Inter, system-ui, sans-serif';
        let lineY = qCursorY + 27;
        for (let li = 0; li < opt.lines.length; li++) {
          const suffix =
            li === opt.lines.length - 1
              ? isCorrectOpt
                ? '   ✓ [Correct Answer]'
                : isUserSelected
                ? '   ✗ [Your Answer]'
                : ''
              : '';
          currentCtx.fillText(
            `${opt.lines[li]}${suffix}`,
            MARGIN_X + innerPadX + 48,
            lineY
          );
          lineY += 24;
        }

        qCursorY += boxH + 8;
      }
    }

    // Draw Solution / Explanation Box if present
    if (hasAnySolution) {
      qCursorY += 6;
      currentCtx.beginPath();
      currentCtx.roundRect(MARGIN_X + innerPadX, qCursorY, textMaxW, finalSolBoxH, 12);
      currentCtx.fillStyle = '#f0f9ff';
      currentCtx.fill();
      currentCtx.lineWidth = 1.5;
      currentCtx.strokeStyle = '#7dd3fc';
      currentCtx.stroke();

      currentCtx.textAlign = 'left';
      currentCtx.fillStyle = '#0369a1';
      currentCtx.font = '900 15px Inter, system-ui, sans-serif';
      currentCtx.fillText(
        `💡 DETAILED SOLUTION / व्याख्या (Correct Answer: Option ${corrAns}):`,
        MARGIN_X + innerPadX + 16,
        qCursorY + 26
      );

      let solY = qCursorY + 50;

      if (solHiLines.length > 0) {
        currentCtx.fillStyle = '#0f172a';
        currentCtx.font = '600 16px Inter, system-ui, sans-serif';
        for (const sLine of solHiLines) {
          currentCtx.fillText(sLine, MARGIN_X + innerPadX + 16, solY);
          solY += 23;
        }
      }

      if (solEnLines.length > 0) {
        if (solHiLines.length > 0) solY += 6;
        currentCtx.fillStyle = '#334155';
        currentCtx.font = '600 16px Inter, system-ui, sans-serif';
        for (const sLine of solEnLines) {
          currentCtx.fillText(sLine, MARGIN_X + innerPadX + 16, solY);
          solY += 23;
        }
      }

      if (solImgHi && effectiveSolHiDims) {
        const sImgX =
          MARGIN_X + innerPadX + Math.round((textMaxW - effectiveSolHiDims.w) / 2);
        currentCtx.drawImage(
          solImgHi,
          sImgX,
          solY,
          effectiveSolHiDims.w,
          effectiveSolHiDims.h
        );
        solY += effectiveSolHiDims.h + 14;
      }

      if (solImgEn && effectiveSolEnDims) {
        const sImgX =
          MARGIN_X + innerPadX + Math.round((textMaxW - effectiveSolEnDims.w) / 2);
        currentCtx.drawImage(
          solImgEn,
          sImgX,
          solY,
          effectiveSolEnDims.w,
          effectiveSolEnDims.h
        );
        solY += effectiveSolEnDims.h + 14;
      }
    }

    currentCtx.restore();
    cursorY += finalCardH + 18;
  }

  // --- Step 5: Draw Quick Official Answer Key Table at the End ---
  if (hydratedList.length > 0) {
    const cols = 10;
    const rows = Math.ceil(hydratedList.length / cols);
    const keyTableH = 56 + rows * 34 + 20;

    if (cursorY + keyTableH > BOTTOM_LIMIT_Y && cursorY > TOP_START_Y + 40) {
      startNextPage();
    }

    currentCtx.save();
    currentCtx.beginPath();
    currentCtx.roundRect(MARGIN_X, cursorY, CONTENT_W, keyTableH, 14);
    currentCtx.fillStyle = '#f8fafc';
    currentCtx.fill();
    currentCtx.lineWidth = 2;
    currentCtx.strokeStyle = '#0284c7';
    currentCtx.stroke();

    currentCtx.textAlign = 'left';
    currentCtx.fillStyle = '#0f172a';
    currentCtx.font = '900 18px Inter, system-ui, sans-serif';
    currentCtx.fillText(
      `🔑 OFFICIAL VS TESTS ANSWER KEY SUMMARY (${testMeta.title})`,
      MARGIN_X + 20,
      cursorY + 34
    );

    const cellW = Math.floor((CONTENT_W - 40) / cols);
    const cellH = 32;
    let ky = cursorY + 48;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const qIdx = r * cols + c;
        if (qIdx >= hydratedList.length) break;
        const qItem = hydratedList[qIdx].q;
        const qNum = qIdx + 1;
        const uAns = getStudentAnswer(qIdx, qItem.id || qNum);
        const corrAns = String(qItem.correctAnswer || '1');
        const isCorr =
          uAns &&
          (uAns === corrAns || (qItem.alsoCorrect && uAns === String(qItem.alsoCorrect)));

        const cx = MARGIN_X + 20 + c * cellW;
        currentCtx.fillStyle = !uAns ? '#ffffff' : isCorr ? '#ecfdf5' : '#fff1f2';
        currentCtx.fillRect(cx, ky, cellW - 4, cellH - 4);
        currentCtx.strokeStyle = '#cbd5e1';
        currentCtx.lineWidth = 1;
        currentCtx.strokeRect(cx, ky, cellW - 4, cellH - 4);

        currentCtx.textAlign = 'center';
        currentCtx.fillStyle = '#0f172a';
        currentCtx.font = '800 13px Inter, system-ui, sans-serif';
        currentCtx.fillText(
          `Q${qNum}: (${corrAns})`,
          cx + (cellW - 4) / 2,
          ky + 19
        );
      }
      ky += cellH;
    }

    currentCtx.restore();
    cursorY += keyTableH + 16;
  }

  // Finalize the last page
  finalizeCurrentPage();

  onProgress?.('Building PDF file with VS watermark...', 96);
  const pdfBlob = buildMultiPagePdfFromJpegs(pageJpegs);
  const safeTitle = (testMeta.title || 'Vs_Tests_Question_Paper')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const fileName = `${safeTitle}_VS_Question_Paper.pdf`;

  if (autoDownload) {
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  onProgress?.('PDF Downloaded!', 100);
  return { blob: pdfBlob, fileName };
}
