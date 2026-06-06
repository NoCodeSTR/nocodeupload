/**
 * Shared "upload card" — the branded box with the link name, description, and
 * the working uploader. Used by both the standalone public page (/u/[slug])
 * and the embeddable page (/embed/[slug]) so they never drift apart.
 */
import { Upload } from "lucide-react";
import { PublicUploader } from "@/components/public-uploader";
import type { UploadLinkPublicRow } from "@/lib/db-types";

export function UploadCard({
  link,
  showBrandHeader = true,
}: {
  link: UploadLinkPublicRow;
  showBrandHeader?: boolean;
}) {
  const accent = link.branding_color ?? "#2563eb";

  return (
    <>
      {showBrandHeader && (
        <div className="mb-6 flex items-center justify-center">
          {link.branding_logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={link.branding_logo_url} alt="" className="h-12 object-contain" />
          ) : (
            <div className="flex items-center gap-2 font-display text-lg font-bold">
              <Upload className="h-6 w-6" style={{ color: accent }} />
              NoCode Upload
            </div>
          )}
        </div>
      )}

      <div className="card">
        {/* Compact logo inside the card when there's no outer brand header (embed) */}
        {!showBrandHeader && link.branding_logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.branding_logo_url} alt="" className="mb-4 h-10 object-contain" />
        )}

        <h1 className="font-display text-2xl font-bold">{link.name}</h1>
        {link.description && <p className="mt-2 text-ink-500">{link.description}</p>}

        <div className="mt-6">
          <PublicUploader
            slug={link.slug}
            requireName={link.require_name}
            requireEmail={link.require_email}
            showMessageField={link.show_message_field}
            maxFileSizeMb={link.max_file_size_mb}
            allowedMimeTypes={link.allowed_mime_types}
            accent={accent}
            hideName={link.hide_name}
            hideEmail={link.hide_email}
            prefillName={link.prefill_name}
            prefillEmail={link.prefill_email}
            customFields={link.visible_custom_fields}
            successMessage={link.success_message}
            successRedirectUrl={link.success_redirect_url}
            requiresPassword={link.requires_password}
          />
        </div>
      </div>
    </>
  );
}
