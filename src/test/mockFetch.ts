import catalog from "./fixtures/catalog.json";
import vol01 from "./fixtures/vol01.json";
import vol01Annotations from "./fixtures/vol01_annotations.json";
import vol01Notes from "./fixtures/vol01_notes.json";
import vol02 from "./fixtures/vol02.json";

const FIXTURES: Record<string, object> = {
  "/data/catalog.json": catalog,
  "/data/works/test-work/vol01.json": vol01,
  "/data/works/test-work/vol02.json": vol02,
  "/data/source_notes/test-work/vol01.json": vol01Notes,
  "/data/source_notes/test-work/vol02.json": [],
  "/data/annotations/test-work/vol01.json": vol01Annotations,
  "/data/annotations/test-work/vol02.json": {
    workId: "test-work",
    volumeId: "vol02",
    annotations: [],
    properNames: [],
  },
};

/**
 * Serve the fixture corpus. `overrides` replaces individual fixture payloads so
 * a test can inject malformed or drifted data (e.g. an anchor whose exact no
 * longer matches the text).
 */
export function mockFetch(overrides: Record<string, object> = {}): void {
  const fixtures = { ...FIXTURES, ...overrides };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const data = fixtures[url];
    if (data === undefined) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
}

export function resetFetchMock(): void {
  vi.restoreAllMocks();
}
