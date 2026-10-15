/**
 * 论文可用状态（docs/03-requirements.md 第 28 行）。
 *
 * 元数据与 PDF 是两件事：行存在即元数据已找到；pdfUrl 表示已知一个开放获取
 * 地址；pdfPath 表示本站已缓存副本；只有缓存了副本才允许进入阅读器。状态由
 * 现有列推导，不额外落一份可能过期的冗余字段。
 */
export type PaperStage =
  | "metadata_found"
  | "pdf_available"
  | "pdf_cached"
  | "reading_available";

export type PaperAvailability = {
  metadataFound: boolean;
  pdfAvailable: boolean;
  pdfCached: boolean;
  readingAvailable: boolean;
  stage: PaperStage;
  errorCode: string | null;
  errorLabel: string | null;
};

export type PaperPdfFields = {
  pdfPath: string | null;
  pdfUrl: string | null;
  pdfFetchError: string | null;
};

/** 抓取失败原因的可读文案。未知原因码直接显示原码，不吞掉信息。 */
export const PDF_ERROR_LABELS: Record<string, string> = {
  NO_OPEN_PDF: "没有找到公开可用的 PDF",
  PDF_FETCH_FAILED: "来源站返回错误，未能下载",
  PDF_UNREACHABLE: "来源站无法访问",
  PDF_TOO_LARGE: "文件超过 60MB 上限",
  PDF_INVALID: "来源返回的内容不是有效 PDF",
  ALL_CANDIDATES_FAILED: "所有候选地址都下载失败",
};

export function pdfErrorLabel(code: string | null): string | null {
  if (!code) return null;
  return PDF_ERROR_LABELS[code] ?? code;
}

export function paperAvailability(row: PaperPdfFields): PaperAvailability {
  const pdfCached = Boolean(row.pdfPath);
  const pdfAvailable = Boolean(row.pdfUrl);
  const readingAvailable = pdfCached;
  const stage: PaperStage = readingAvailable
    ? "reading_available"
    : pdfCached
      ? "pdf_cached"
      : pdfAvailable
        ? "pdf_available"
        : "metadata_found";

  return {
    metadataFound: true,
    pdfAvailable,
    pdfCached,
    readingAvailable,
    stage,
    errorCode: row.pdfFetchError,
    errorLabel: pdfErrorLabel(row.pdfFetchError),
  };
}

export const STAGE_LABELS: Record<PaperStage, string> = {
  metadata_found: "仅有元数据，没有可用 PDF",
  pdf_available: "找到开放获取地址，尚未缓存",
  pdf_cached: "PDF 已缓存到本站",
  reading_available: "可以在线阅读",
};

/** 论文来源的中文标签；未知来源保留原值，避免出现空标签。 */
export function sourceLabel(source: string): string {
  if (source === "arxiv") return "arXiv";
  if (source === "doi") return "DOI";
  if (source === "upload") return "用户上传";
  return source;
}

export type PaperSourceLinks = {
  pdf: string | null;
  landing: string | null;
  doi: string | null;
};

/**
 * 外部来源链接（PAPER-005）。arXiv 记录用 ID 拼规范地址；DOI 记录走 doi.org，
 * 因此即使 OpenAlex 没有给出 landing page，读者也能打开原始来源。
 */
export function paperSourceLinks(row: {
  source: string;
  externalId: string | null;
  doi: string | null;
  pdfUrl: string | null;
}): PaperSourceLinks {
  const doi = row.doi ? `https://doi.org/${row.doi}` : null;
  let landing: string | null = null;
  if (row.source === "arxiv" && row.externalId) {
    landing = `https://arxiv.org/abs/${row.externalId.replace(/v\d+$/i, "")}`;
  } else if (doi) {
    landing = doi;
  }

  return { pdf: row.pdfUrl, landing, doi };
}
