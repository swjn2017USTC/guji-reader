"""AI annotation pipeline: prompts, span materialization, review, publish gate.

Design decisions worth knowing:

1. The model never emits character offsets. It emits ``exact``/``prefix``/
   ``suffix`` copied from the source, and this module computes ``start``/``end``
   deterministically. Models miscount characters; they copy substrings well.
2. Model-supplied ``prefix``/``suffix`` are disambiguation hints only. They are
   re-derived from the passage before storage, because the model often drops
   intervening punctuation (e.g. writes ``初命晉大夫魏斯`` when the text is
   ``初命晉大夫魏斯、``).
3. ``start``/``end`` are Unicode code-point offsets, which is what Python
   slicing means natively. JS slicing is UTF-16 based, so the UI converts at the
   boundary (see ``src/reader/anchors.ts``). The corpus contains non-BMP
   characters, so this distinction is load-bearing.
4. The reviewer receives only the canonical passage, the candidate spans and the
   rubric. Generator reasoning is never produced, stored, or forwarded.
"""

import json
from typing import Any, Optional

from python.src.annotations import (
    ANNOTATION_CATEGORIES,
    PROPER_NAME_TYPES,
    AnnotationCandidate,
    AnnotationReview,
    CandidateAnnotation,
    ProperNameSpan,
    PublishedAnnotation,
    PublishedProperName,
    RawAnnotationPayload,
    annotation_id,
    proper_name_id,
)
from python.src.models import Passage, TextAnchor

# Structural sanity caps only: they catch pathological output. Concision is the
# reviewer's job (see verbosity_control in the rubric), not a hard structural limit.
MAX_ANNOTATIONS_PER_PASSAGE = 40
MAX_PROPER_NAMES_PER_PASSAGE = 40

# Width of the canonical prefix/suffix window stored on every anchor, in code points.
CONTEXT_WINDOW = 8

# Enumeration separator in classical Chinese. A span covering 「幽、厲」 or
# 「晉、楚、齊、秦」 is several entities, and must not draw one unbroken line.
ENUMERATION_SEPARATOR = "、"

# The spec states 官職本身不自動畫專名線. These are 身分／爵位／官職通稱 and
# 氏族／卿族泛稱: categories that must never carry a proper-name line under any
# type, INSTITUTION included. The model kept drawing lines on them across
# several runs, so the ban is enforced structurally and surfaced through the
# repair round rather than trusted to the prompt.
BANNED_PROPER_NAME_TERMS: frozenset[str] = frozenset(
    {
        "天子",
        "諸侯",
        "公",
        "侯",
        "卿",
        "大夫",
        "士",
        "士庶人",
        "君",
        "臣",
        "先王",
        "季氏",
        "三桓",
        "田氏",
        "三家",
    }
)


class AnchorError(ValueError):
    """Raised when a span cannot be located in the canonical passage text."""


class PublishGateError(RuntimeError):
    """Raised when the publish gate is asked to publish an unpublishable record."""


RUBRIC = """\
評分標準（每項 1–5 整數，5 最好）：
- proper_name_precision：專名 span 是否真的是專名、邊界是否正確（含不含多餘字）
- proper_name_recall：本段明顯該畫線的專名是否基本都畫了
- entity_resolution：同一人物的代稱是否正確歸一
- place_accuracy：地名是否準確，不確定時是否有「約/大致/今某地一帶」等限定
- term_necessity：難詞註釋是否必要，有沒有為明顯詞語強行加註
- office_accuracy：官職職能是否綁定本段時代，沒有拿後朝制度硬套
- first_appearance_accuracy：首次重要出場判斷是否合理
- verbosity_control：註文長度是否克制（以 30–80 字為主），沒有長篇大論
- unsupported_claim_risk：分數越高＝越沒有無根據的斷言（不偽造精確年代、座標、世系）

結論：
- accept：可直接發布
- revise：有可修正的問題，必須附上完整 revisedAnnotations
- reject：整體不可用，不附 revisedAnnotations
不得為了覆蓋率而放寬標準。寧可 reject，也不要發布錯誤註釋。"""

