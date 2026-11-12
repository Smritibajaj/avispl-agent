/**
 * The AVI-SPL name as plain text, set like the wordmark: heavy capitals with the brand teal on the hyphen
 * (where the logo has its teal arrow). Text only, no logo artwork.
 */
export function BrandText({ className }: { className?: string }) {
  return (
    <span className={className ? `brand-text ${className}` : "brand-text"} aria-label="AVI-SPL">
      AVI<span className="brand-dash" aria-hidden="true">-</span>SPL
    </span>
  );
}
