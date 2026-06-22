import React from "react";

export default function PageFeedback({ status, error }: { status: string; error: string }) {
  if (!status && !error) return null;

  return (
    <div aria-live="polite" className="page-feedback">
      {status ? <div className="notice">{status}</div> : null}
      {error ? <div className="notice notice-danger">{error}</div> : null}
    </div>
  );
}
