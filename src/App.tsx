import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar } from "./components/Topbar";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { Reader } from "./reader/Reader";
import { loadCatalog } from "./data/catalog";
import { loadPublishedAnnotations } from "./data/annotations";
import {
  createUserAnnotation,
  deleteUserAnnotation,
  importUserAnnotations,
  loadUserAnnotations,
  updateUserAnnotation,
} from "./db/userAnnotations";
import { createAnnotationBackup, parseAnnotationBackupText } from "./data/annotationBackup";
import { loadSourceNotes } from "./data/sourceNotes";
import { loadVolume } from "./data/volume";
import { usePreferences } from "./hooks/usePreferences";
import type { Passage, VolumeRef, Work } from "./types/corpus";
import type { SourceNote } from "./types/corpus";
import type {
  PublishedAnnotation,
  PublishedProperName,
} from "./types/annotations";
import type { UserAnnotation } from "./types/corpus";
import "./styles/themes.css";
import "./styles/layout.css";
import styles from "./App.module.css";

function readPassageFromHash(): string | null {
  const value = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("passage");
  return value ? value : null;
}

function App() {
  const {
    preferences,
    setFontSize,
    setLineHeight,
    toggleSidebar,
    toggleSettings,
    toggleProperNames,
    cycleTheme,
    toggleWritingMode,
  } = usePreferences();

  const [work, setWork] = useState<Work | null>(null);
  const [currentVolume, setCurrentVolume] = useState<VolumeRef | null>(null);
  const [passages, setPassages] = useState<Passage[]>([]);
  const [sourceNotes, setSourceNotes] = useState<SourceNote[]>([]);
  const [publishedAnnotations, setPublishedAnnotations] = useState<
    PublishedAnnotation[]
  >([]);
  const [publishedProperNames, setPublishedProperNames] = useState<
    PublishedProperName[]
  >([]);
  const [userAnnotations, setUserAnnotations] = useState<UserAnnotation[]>([]);
  const [error, setError] = useState<string | null>(null);
  /*
   * Personal annotations live in IndexedDB, which can be unavailable (disabled,
   * private mode, quota exhausted). That must never take the reader down with
   * it: the canonical text, 古注 and AI annotations are served from static JSON
   * and stay usable, so this is reported as a degradation rather than a fatal
   * error (plan §1.1 — the UI must not depend on any one layer being present).
   */
  const [annotationStoreError, setAnnotationStoreError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [initialPassageId] = useState(readPassageFromHash);

  const reportAnnotationStoreFailure = useCallback((err: unknown) => {
    setAnnotationStoreError(err instanceof Error ? err.message : String(err));
  }, []);

  useEffect(() => {
    loadCatalog()
      .then((loadedWork) => {
        setWork(loadedWork);
        const hashVolume = initialPassageId
          ? loadedWork.volumes.find((volume) =>
              initialPassageId.startsWith(`${loadedWork.id}:${volume.id}:`),
            )
          : null;
        setCurrentVolume(hashVolume ?? loadedWork.volumes[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [initialPassageId]);

  useEffect(() => {
    if (!work || !currentVolume) {
      return;
    }
    Promise.all([
      loadVolume(work.id, currentVolume.id),
      loadSourceNotes(work.id, currentVolume.id),
      loadPublishedAnnotations(work.id, currentVolume.id),
    ])
      .then(([loadedPassages, loadedNotes, loadedAnnotations]) => {
        setPassages(loadedPassages);
        setSourceNotes(loadedNotes);
        setPublishedAnnotations(loadedAnnotations.annotations);
        setPublishedProperNames(loadedAnnotations.properNames);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [work, currentVolume]);

  useEffect(() => {
    if (!work) {
      return;
    }
    let cancelled = false;
    loadUserAnnotations(work.id)
      .then((loaded) => {
        if (!cancelled) {
          setUserAnnotations(loaded);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          reportAnnotationStoreFailure(err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reportAnnotationStoreFailure, work]);

  // Re-read from IndexedDB after every mutation so the DOM always reflects what
  // was actually persisted, rather than optimistic local state.
  const refreshUserAnnotations = useCallback(async () => {
    if (!work) {
      return;
    }
    try {
      setUserAnnotations(await loadUserAnnotations(work.id));
      setAnnotationStoreError(null);
    } catch (err) {
      reportAnnotationStoreFailure(err);
    }
  }, [reportAnnotationStoreFailure, work]);

  const handleCreateUserAnnotation = useCallback(
    async (draft: {
      anchor: UserAnnotation["anchor"];
      style: UserAnnotation["style"];
      color: string;
      opacity: number;
      note: string;
    }): Promise<UserAnnotation | null> => {
      if (!work) {
        reportAnnotationStoreFailure("work not loaded");
        return null;
      }
      try {
        const created = await createUserAnnotation({
          workId: work.id,
          editionId: work.editionId,
          ...draft,
        });
        await refreshUserAnnotations();
        return created;
      } catch (err) {
        reportAnnotationStoreFailure(err);
        return null;
      }
    },
    [refreshUserAnnotations, reportAnnotationStoreFailure, work],
  );

  const handleUpdateUserAnnotation = useCallback(
    async (
      id: string,
      changes: Partial<Pick<UserAnnotation, "style" | "color" | "opacity" | "note">>,
    ) => {
      try {
        await updateUserAnnotation(id, changes);
        await refreshUserAnnotations();
      } catch (err) {
        reportAnnotationStoreFailure(err);
      }
    },
    [refreshUserAnnotations, reportAnnotationStoreFailure],
  );

  const handleDeleteUserAnnotation = useCallback(
    async (id: string) => {
      try {
        await deleteUserAnnotation(id);
        await refreshUserAnnotations();
      } catch (err) {
        reportAnnotationStoreFailure(err);
      }
    },
    [refreshUserAnnotations, reportAnnotationStoreFailure],
  );

  const handleExportAnnotations = useCallback(async () => {
    if (!work) return;
    try {
      const annotations = await loadUserAnnotations(work.id);
      const blob = new Blob(
        [JSON.stringify(createAnnotationBackup(work.id, work.editionId, annotations), null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${work.id}-annotations-v1.json`;
      link.click();
      URL.revokeObjectURL(url);
      setImportStatus(`已匯出 ${annotations.length} 筆個人標記。`);
    } catch (err) {
      setImportStatus(err instanceof Error ? `匯出失敗：${err.message}` : "匯出失敗。");
    }
  }, [work]);

  const handleImportAnnotations = useCallback(async (file: File) => {
    if (!work) return;
    try {
      const existing = await loadUserAnnotations(work.id);
      const result = parseAnnotationBackupText(
        await file.text(),
        work.id,
        work.editionId,
        existing,
      );
      await importUserAnnotations(result.annotations);
      await refreshUserAnnotations();
      setImportStatus(
        `已匯入 ${result.annotations.length} 筆，略過 ${result.skippedDuplicates} 筆重複標記。`,
      );
    } catch (err) {
      setImportStatus(err instanceof Error ? `匯入失敗：${err.message}` : "匯入失敗：格式無法識別。");
    }
  }, [refreshUserAnnotations, work]);

  const handleSelectVolume = (volume: VolumeRef) => {
    setCurrentVolume(volume);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#volume=${encodeURIComponent(volume.id)}`,
    );
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", preferences.theme);
    document.documentElement.style.setProperty(
      "--font-size",
      `${preferences.fontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--line-height",
      String(preferences.lineHeight),
    );
  }, [preferences.theme, preferences.fontSize, preferences.lineHeight]);

  const scrollKey = useMemo(
    () => (currentVolume ? `${work?.id}:${currentVolume.id}` : ""),
    [work?.id, currentVolume?.id],
  );

  if (error) {
    return (
      <div className={styles.error}>
        <p>載入失敗：{error}</p>
        <p>請先執行 scripts/sync_wikisource.py 與 scripts/build_catalog.py。</p>
      </div>
    );
  }

  if (!work || !currentVolume) {
    return <div className={styles.loading}>載入中…</div>;
  }

  return (
    <div className="reader-app">
      <Topbar
        bookTitle={work.title}
        volumeTitle={currentVolume.title}
        theme={preferences.theme}
        writingMode={preferences.writingMode}
        sidebarOpen={preferences.sidebarOpen}
        settingsOpen={preferences.settingsOpen}
        showProperNames={preferences.showProperNames}
        onToggleSidebar={toggleSidebar}
        onToggleSettings={toggleSettings}
        onToggleProperNames={toggleProperNames}
        onCycleTheme={cycleTheme}
        onToggleWritingMode={toggleWritingMode}
      />
      <div className="reader-body">
        <div
          className={
            preferences.sidebarOpen ? "reader-sidebar" : "reader-sidebar collapsed"
          }
        >
          <Sidebar
            work={work}
            currentVolumeId={currentVolume.id}
            onSelectVolume={handleSelectVolume}
          />
        </div>
        <main className="reader-main">
          {annotationStoreError && (
            <p className={styles.degraded} role="status" data-annotation-store-error>
              個人標記暫時無法使用（瀏覽器儲存不可用），正文與註釋仍可正常閱讀。
            </p>
          )}
          <Reader
            passages={passages}
            sourceNotes={sourceNotes}
            properNames={publishedProperNames}
            annotations={publishedAnnotations}
            userAnnotations={userAnnotations}
            writingMode={preferences.writingMode}
            showProperNames={preferences.showProperNames}
            scrollKey={scrollKey}
            initialPassageId={initialPassageId}
            onCreateUserAnnotation={handleCreateUserAnnotation}
            onUpdateUserAnnotation={handleUpdateUserAnnotation}
            onDeleteUserAnnotation={handleDeleteUserAnnotation}
          />
        </main>
        <div
          className={
            preferences.settingsOpen
              ? "reader-settings"
              : "reader-settings collapsed"
          }
        >
          <SettingsPanel
            fontSize={preferences.fontSize}
            lineHeight={preferences.lineHeight}
            onFontSizeChange={setFontSize}
            onLineHeightChange={setLineHeight}
            onExportAnnotations={handleExportAnnotations}
            onImportAnnotations={handleImportAnnotations}
            importStatus={importStatus}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