_SPAN_RULES = f"""\
- 只輸出 JSON，不要任何解釋文字、不要 markdown code fence。
- 所有 span 一律用 exact / prefix / suffix 表示，絕對不要輸出字元位置或 offset。
  exact 必須是原文的精確子串，逐字複製，不得改字、不得增刪標點。
  prefix 是 exact 前面的一小段原文，suffix 是後面的一小段原文（各 6–15 字，用於消歧）。
  若 exact 在原文中只出現一次，prefix / suffix 可為空字串。
- properNames[].type 只能是：{" / ".join(PROPER_NAME_TYPES)}。官職本身不畫專名線。
- annotations[].category 只能是：{" / ".join(ANNOTATION_CATEGORIES)}。
  STATE / ETHNICITY / DYNASTY / REIGN / RELIGION / INSTITUTION 這幾個值是
  properNames[].type 專用，**不可**用在 annotations[].category。
- annotations 的 layer 與 category 必須匹配：
  layer=1 → PERSON / PLACE / TERM
  layer=2 → OFFICE / FIRST_APPEARANCE"""

GENERATOR_SCHEMA_HINT = """\
{"properNames":[{"exact":"","prefix":"","suffix":"","type":"PERSON"}],
 "annotations":[{"exact":"","prefix":"","suffix":"","layer":1,"category":"PERSON",
                 "text":"","confidence":0.9}]}"""

REVIEWER_SCHEMA_HINT = """\
{"overall":"accept|revise|reject",
 "scores":{"proper_name_precision":1,"proper_name_recall":1,"entity_resolution":1,
           "place_accuracy":1,"term_necessity":1,"office_accuracy":1,
           "first_appearance_accuracy":1,"verbosity_control":1,
           "unsupported_claim_risk":1},
 "issues":[{"severity":"blocker|major|minor","message":""}],
 "revisedAnnotations":{"properNames":[],"annotations":[]}}"""

GENERATOR_SYSTEM_PROMPT = f"""\
你是《資治通鑑》古文的專業註釋助手。給定一段繁體古文，你要產出：
1. 專名 spans（用於畫專名線）
2. 第一層註釋：PERSON / PLACE / TERM
3. 第二層註釋：OFFICE / FIRST_APPEARANCE

嚴格規則：
{_SPAN_RULES}
- 專名線只畫**具體專名**。允許的類型僅限：具體人物 PERSON、具體地名 PLACE、
  具體國名或政權 STATE、朝代 DYNASTY、民族 ETHNICITY、年號 REIGN、宗教 RELIGION、
  真正的機構或學派 INSTITUTION（如太學、稷下）。
- 下列詞**一律不畫專名線**，任何 type 都不行（包括 INSTITUTION）：
  - 身分／爵位／官職通稱：天子、諸侯、公、侯、卿、大夫、士、士庶人、君、臣、先王
  - 氏族／家族／卿族泛稱：季氏、三桓、田氏、三家
  - 事件名稱、篇題、成語、普通短語：如「三家分晉」「請隧」「履霜堅冰至」「悖逆之臣」
    ——事件與短語不是專名，整段也不可以因為它是標題就畫線
  - 典籍書名：如「易」「書」「春秋」「詩」
  這些詞若需說明，用 layer=2 OFFICE（官職、爵位、身分稱號）或 layer=1 TERM（制度、泛稱）。
- **不要為了繞過上述限制而擴大 span**：把「三家」改成「三家分晉」再標 INSTITUTION 同樣違規。
  規則看的是概念，不是字串。
- PERSON 必須是具體人物，例如「魏斯」「周威烈王」「智伯」「豫讓」。
  凡不能對應到具體某人的泛稱，不要畫線。
- **合稱必須拆開**：並列多個名字時，一個 span 只能放一個名字。
  「幽、厲」要輸出成兩個 span（幽 / 厲），「晉、楚、齊、秦」要輸出成四個 span。
  exact 中絕對不可以包含頓號「、」或連接詞「與」「及」「暨」。
  若無法確定其中某一個名字，就整組都不要輸出。
- **自稱不得與名字合併**：「臣光」的「臣」是自稱，不是姓名的一部分。
  應只標「光」，或整體不標。
- 允許單字 span，但**僅限**無疑的專名簡稱，例如以「桀」「紂」「湯」「武」
  指夏桀、商紂、商湯、周武王，以「幽」「厲」「桓」「文」指周幽王、周厲王、
  齊桓公、晉文公，以「晉」「衞」指晉國、衞國。
  這類單字必須在對應註文中說明所指為誰／何國。
  除此之外的單字（如「周」「分」「名」）容易誤標，改用更長的詞組或乾脆不註。
- 節制數量：一百字以內的短段，annotations 不超過 6 條；長段每百字不超過 5 條。
  優先註解真正影響理解的專名與難詞，不要逐詞加註。
- PERSON：字、號、官職、爵位、籍貫等代稱，盡量歸一到同一人；只寫本段閱讀所需，以 30–80 字為主。
- PLACE：古地名，給現代大致位置。不確定必須寫「約」「大致」「今某地一帶」，不得偽造精確座標。
- TERM：高中文化程度可能難懂的文言詞、古今異義、特殊語法、制度詞。不要為明顯詞語強行加註。
- OFFICE：官職、爵位、身分稱號在**本段時代**的大致職能，不得用後朝制度硬套。
- FIRST_APPEARANCE：本段中非主角重要人物的首次重要出場。
- confidence：0 到 1 的小數，表示你對該條註釋的把握。
- 寧缺勿濫。不確定就不要輸出該條。

輸出 JSON 結構：
{GENERATOR_SCHEMA_HINT}"""

