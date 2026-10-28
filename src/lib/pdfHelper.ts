import * as htmlToImage from 'html-to-image';
import { jsPDF } from 'jspdf';
import { sharePdfFile, openWhatsApp } from './shareHelper';

export interface PdfGenerationOptions {
  filename?: string;
  pixelRatio?: number; // Optimized default: 2 for high-quality text (prevents blurriness)
  quality?: number; // Optimized default: 0.85 for clean JPEG with acceptable size
  backgroundColor?: string;
}

export interface PdfGenerationResult {
  pdf: jsPDF;
  blob: Blob;
  base64: string;
  sizeKb: number;
  filename: string;
}

/**
 * Generates an ultra-optimized, compact PDF from an HTML element.
 * Specifically engineered to keep file size around 200KB or less for bank statements,
 * account ledgers, invoices and multi-page tables.
 */
export async function generateOptimizedPdfFromElement(
  element: HTMLElement,
  options: PdfGenerationOptions = {}
): Promise<PdfGenerationResult> {
  const pixelRatio = options.pixelRatio ?? 2;
  const quality = options.quality ?? 0.85;
  const backgroundColor = options.backgroundColor ?? '#ffffff';
  const filename = options.filename || `كشف_حساب_${new Date().toISOString().slice(0, 10)}.pdf`;

  // 1. Temporarily neutralize any CSS zoom or scaling transform on parents
  const parent = element.parentElement;
  let originalTransform = '';
  if (parent) {
    originalTransform = parent.style.transform;
    parent.style.transform = 'none';
  }

  try {
    // 2. Detect if there are multiple discrete page blocks inside element
    // Look for A4 page containers with min-h-[1123px] or page-break-after
    const pageNodes = Array.from(
      element.querySelectorAll<HTMLElement>(
        '.min-h-\\[1123px\\], [style*="page-break-after"], [style*="pageBreakAfter"]'
      )
    );

    let targetPages: HTMLElement[] = [];
    if (pageNodes.length > 0) {
      targetPages = pageNodes;
    } else {
      const directChildren = Array.from(element.children).filter(
        c => c instanceof HTMLElement && c.clientHeight > 450
      ) as HTMLElement[];
      if (directChildren.length > 1) {
        targetPages = directChildren;
      }
    }

    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    if (targetPages.length > 0) {
      // Discrete multi-page capture: Capture each page individually so NO oversized canvas is duplicated
      for (let i = 0; i < targetPages.length; i++) {
        const pageEl = targetPages[i];
        const canvas = await htmlToImage.toCanvas(pageEl, {
          pixelRatio,
          backgroundColor,
          cacheBust: false
        });

        const imgData = canvas.toDataURL('image/jpeg', quality);
        if (i > 0) {
          pdf.addPage();
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
    } else {
      // Single container / continuous element capture with clean A4 slicing
      const canvas = await htmlToImage.toCanvas(element, {
        pixelRatio,
        backgroundColor,
        cacheBust: false
      });

      const a4Aspect = 297 / 210; // ~1.4143
      const sliceHeightPx = Math.floor(canvas.width * a4Aspect);

      if (canvas.height <= sliceHeightPx * 1.05) {
        // Fits in a single page
        const imgData = canvas.toDataURL('image/jpeg', quality);
        const renderedHeight = Math.min(297, (canvas.height * 210) / canvas.width);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, renderedHeight, undefined, 'FAST');
      } else {
        // Multi-page slicing onto offscreen canvas without duplicating large data
        let yOffset = 0;
        let pageIndex = 0;
        while (yOffset < canvas.height) {
          const currentSliceHeight = Math.min(sliceHeightPx, canvas.height - yOffset);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = sliceHeightPx;
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
            ctx.drawImage(
              canvas,
              0,
              yOffset,
              canvas.width,
              currentSliceHeight,
              0,
              0,
              canvas.width,
              currentSliceHeight
            );
          }
          const sliceImgData = sliceCanvas.toDataURL('image/jpeg', quality);
          if (pageIndex > 0) {
            pdf.addPage();
          }
          pdf.addImage(sliceImgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
          pageIndex++;
          yOffset += currentSliceHeight;
          if (canvas.height - yOffset < 35) break; // omit negligible blank trailing slice
        }
      }
    }

    const blob = pdf.output('blob');
    const sizeKb = Math.round(blob.size / 1024);
    let base64 = '';
    try {
      base64 = pdf.output('datauristring').split(',')[1] || '';
    } catch {
      // ignore
    }

    return {
      pdf,
      blob,
      base64,
      sizeKb,
      filename
    };
  } finally {
    if (parent) {
      parent.style.transform = originalTransform;
    }
  }
}

/**
 * Downloads a Blob directly as a file in the browser.
 */
export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Convenience helper to export and share a lightweight PDF file via Native Share or Browser Download.
 */
export async function exportAndShareOptimizedPdf(
  element: HTMLElement,
  options: {
    filename: string;
    message?: string;
    category?: 'invoice' | 'report' | 'voucher';
    customerPhone?: string;
    onSuccess?: (sizeKb: number) => void;
  }
): Promise<{ sizeKb: number; filename: string }> {
  const result = await generateOptimizedPdfFromElement(element, {
    filename: options.filename,
    pixelRatio: 2,
    quality: 0.85
  });

  const isNative = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.();
  const canShareNatively = typeof navigator !== 'undefined' && !!navigator.share;
  const msg = options.message || `مرفق ملف كشف الحساب: ${options.filename}`;

  if (canShareNatively || isNative) {
    const sharedNatively = await sharePdfFile(result.blob, options.filename, msg, options.category || 'report');
    if (!sharedNatively && options.customerPhone) {
      openWhatsApp(msg, options.customerPhone);
    }
  } else {
    downloadPdfBlob(result.blob, options.filename);
  }

  if (options.onSuccess) {
    options.onSuccess(result.sizeKb);
  }

  return { sizeKb: result.sizeKb, filename: result.filename };
}
