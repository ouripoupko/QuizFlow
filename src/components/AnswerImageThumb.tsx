import { useAnswerImageUrl } from "@/lib/answerImages";
import { ZoomableThumb } from "./ZoomableThumb";
import styles from "./AnswerImageThumb.module.scss";

interface Props {
  /** Path in the answer-images bucket. */
  path: string;
  alt: string;
}

// A student's answer image: thumbnail, larger on hover, full size on click
// (the signed URL lasts an hour).
export function AnswerImageThumb({ path, alt }: Props) {
  const url = useAnswerImageUrl(path);
  if (!url) return <span className={styles.placeholder} />;
  return <ZoomableThumb url={url} alt={alt} />;
}
