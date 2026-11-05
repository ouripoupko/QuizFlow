import { useState } from "react";
import { createPortal } from "react-dom";
import styles from "./ZoomableThumb.module.scss";

const ZOOM_GAP_PX = 8;

interface Zoom {
  left: number;
  top: number;
  placement: "above" | "below";
}

interface Props {
  url: string;
  alt: string;
  /** Shown under the thumbnail, e.g. "תמונה 2". */
  caption?: string;
}

// A small image that shows a large preview on hover and opens full size on
// click. The preview is portaled to <body> (position: fixed) so a card's
// `overflow: hidden` can't clip it; it opens below the thumbnail in the top
// half of the screen and above it in the bottom half (same as the editor's
// ImageUploader).
export function ZoomableThumb({ url, alt, caption }: Props) {
  const [zoom, setZoom] = useState<Zoom | null>(null);

  function show(el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const inTopHalf = rect.top < window.innerHeight / 2;
    setZoom({
      left: rect.left + rect.width / 2,
      top: inTopHalf ? rect.bottom + ZOOM_GAP_PX : rect.top - ZOOM_GAP_PX,
      placement: inTopHalf ? "below" : "above",
    });
  }

  return (
    <figure className={styles.figure}>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={styles.link}
        onMouseEnter={(e) => show(e.currentTarget)}
        onMouseLeave={() => setZoom(null)}
      >
        <img src={url} alt={alt} className={styles.img} />
      </a>
      {caption && <figcaption className={styles.caption}>{caption}</figcaption>}
      {zoom && createPortal(
        <img
          src={url}
          alt=""
          className={styles.zoom}
          style={{
            left: zoom.left,
            top: zoom.top,
            transform: `translate(-50%, ${zoom.placement === "above" ? "-100%" : "0"})`,
          }}
        />,
        document.body,
      )}
    </figure>
  );
}
