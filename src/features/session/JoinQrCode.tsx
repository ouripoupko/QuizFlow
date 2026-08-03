import { useEffect, useState } from "react";
import QRCode from "qrcode";
import styles from "./JoinQrCode.module.scss";

interface Props {
  value: string;
}

// Rendered as SVG (vector — the library's output has a viewBox but no fixed
// width/height, so CSS scales it up cleanly with no pixelation) and at a
// high error-correction level, so it stays scannable at a distance even with
// some camera skew/glare when projected on a classroom board.
export function JoinQrCode({ value }: Props) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(value, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 1,
    }).then((s) => {
      if (!cancelled) setSvg(s);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!svg) return null;

  // The library's own output — not user-controlled input, so this is safe.
  return <div className={styles.qr} dangerouslySetInnerHTML={{ __html: svg }} />;
}