REVIEWER_SYSTEM_PROMPT = f"""\
你是獨立的古文註釋審核者。你只會拿到三樣東西：繁體古文原文、另一個人產出的候選註釋 JSON、以及評分標準。
你看不到對方的推理過程，也不需要猜測；你只根據原文與候選 JSON 本身判斷。

嚴格規則：
- 逐項核對：exact 是否真的是原文子串；該詞是否真的需要註；註文是否準確；
  地名是否裝精確；官職是否時代錯置；是否過度註釋普通詞；是否出現原文沒有的斷言。
- 專名線額外核對（這幾項最常出錯，務必逐條檢查）：
  - 一個 properNames span 只能有一個名字。若 exact 含頓號「、」或「與」「及」「暨」，
    就是合稱沒拆開，屬 major 問題。
  - 身分／爵位／官職通稱（天子、諸侯、公、侯、卿、大夫、士、士庶人、君、臣、先王）
    與氏族／家族／卿族泛稱（季氏、三桓、田氏、三家）**不得畫專名線**，
    任何 type 都不行，包括 INSTITUTION。用 INSTITUTION 標這類詞同屬 major 問題。
  - 事件名稱、篇題、成語、普通短語（三家分晉、請隧、悖逆之臣）與典籍書名（易、書、春秋）
    不是專名，不得畫線；藉由擴大 span 來規避限制（把「三家」寫成「三家分晉」）同屬違規。
  - 自稱（臣、僕、愚）不得與名字併成一個 PERSON span。
- **以下不是問題，不要列為 issue、不要因此扣分或 reject**：
  - 合稱已拆成多個單字 span，例如「幽、厲」拆成「幽」「厲」，「桓、文」拆成「桓」「文」。
    這是規定的正確做法：不同實體之間必須斷線。**拆開是要求，合併才是錯誤。**
  - 單字 span 只要是無疑的專名簡稱（桀、紂、湯、武、幽、厲、桓、文、晉、衞），即屬正常，
    不得因「邊界過窄」或「單字」而視為缺陷。
- 若註文有事實錯誤（人物、年代、制度、方向、因果顛倒），一律記為 major。
- 評分為 1–5 整數。
- 結論：
  - accept：候選可直接發布
  - revise：只有**少量、局部、可逐條修正**的缺陷，且修正後整體可用；必須同時給出 revisedAnnotations（完整替換版）
  - reject：整體不可用，不要給 revisedAnnotations
- 以下情形必須 reject，不得用 revise 帶過：
  - 任何 severity=blocker 的問題（原文沒有的斷言、錨定到錯誤文字、史實硬傷）
  - 系統性錯誤：多數條目（超過一半）類型標錯，或整體可信度不足
  - 嚴重過度註釋：一百字以內短段的 annotations 超過 8 條
- **多數缺陷都是可以逐條修正的**，這種情況用 revise 並直接改好，不要 reject。
  例如：某個 span 類型標錯、某個詞不該畫線、某條註文有事實錯誤、某個合稱未拆開——
  這些都屬於「局部可修正」，必須用 revise 並在 revisedAnnotations 中改對。
  只有當你認為改不動、或整段都不可信時，才用 reject。
- 不要為了覆蓋率而放寬標準，但也不要因為問題數量多就放棄可修正的候選。
  判準是「修正後是否可用」，不是「問題有幾條」。

當你輸出 revisedAnnotations 時，適用同樣的 span 規則：
{_SPAN_RULES}

輸出 JSON 結構：
{REVIEWER_SCHEMA_HINT}"""


