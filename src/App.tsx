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
  loadUserAnnotations,
  updateUserAnnotation,
} from "./db/userAnnotations";
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

  useEffect(() => {
    loadCatalog()
      .then((loadedWork) => {
        setWork(loadedWork);
        setCurrentVolume(loadedWork.volumes[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

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
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [work]);

  // Re-read from IndexedDB after every mutation so the DOM always reflects what
  // was actually persisted, rather than optimistic local state.
  const refreshUserAnnotations = useCallback(async () => {
    if (!work) {
      return;
    }
    setUserAnnotations(await loadUserAnnotations(work.id));
  }, [work]);

  const handleCreateUserAnnotation = useCallback(
    async (draft: {
      anchor: UserAnnotation["anchor"];
      style: UserAnnotation["style"];
      color: string;
      opacity: number;
      note: string;
    }): Promise<UserAnnotation> => {
      if (!work) {
        throw new Error("work not loaded");
      }
      const created = await createUserAnnotation({
        workId: work.id,
        editionId: work.editionId,
        ...draft,
      });
      await refreshUserAnnotations();
      return created;
    },
    [refreshUserAnnotations, work],
  );

  const handleUpdateUserAnnotation = useCallback(
    async (
      id: string,
      changes: Partial<Pick<UserAnnotation, "style" | "color" | "opacity" | "note">>,
    ) => {
      await updateUserAnnotation(id, changes);
      await refreshUserAnnotations();
    },
    [refreshUserAnnotations],
  );

  const handleDeleteUserAnnotation = useCallback(
    async (id: string) => {
      await deleteUserAnnotation(id);
      await refreshUserAnnotations();
    },
    [refreshUserAnnotations],
  );

  const handleSelectVolume = (volume: VolumeRef) => {
    setCurrentVolume(volume);
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
          <Reader
            passages={passages}
            sourceNotes={sourceNotes}
            properNames={publishedProperNames}
            annotations={publishedAnnotations}
            userAnnotations={userAnnotations}
            writingMode={preferences.writingMode}
            showProperNames={preferences.showProperNames}
            scrollKey={scrollKey}
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
          />
        </div>
      </div>
    </div>
  );
}

export default App;
