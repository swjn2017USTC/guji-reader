# Data and attribution notice

The MIT license in `LICENSE` applies to the original source code, scripts,
tests, configuration, and project documentation in this repository unless a
file states otherwise. It does **not** automatically license source-derived
corpus data, third-party material, or model-generated annotation artifacts.

## Wikisource-derived corpus

The reader imports text from [Chinese Wikisource](https://zh.wikisource.org/).
The current catalog records the source work URL and retrieval timestamp. Before
redistributing a generated corpus or a substantial excerpt, verify the license
and attribution requirements of the specific Wikisource pages and revisions
(including their footer, history, and discussion pages). Preserve the source
URL, retrieval date, provenance, and any required indication of changes.

Ancient underlying works may be public domain, while transcription, editorial
markup, page structure, and imported contributions can carry separate terms.
This repository therefore makes no blanket MIT or public-domain claim for the
source-derived text.

## AI annotations and review artifacts

`data/ai_annotations/`, `data/review_reports/`, and published annotation files
contain model-generated and human-reviewed material. Their reuse may be
subject to the model provider's terms, the underlying source terms, and the
reviewer's rights. Treat them as provenance-bearing project artifacts unless a
file or release note explicitly grants an additional license.

## Runtime user data

Personal highlights and notes are stored locally in IndexedDB by the running
reader. They are not a project-owned dataset and are not included in this
notice.