def _all_occurrences(haystack: str, needle: str) -> list[int]:
    if not needle:
        return []
    positions: list[int] = []
    cursor = haystack.find(needle)
    while cursor != -1:
        positions.append(cursor)
        cursor = haystack.find(needle, cursor + 1)
    return positions


def locate_span(
    passage_text: str, exact: str, prefix: str = "", suffix: str = ""
) -> tuple[int, int]:
    """Resolve a copied substring to code-point offsets in ``passage_text``."""
    if not exact:
        raise AnchorError("empty exact span")
    if not isinstance(passage_text, str):
        raise AnchorError("passage text must be a string")

    occurrences = _all_occurrences(passage_text, exact)
    if not occurrences:
        raise AnchorError(f"exact not found in passage: {exact!r}")

    if len(occurrences) == 1:
        start = occurrences[0]
        return start, start + len(exact)

    # The model's prefix/suffix are hints, and are often not immediately adjacent
    # (it drops intervening punctuation). Empty hints carry no information.
    prefix_info = bool(prefix)
    suffix_info = bool(suffix)

    def prefix_matches(start: int) -> bool:
        return prefix_info and passage_text[:start].endswith(prefix)

    def suffix_matches(start: int) -> bool:
        return suffix_info and passage_text[start + len(exact) :].startswith(suffix)

    both = [s for s in occurrences if prefix_matches(s) and suffix_matches(s)]
    if len(both) == 1:
        return both[0], both[0] + len(exact)
    if len(both) > 1:
        raise AnchorError(
            f"exact {exact!r} is ambiguous: {len(both)} occurrences match both "
            f"prefix {prefix!r} and suffix {suffix!r}"
        )

    # Exactly one side matched: the prefix is the stronger signal, since it is
    # the text the model read immediately before the span it meant.
    for matches, label in ((prefix_matches, "prefix"), (suffix_matches, "suffix")):
        candidates = [s for s in occurrences if matches(s)]
        if len(candidates) == 1:
            return candidates[0], candidates[0] + len(exact)
        if len(candidates) > 1:
            raise AnchorError(
                f"exact {exact!r} is ambiguous: {len(candidates)} occurrences "
                f"match the {label} hint"
            )

    raise AnchorError(
        f"exact {exact!r} occurs {len(occurrences)} times and neither prefix "
        f"{prefix!r} nor suffix {suffix!r} identifies one of them"
    )


def anchor_from_range(passage: Passage, start: int, end: int) -> TextAnchor:
    """Build a verified anchor from a known, already-resolved range.

    Unlike ``build_anchor`` this never searches for the substring, so it is
    unambiguous even for a single character. Used when splitting a compound span,
    where each part's position is derived from the parent's known offset.
    """
    anchor = TextAnchor(
        passageId=passage.id,
        start=start,
        end=end,
        exact=passage.text[start:end],
        prefix=passage.text[max(0, start - CONTEXT_WINDOW) : start],
        suffix=passage.text[end : end + CONTEXT_WINDOW],
    )
    verify_anchor(anchor, passage.text)
    return anchor


def split_enumerated_span(
    passage: Passage, anchor: TextAnchor, type_: str
) -> list[ProperNameSpan]:
    """Split a 頓號-joined proper-name span into one span per name.

    The V0.1 spec requires a break between two consecutive but different
    entities. A single span covering 「幽、厲」 would draw one unbroken line
    across both, so enumeration is split deterministically rather than trusted
    to the model. Part offsets come from the parent range, so even single-
    character parts such as 「幽」 are located without ambiguity.
    """
    parts = anchor.exact.split(ENUMERATION_SEPARATOR)
    if len(parts) == 1:
        return [ProperNameSpan(anchor=anchor, type=type_)]

    spans: list[ProperNameSpan] = []
    cursor = anchor.start
    for part in parts:
        if part:
            spans.append(
                ProperNameSpan(
                    anchor=anchor_from_range(passage, cursor, cursor + len(part)),
                    type=type_,
                )
            )
        cursor += len(part) + len(ENUMERATION_SEPARATOR)
    return spans


