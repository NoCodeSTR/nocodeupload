"use client";

/**
 * Printable QR sign for an upload link. Renders a clean, centered "sign" the
 * owner can print and tape up (e.g. in a cleaner's supply closet) so anyone can
 * scan to reach the public upload page. Plus Download PNG / Download SVG / Print.
 *
 * QR is generated entirely client-side via qrcode.react (no server, no infra):
 *   - QRCodeSVG  → on-screen + print + crisp vector SVG download
 *   - QRCodeCanvas (hidden, hi-res) → PNG export via canvas.toDataURL
 *
 * Print isolation: a scoped @media print rule hides everything except the sign,
 * so the dashboard chrome (sidebar/topbar) never appears on the printout.
 */
import { useRef } from "react";
import { QRCodeSVG, QRCodeCanvas } from "qrcode.react";
import { Download, Printer, Upload } from "lucide-react";

interface QrSignProps {
  publicUrl: string;
  linkName: string;
  logoUrl: string | null;
  accent: string;
}

function safeFileBase(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "upload-link"
  );
}

export function QrSign({ publicUrl, linkName, logoUrl, accent }: QrSignProps) {
  const signRef = useRef<HTMLDivElement>(null);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  function downloadPng() {
    const canvas = canvasWrapRef.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    triggerDownload(url, `${safeFileBase(linkName)}-qr.png`);
  }

  function downloadSvg() {
    const svg = signRef.current?.querySelector("svg.qr-svg");
    if (!svg) return;
    const xml = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${safeFileBase(linkName)}-qr.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div>
      {/* Print isolation: only the sign prints. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .qr-print-area, .qr-print-area * { visibility: visible !important; }
          .qr-print-area {
            position: absolute; left: 0; top: 0; width: 100%;
            border: none !important; box-shadow: none !important;
          }
          .qr-no-print { display: none !important; }
        }
      `}</style>

      {/* The sign */}
      <div
        ref={signRef}
        className="qr-print-area mx-auto max-w-md rounded-2xl border border-ink-200 bg-white px-8 py-10 text-center dark:border-ink-700 dark:bg-white"
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="mx-auto mb-5 h-12 object-contain" />
        ) : (
          <div
            className="mb-5 flex items-center justify-center gap-2 font-display text-lg font-bold"
            style={{ color: "#18181b" }}
          >
            <Upload className="h-6 w-6" style={{ color: accent }} />
            NoCode Upload
          </div>
        )}

        <h1 className="font-display text-2xl font-bold text-ink-900" style={{ color: "#18181b" }}>
          {linkName}
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: "#52525b" }}>
          Scan to upload your photos &amp; videos
        </p>

        <div className="my-7 flex justify-center">
          <div className="rounded-xl border-4 p-3" style={{ borderColor: accent }}>
            <QRCodeSVG
              value={publicUrl}
              size={224}
              level="M"
              marginSize={0}
              className="qr-svg block h-56 w-56"
              fgColor="#18181b"
              bgColor="#ffffff"
            />
          </div>
        </div>

        <p className="break-all font-mono text-xs" style={{ color: "#71717a" }}>
          {publicUrl.replace(/^https?:\/\//, "")}
        </p>

        <p className="mt-6 text-[11px]" style={{ color: "#a1a1aa" }}>
          Powered by NoCodeUpload.com
        </p>
      </div>

      {/* Hi-res canvas (off-screen) purely for the PNG export. */}
      <div ref={canvasWrapRef} className="qr-no-print sr-only" aria-hidden="true">
        <QRCodeCanvas value={publicUrl} size={1024} level="M" marginSize={2} fgColor="#18181b" bgColor="#ffffff" />
      </div>

      {/* Actions (never printed) */}
      <div className="qr-no-print mt-6 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={downloadPng} className="btn-secondary h-9 text-sm">
          <Download className="h-4 w-4" />
          Download PNG
        </button>
        <button type="button" onClick={downloadSvg} className="btn-secondary h-9 text-sm">
          <Download className="h-4 w-4" />
          Download SVG
        </button>
        <button type="button" onClick={() => window.print()} className="btn-primary h-9 text-sm">
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>
    </div>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
