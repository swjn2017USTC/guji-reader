import type { VolumeRef, Work } from "../types/corpus";
import styles from "./Sidebar.module.css";

type SidebarProps = {
  work: Work;
  currentVolumeId: string;
  onSelectVolume: (volume: VolumeRef) => void;
};

export function Sidebar({ work, currentVolumeId, onSelectVolume }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="卷目錄">
      <div className={styles.header}>
        <h2 className={styles.bookTitle}>{work.title}</h2>
      </div>
      <ul className={styles.volumeList}>
        {work.volumes.map((volume) => (
          <li key={volume.id}>
            <button
              type="button"
              className={
                volume.id === currentVolumeId
                  ? styles.volumeButtonActive
                  : styles.volumeButton
              }
              onClick={() => onSelectVolume(volume)}
              aria-current={volume.id === currentVolumeId ? "page" : undefined}
            >
              {volume.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