def build_anchor(
    passage: Passage, exact: str, prefix: str = "", suffix: str = ""
) -> TextAnchor:
    """Materialize a verified anchor for ``exact`` inside ``passage``."""
    start, end = locate_span(passage.text, exact, prefix, suffix)
    anchor = TextAnchor(
        passageId=passage.id,
        start=start,
        end=end,
        exact=passage.text[start:end],
        prefix=passage.text[max(0, start - CONTEXT_WINDOW) : start],
        suffix=passage.text[end : end + CONTEXT_WINDOW],
    )
    if anchor.exact != exact:
        raise AnchorError(
            f"materialized exact {anchor.exact!r} != requested {exact!r}"
        )
    return anchor


def verify_anchor(anchor: TextAnchor, passage_text: str) -> None:
    """Fail loudly if an anchor does not describe the canonical text exactly."""
    if anchor.start >= anchor.end:
        raise AnchorError(
            f"{anchor.passageId}: start {anchor.start} >= end {anchor.end}"
        )
    if anchor.end > len(passage_text):
        raise AnchorError(
            f"{anchor.passageId}: end {anchor.end} beyond text length {len(passage_text)}"
        )
    sliced = passage_text[anchor.start : anchor.end]
    if sliced != anchor.exact:
        raise AnchorError(
            f"{anchor.passageId}: anchor.exact {anchor.exact!r} does not match "
            f"canonical text[{anchor.start}:{anchor.end}] {sliced!r}"
        )
    if anchor.suffix and not passage_text[anchor.end :].startswith(anchor.suffix):
        raise AnchorError(f"{anchor.passageId}: suffix does not follow anchor")
    if anchor.prefix and not passage_text[: anchor.start].endswith(anchor.prefix):
        raise AnchorError(f"{anchor.passageId}: prefix does not precede anchor")


def verify_candidate(candidate: AnnotationCandidate, passage_text: str) -> None:
    for span in candidate.properNames:
        verify_anchor(span.anchor, passage_text)
    for annotation in candidate.annotations:
        verify_anchor(annotation.anchor, passage_text)


def materialize_candidate(passage: Passage, raw: Any) -> AnnotationCandidate:
    """Convert model output (exact/prefix/suffix spans) into a verified candidate."""
    payload = raw if isinstance(raw, RawAnnotationPayload) else RawAnnotationPayload(**raw)
    if len(payload.properNames) > MAX_PROPER_NAMES_PER_PASSAGE:
        raise AnchorError(f"too many proper-name spans: {len(payload.properNames)}")
    if len(payload.annotations) > MAX_ANNOTATIONS_PER_PASSAGE:
        raise AnchorError(f"too many annotations: {len(payload.annotations)}")

    proper_names: list[ProperNameSpan] = []
    for span in payload.properNames:
        anchor = build_anchor(passage, span.exact, span.prefix, span.suffix)
        proper_names.extend(split_enumerated_span(passage, anchor, span.type))

    if len(proper_names) > MAX_PROPER_NAMES_PER_PASSAGE:
        raise AnchorError(
            f"too many proper-name spans after splitting enumeration: {len(proper_names)}"
        )

    annotations = [
        CandidateAnnotation(
            anchor=build_anchor(
                passage, item.exact, item.prefix, item.suffix
            ),
            layer=item.layer,
            category=item.category,
            text=item.text,
            confidence=item.confidence,
        )
        for item in payload.annotations
    ]

    candidate = AnnotationCandidate(
        passageId=passage.id, properNames=proper_names, annotations=annotations
    )
    verify_candidate(candidate, passage.text)
    _reject_banned_proper_names(candidate)
    return candidate


def _reject_banned_proper_names(candidate: AnnotationCandidate) -> None:
    """Fail loudly when a 通稱 or 氏族泛稱 carries a proper-name line.

    Raising here routes the problem into the generator's repair round, which
    tells the model exactly which term was wrong and how to express it instead.
    """
    offending = sorted(
        {
            span.anchor.exact
            for span in candidate.properNames
            if span.anchor.exact in BANNED_PROPER_NAME_TERMS
        }
    )
    if offending:
        raise AnchorError(
            "properNames must not contain 身分／爵位／官職通稱 or 氏族泛稱: "
            + ", ".join(repr(term) for term in offending)
            + ". Remove it from properNames; if it needs explaining, use an "
            "annotation with layer=2 category=OFFICE or layer=1 category=TERM."
        )


def candidate_to_raw(candidate: AnnotationCandidate) -> dict[str, Any]:
    """Present a candidate to the reviewer without offsets."""
    return {
        "properNames": [
            {
                "exact": span.anchor.exact,
                "prefix": span.anchor.prefix,
                "suffix": span.anchor.suffix,
                "type": span.type,
            }
            for span in candidate.properNames
        ],
        "annotations": [
            {
                "exact": item.anchor.exact,
                "prefix": item.anchor.prefix,
                "suffix": item.anchor.suffix,
                "layer": item.layer,
                "category": item.category,
                "text": item.text,
                "confidence": item.confidence,
            }
            for item in candidate.annotations
        ],
    }


def parse_review(passage_id: str, raw: dict[str, Any]) -> AnnotationReview:
    """Validate a reviewer response, normalizing the parts we can legally fix.

    ``revisedAnnotations`` is only meaningful for ``overall == "revise"``, and
    the model has no reason to know the passage id, so both are normalized here.
    Everything else must already be valid.
    """
    payload = dict(raw)
    payload.pop("passageId", None)  # the authoritative id comes from the caller
    overall = payload.get("overall")
    if overall == "revise":
        revised = payload.get("revisedAnnotations")
        if not isinstance(revised, dict):
            raise ValueError("overall=revise requires a revisedAnnotations object")
    else:
        payload.pop("revisedAnnotations", None)
    return AnnotationReview(passageId=passage_id, **payload)


def build_generator_messages(passage: Passage) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": GENERATOR_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"原文（passage id: {passage.id}），請為這一段生成 JSON 註釋：\n\n"
                f"{passage.text}"
            ),
        },
    ]


def build_reviewer_messages(
    passage_text: str, candidate: AnnotationCandidate
) -> list[dict[str, str]]:
    """Reviewer input: canonical text + candidate spans + rubric. Nothing else."""
    candidate_json = json.dumps(
        candidate_to_raw(candidate), ensure_ascii=False, indent=2
    )
    return [
        {"role": "system", "content": REVIEWER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"原文：\n\n{passage_text}\n\n"
                f"候選註釋 JSON：\n\n{candidate_json}\n\n"
                f"評分標準：\n\n{RUBRIC}\n\n"
                "請輸出你的審核 JSON。"
            ),
        },
    ]


def build_revised_candidate(
    passage: Passage, review: AnnotationReview
) -> AnnotationCandidate:
    if review.revisedAnnotations is None:
        raise PublishGateError(
            f"{review.passageId}: verdict=revise but no revisedAnnotations"
        )
    return materialize_candidate(passage, review.revisedAnnotations)


def apply_publish_gate(
    passage: Passage,
    candidate: AnnotationCandidate,
    review: AnnotationReview,
    *,
    work_id: str,
    volume_id: str,
) -> Optional[tuple[str, list[PublishedAnnotation], list[PublishedProperName]]]:
    """Return the published records for this passage, or None when rejected.

    accept -> generator output; revise -> reviewer revised output; reject -> nothing.
    """
    if review.passageId != passage.id or candidate.passageId != passage.id:
        raise PublishGateError(
            f"passage id mismatch: passage={passage.id} "
            f"candidate={candidate.passageId} review={review.passageId}"
        )

    if review.overall == "reject":
        return None

    if review.overall == "accept":
        chosen = candidate
        source = "generator"
    else:
        chosen = build_revised_candidate(passage, review)
        source = "reviewer"

    verify_candidate(chosen, passage.text)

    published_annotations = [
        PublishedAnnotation(
            id=annotation_id(
                passage.id, item.category, item.anchor.start, item.anchor.end
            ),
            workId=work_id,
            volumeId=volume_id,
            passageId=passage.id,
            anchor=item.anchor,
            layer=item.layer,
            category=item.category,
            text=item.text,
            confidence=item.confidence,
            source=source,
        )
        for item in chosen.annotations
    ]
    published_proper_names = [
        PublishedProperName(
            id=proper_name_id(
                passage.id, span.type, span.anchor.start, span.anchor.end
            ),
            workId=work_id,
            volumeId=volume_id,
            passageId=passage.id,
            anchor=span.anchor,
            type=span.type,
        )
        for span in chosen.properNames
    ]
    return source, published_annotations, published_proper_names


def summarize_reviews(reviews: list[AnnotationReview]) -> dict[str, Any]:
    """Aggregate verdict counts and per-dimension score averages."""
    from python.src.annotations import SCORE_FIELDS

    verdicts = {"accept": 0, "revise": 0, "reject": 0}
    score_totals = {name: 0 for name in SCORE_FIELDS}
    for review in reviews:
        verdicts[review.overall] += 1
        for name in SCORE_FIELDS:
            score_totals[name] += getattr(review.scores, name)

    reviewed = len(reviews)
    averages = {
        name: (round(score_totals[name] / reviewed, 3) if reviewed else None)
        for name in SCORE_FIELDS
    }
    overall_average = (
        round(sum(score_totals.values()) / (reviewed * len(SCORE_FIELDS)), 3)
        if reviewed
        else None
    )

    issue_counts: dict[str, int] = {"blocker": 0, "major": 0, "minor": 0}
    for review in reviews:
        for issue in review.issues:
            issue_counts[issue.severity] += 1

    return {
        "reviewedPassages": reviewed,
        "verdicts": verdicts,
        "averageScores": averages,
        "overallAverageScore": overall_average,
        "issueCounts": issue_counts,
    }


def build_quality_report(
    reviews: list[AnnotationReview],
    *,
    model: str,
    generated_at: str,
    work_id: str,
    published_volumes: Optional[list[str]] = None,
    published_annotation_count: int = 0,
    published_proper_name_count: int = 0,
) -> dict[str, Any]:
    """Final V0.1 annotation quality report written under data/review_reports/."""
    from python.src.annotations import SCORE_FIELDS

    summary = summarize_reviews(reviews)

    per_category: dict[str, dict[str, Any]] = {}
    for name in SCORE_FIELDS:
        values = [getattr(review.scores, name) for review in reviews]
        per_category[name] = {
            "average": round(sum(values) / len(values), 3) if values else None,
            "min": min(values) if values else None,
            "max": max(values) if values else None,
        }

    message_counts: dict[str, int] = {}
    message_severity: dict[str, str] = {}
    for review in reviews:
        for issue in review.issues:
            message_counts[issue.message] = message_counts.get(issue.message, 0) + 1
            message_severity.setdefault(issue.message, issue.severity)
    top_issues = sorted(
        (
            {
                "severity": message_severity[message],
                "message": message,
                "count": count,
            }
            for message, count in message_counts.items()
        ),
        key=lambda item: (-item["count"], item["message"]),
    )

    verdicts = summary["verdicts"]
    return {
        "generatedAt": generated_at,
        "model": model,
        "workId": work_id,
        "passagesReviewed": summary["reviewedPassages"],
        "verdicts": verdicts,
        "verdictRates": {
            key: (round(value / summary["reviewedPassages"], 3) if summary["reviewedPassages"] else None)
            for key, value in verdicts.items()
        },
        "rejectedPassages": [
            review.passageId for review in reviews if review.overall == "reject"
        ],
        "revisedPassages": [
            review.passageId for review in reviews if review.overall == "revise"
        ],
        "averageScores": summary["averageScores"],
        "overallAverageScore": summary["overallAverageScore"],
        "perCategoryScores": per_category,
        "issueCounts": summary["issueCounts"],
        "topIssues": top_issues,
        "published": {
            "volumes": sorted(published_volumes or []),
            "annotations": published_annotation_count,
            "properNames": published_proper_name_count,
        },
    }


__all__ = [
    "AnchorError",
    "GENERATOR_SCHEMA_HINT",
    "PublishGateError",
    "REVIEWER_SCHEMA_HINT",
    "RUBRIC",
    "apply_publish_gate",
    "build_anchor",
    "build_generator_messages",
    "build_quality_report",
    "build_reviewer_messages",
    "build_revised_candidate",
    "candidate_to_raw",
    "locate_span",
    "materialize_candidate",
    "parse_review",
    "summarize_reviews",
    "verify_anchor",
    "verify_candidate",
]
