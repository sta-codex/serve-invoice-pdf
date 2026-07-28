import JSZip from "jszip";
import { readFileSync } from "node:fs";
import { formatNumber, roundMoney } from "../domain/format.js";
import { getConfirmationLines } from "../services/confirmation-service.js";

const TEMPLATE_URL = new URL("../templates/confirmacion-pedido.docx", import.meta.url);
const VAT_RATE = 0.21;
const TABLE_WIDTHS = [650, 2350, 950, 1200, 1100, 1100, 1300, 1200];
const STA_HEADER_LEFT_MARGIN_REDUCTION_DXA = 432;
const LABEL_VALUE_PREFIXES = [
  "origen",
  "cantidad total",
  "condiciones de entrega",
  "condiciones de pago",
  "almacenajes",
  "detalles bancarios",
  "reclamaciones",
  "fuerza mayor"
];
const BANK_DETAILS_TEXT = "DETALLES BANCARIOS: CAIXA BANK - ES40 2100 6428 2213 0012 3884";
const FINAL_CONFIRMATION_TEXT =
  "Salvo comunicación expresa en contra por escrito dentro de las 24 horas siguientes a la recepción de esta confirmación, el pedido se dará por confirmado en todos sus términos.";
const RECLAMACIONES_TEXT =
  "RECLAMACIONES: Si se encuentran daños en las condiciones de los bienes, o hay alguna disputa sobre calidad/cantidad/peso, se debe enviar un reclamo, incluyendo fotografías, informe de inspección, descripción detallada del reclamo o problema, al vendedor después de la entrega con un máximo de 30 días después de la llegada de los bienes a las instalaciones del cliente para defectos visibles y con un plazo de 45 para el resto de los defectos. Cualquier reclamo debe enviarse al vendedor por correo electrónico al menos a las siguientes direcciones de correo electrónico: rfernandez@steeltradeadvisors.com y andres@steeltradeadvisors.com.";

export async function renderConfirmationDocx(confirmation, { mode }) {
  const zip = await JSZip.loadAsync(readFileSync(TEMPLATE_URL));
  const hasMultipleOrigins = getOriginCount(confirmation) > 1;
  const origin = getSingleOrigin(confirmation);
  const replacements = buildReplacements(confirmation, {
    mode,
    hasMultipleOrigins
  });
  const merchandiseTable = buildMerchandiseTableXml(confirmation, mode, {
    hasMultipleOrigins
  });
  await Promise.all(
    Object.keys(zip.files)
      .filter((name) => /^word\/.*\.xml$/.test(name))
      .map(async (name) => {
        const file = zip.file(name);
        if (!file) return;
        let xml = await file.async("string");
        xml = replaceTextInParagraphs(xml, (text) =>
          text.trim() === "FECHA" ? formatDateEs(confirmation.date) : text
        );
        for (const [needle, replacement] of replacements) {
          xml = replaceTextInParagraphs(xml, (text) =>
            text.includes(needle) ? text.split(needle).join(replacement || "") : text
          );
        }
        if (name === "word/document.xml") {
          xml = replaceCustomerHeaderBlock(xml, confirmation);
          xml = insertTableAfterMaterialIntro(xml, merchandiseTable);
          if (hasMultipleOrigins) {
            xml = removeOriginLine(xml);
          } else {
            xml = replaceOriginLine(xml, `ORIGEN: ${origin}`);
          }
          xml = updateStorageLine(xml, getStorageRate(confirmation));
          xml = replaceSignatureBlockWithConfirmationNote(xml);
          xml = removePackingLine(xml);
          xml = removeBankDetails(xml, isTransferPaymentTerm(confirmation.paymentTerms));
          xml = replaceDocumentCertificateLine(xml);
          xml = replaceReclamacionesLine(xml);
          xml = normalizeLegalCommonNouns(xml);
          xml = applyDocumentLayoutRules(xml);
        }
        zip.file(name, xml);
      })
  );

  return zip.generateAsync({ type: "nodebuffer" });
}

function buildReplacements(
  confirmation,
  { mode, hasMultipleOrigins = false }
) {
  const customer = confirmation.customer;
  const origin = getSingleOrigin(confirmation);
  const originLine = hasMultipleOrigins ? "" : `ORIGEN: ${origin}`;
  const showsBankDetails = isTransferPaymentTerm(confirmation.paymentTerms);
  const deliveryLine = `CONDICIONES DE ENTREGA: ${getDeliveryTermsLine(confirmation)}`;
  const signatureName = sanitizeSingleLineText(
    customer?.fiscalName || customer?.commercialName || ""
  );
  const customerAddressText = sanitizeSingleLineText(customerAddress(customer));
  const customerTaxId = sanitizeSingleLineText(customer?.taxId || "");
  return [
    ["CLIENTE XXXXX", signatureName],
    ["DIRECCI\u00d3N CLIENTE XXXX", customerAddressText],
    ["CIF CLLIENTE XXX", customerTaxId],
    ["CONFIRMACI\u00d3N DE PEDIDO: STA \u2013 2026-XXXX", `CONFIRMACI\u00d3N DE PEDIDO ${confirmation.contractNumber}`],
    ["CONFIRMACI\u00d3N DE PEDIDO: STA - 2026-XXXX", `CONFIRMACI\u00d3N DE PEDIDO ${confirmation.contractNumber}`],
    ["MERCANCIA :", "MERCANC\u00cdA:"],
    ["MERCANCIA:", "MERCANC\u00cdA:"],
    ["MARCANCIA :", "MERCANC\u00cdA:"],
    ["MARCANCIA:", "MERCANC\u00cdA:"],
    ["ORIGEN: FABRICA Y PAÃS", originLine],
    [
      "CANTIDAD TOTAL: 600,000 MT (+ / - 10%)",
      formatTotalQuantityLine(confirmation, mode)
    ],
    [
      "CONDICIONES DE ENTREGA: INCOTERM DE LA VENTA",
      deliveryLine
    ],
    ["PESO BOBINA: RANGO DEL ITEM DE COMPRA", ""],
  [
    "CONDICIONES DE PAGO :  LA FORMA DE PAGO DEL PEDIDO",
    `CONDICIONES DE PAGO: ${confirmation.paymentTerms || ""}`
  ],
  [
    "CAIXA BANK - ES40 2100 6428 2213 0012 3884",
    showsBankDetails ? "CAIXA BANK - ES40 2100 6428 2213 0012 3884" : ""
  ],
    ["TECHOS FALSTECH", signatureName]
  ];
}

function isTransferPaymentTerm(paymentTerms) {
  const normalized = String(paymentTerms || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    normalized === "transferencia" ||
    normalized.includes("transferencia")
  );
}

function customerAddress(customer) {
  return [
    customer.address,
    [customer.postalCode, customer.city].filter(Boolean).join(" "),
    customer.province,
    customer.country
  ]
  .filter(Boolean)
  .join(", ");
}

function sanitizeSignatureName(value) {
  return String(value || "")
    .replace(/[\r\n\t\v\f\x85\u000B\u000C\u2028\u2029]+/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/[\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeSingleLineText(value) {
  return sanitizeSignatureName(value).replace(/ /g, "\u00A0");
}

function formatTolerance(confirmation) {
  const minus = toPercent(confirmation.toleranceMinus);
  const plus = toPercent(confirmation.tolerancePlus);
  if (!minus && !plus) return "";
  if (minus && plus && minus === plus) return `(+ / - ${plus})`;
  return `(- ${minus || "0%"} / + ${plus || "0%"})`;
}

function formatTotalQuantityLine(confirmation, mode) {
  const base = `CANTIDAD TOTAL: ${formatNumber(confirmation.totalQuantity, 3)} MT`;
  if (mode === "detail" || mode === "formato2" || mode === "formato3") {
    return base;
  }
  const tolerance = formatTolerance(confirmation);
  return tolerance ? `${base} ${tolerance}` : base;
}

function toPercent(value) {
  if (value === undefined || value === null) return "";
  return `${Math.round(value * 100)}%`;
}

function formatCoilWeightRange(minNet, maxNet) {
  if (minNet === undefined && maxNet === undefined) return "";
  if (minNet === undefined) return `${formatNumber(maxNet, 3)}`;
  if (maxNet === undefined || maxNet === minNet) {
    return `${formatNumber(minNet, 3)}`;
  }
  return `${formatNumber(minNet, 3)} - ${formatNumber(maxNet, 3)}`;
}

function formatDateEs(value) {
  if (!value) return "";
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value);
}

function buildMerchandiseTableXml(confirmation, mode, options = {}) {
  const tableOptions = {
    hasMultipleOrigins: false,
    ...options
  };
  const lines = getConfirmationLines(confirmation, mode);
  const subtotal = sum(lines, "amount");
  const vat = roundMoney(subtotal * VAT_RATE);
  const total = roundMoney(subtotal + vat);
  const tableWidths = getTableWidths(mode, tableOptions);
  const rows = [
    buildHeaderRow(mode, tableOptions),
    ...lines.map((line, index) => buildLineRow(line, index + 1, mode, tableOptions)),
    ...buildSummaryRows(lines, subtotal, vat, total, tableWidths.length)
  ];

  return [
    "<w:tbl>",
    "<w:tblPr>",
    '<w:tblW w:w="5000" w:type="pct"/>',
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:left w:w="45" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="45" w:type="dxa"/></w:tblCellMar>',
    "</w:tblPr>",
    `<w:tblGrid>${tableWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`,
    rows.map((row) => rowXml(row, tableWidths)).join(""),
    "</w:tbl>"
  ].join("");
}

function buildHeaderRow(
  mode,
  { hasMultipleOrigins = false } = {}
) {
  if (mode === "detail") {
    return [
      cell("ITEM", { bold: true, align: "center", shade: "EDEDED" }),
      cell("ESPECIFICACIÓN", { bold: true, align: "center", shade: "EDEDED" }),
      ...(hasMultipleOrigins ? [cell("ORIGEN", { bold: true, align: "center", shade: "EDEDED" })] : []),
      cell("NÚMERO DE BOBINA", { span: 2, bold: true, align: "center", shade: "EDEDED" }),
      cell("PESO (MT)", { bold: true, align: "center", shade: "EDEDED" }),
      cell("PRECIO (EUR/MT)", { bold: true, align: "center", shade: "EDEDED" }),
      cell("TOTAL EUR", { bold: true, align: "center", shade: "EDEDED" })
    ];
  }
  if (mode === "formato3") {
    return [
      cell("ITEM", { bold: true, align: "center", shade: "EDEDED" }),
      cell("ESPECIFICACIÓN", { span: 2, bold: true, align: "center", shade: "EDEDED" }),
      ...(hasMultipleOrigins ? [cell("ORIGEN", { bold: true, align: "center", shade: "EDEDED" })] : []),
      cell("UNIDADES", { bold: true, align: "center", shade: "EDEDED" }),
      cell("PESO (MT)", { bold: true, align: "center", shade: "EDEDED" }),
      cell("PRECIO (EUR/MT)", { bold: true, align: "center", shade: "EDEDED" }),
      cell("TOTAL EUR", { bold: true, align: "center", shade: "EDEDED" })
    ];
  }
  return [
    cell("ITEM", { bold: true, align: "center", shade: "EDEDED" }),
    cell("ESPECIFICACIÓN", { span: hasMultipleOrigins ? 2 : 3, bold: true, align: "center", shade: "EDEDED" }),
    ...(hasMultipleOrigins ? [cell("ORIGEN", { bold: true, align: "center", shade: "EDEDED" })] : []),
    cell("RANGO (MT)", { bold: true, align: "center", shade: "EDEDED" }),
    cell("PESO (MT)", { bold: true, align: "center", shade: "EDEDED" }),
    cell("PRECIO (EUR/MT)", { bold: true, align: "center", shade: "EDEDED" }),
    cell("TOTAL EUR", { bold: true, align: "center", shade: "EDEDED" })
  ];
}

function deliveryTermsWithPlace(deliveryTerms, place) {
  const normalizedTerms = String(deliveryTerms || "").trim();
  const normalizedPlace = String(place || "").trim();

  if (!normalizedTerms || !normalizedPlace) {
    return normalizedTerms;
  }

  const normalized = normalizeForMatch(normalizedPlace);
  const normalizedSource = normalizeForMatch(normalizedTerms);
  if (normalizedSource.endsWith(normalized)) return normalizedTerms;

  return `${normalizedTerms} ${normalizedPlace}`;
}

function buildLineRow(
  line,
  index,
  mode,
  { hasMultipleOrigins = false } = {}
) {
  const itemNumber = line.itemNumber || index;
  if (mode === "detail") {
    return [
      cell(itemNumber, { align: "center" }),
      cell(line.specification),
      ...(hasMultipleOrigins ? [cell(line.origin || "")] : []),
      cell(line.factoryId || "", { span: 2 }),
      cell(formatNumber(line.quantity, 3), { align: "right" }),
      cell(formatMoney(line.price), { align: "right" }),
      cell(formatMoney(line.amount), { align: "right" })
    ];
  }
  if (mode === "formato3") {
    return [
      cell(itemNumber, { align: "center" }),
      cell(line.specification, { span: 2 }),
      ...(hasMultipleOrigins ? [cell(line.origin || "")] : []),
      cell(formatUnits(line.units), { align: "right" }),
      cell(formatNumber(line.quantity, 3), { align: "right" }),
      cell(formatMoney(line.price), { align: "right" }),
      cell(formatMoney(line.amount), { align: "right" })
    ];
  }
  return [
    cell(itemNumber, { align: "center" }),
    cell(line.specification, { span: hasMultipleOrigins ? 2 : 3 }),
    ...(hasMultipleOrigins ? [cell(line.origin || "")] : []),
    cell(formatCoilWeightRange(line.minNet, line.maxNet), { align: "right" }),
    cell(formatNumber(line.quantity, 3), { align: "right" }),
    cell(formatMoney(line.price), { align: "right" }),
    cell(formatMoney(line.amount), { align: "right" })
  ];
}

function buildSummaryRows(lines, subtotal, vat, total, columnCount) {
  const quantityColSpan = columnCount - 3;
  const vatColSpan = columnCount - 1;
  const totalLabelPrefixSpan = columnCount - 2;
  return [
    [cell("", { span: quantityColSpan }), cell(formatNumber(sum(lines, "quantity"), 3), { align: "right", bold: true }), cell(""), cell(formatMoney(subtotal), { align: "right", bold: true })],
    [cell("IVA 21%", { span: vatColSpan, align: "right", bold: true }), cell(formatMoney(vat), { align: "right", bold: true })],
    [cell("", { span: totalLabelPrefixSpan, shade: "EDEDED" }), cell("TOTAL", { align: "right", bold: true, shade: "EDEDED" }), cell(formatMoney(total), { align: "right", bold: true, shade: "EDEDED" })]
  ];
}

function getTableWidths(
  mode,
  { hasMultipleOrigins = false } = {}
) {
  const originWidths = hasMultipleOrigins ? [950] : [];

  if (mode === "detail") {
    return [650, 2350, ...originWidths, 950, 1200, 1100, 1300, 1200];
  }
  if (mode === "formato3") {
    return [650, 2350, 950, ...originWidths, 1100, 1100, 1300, 1200];
  }

  const specWidths = hasMultipleOrigins ? [2350, 750] : [2350, 950, 1000];
  return [
    650,
    ...specWidths,
    ...originWidths,
    1300,
    1100,
    1300,
    1200
  ];
}

function removeOriginLine(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const normalizedText = normalizeForMatch(paragraphText(paragraph));
    const isOriginLine =
      normalizedText.includes("origen") &&
      normalizedText.includes("fabrica") &&
      normalizedText.includes("pais");
    return isOriginLine ? "" : paragraph;
  });
}

function getOriginCount(confirmation) {
  return getOriginList(confirmation).length;
}

function getSingleOrigin(confirmation) {
  return getOriginList(confirmation)[0] || "Seg\u00fan contrato de compra";
}

function getOriginList(confirmation) {
  if (Array.isArray(confirmation.origins) && confirmation.origins.length > 0) {
    return dedupeOrigins(
      confirmation.origins
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean)
    );
  }
  if (!confirmation.origin) return [];
  return [String(confirmation.origin).trim()].filter(Boolean);
}

function dedupeOrigins(values) {
  return [...new Set(values)];
}

function getDeliveryTermsLine(confirmation) {
  return getDeliveryTermList(confirmation).join(", ") || String(confirmation.deliveryTerms || "").trim();
}

function getDeliveryTermList(confirmation) {
  const termsFromItems = (confirmation.items || [])
    .map((item) =>
      String(
        item.deliveryTerms ||
          deliveryTermsWithPlace(confirmation.deliveryTerms, item.deliveryPlace)
      ).trim()
    )
    .filter(Boolean);

  if (termsFromItems.length) {
    return dedupeNormalizedText(termsFromItems);
  }

  return String(confirmation.deliveryTerms || "").trim()
    ? [String(confirmation.deliveryTerms).trim()]
    : [];
}

function replaceOriginLine(xml, replacementText) {
  if (!replacementText) return xml;
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const normalizedText = normalizeForMatch(paragraphText(paragraph))
      .replace(/\s+/g, " ");
    const isOriginTemplateLine =
      normalizedText.includes("origen") &&
      normalizedText.includes("fabrica") &&
      normalizedText.includes("pais");
    return isOriginTemplateLine ? replaceParagraphText(paragraph, replacementText) : paragraph;
  });
}

function dedupeNormalizedText(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeForMatch(value)
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function cell(text, options = {}) {
  return { text: text ?? "", span: 1, align: "left", bold: false, shade: "", ...options };
}

function rowXml(row, tableWidths) {
  let columnIndex = 0;
  const cells = row
    .map((tableCell) => {
      const xml = cellXml(tableCell, columnIndex, tableWidths);
      columnIndex += tableCell.span;
      return xml;
    })
    .join("");
  return `<w:tr>${cells}</w:tr>`;
}

function cellXml({ text, span, align, bold, shade }, columnIndex, tableWidths = TABLE_WIDTHS) {
  const width = tableWidths.slice(columnIndex, columnIndex + span).reduce(
    (total, value) => total + value,
    0
  ) || span * 1000;
  const props = [
    `<w:tcW w:w="${width}" w:type="dxa"/>`,
    span > 1 ? `<w:gridSpan w:val="${span}"/>` : "",
    '<w:vAlign w:val="center"/>',
    shade ? `<w:shd w:fill="${shade}"/>` : "",
    '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="808080"/><w:left w:val="single" w:sz="4" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:color="808080"/><w:right w:val="single" w:sz="4" w:color="808080"/></w:tcBorders>'
  ].join("");
  const runProps = [
    '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>',
    '<w:sz w:val="16"/>',
    bold ? "<w:b/>" : ""
  ].join("");

  return [
    "<w:tc>",
    `<w:tcPr>${props}</w:tcPr>`,
    "<w:p>",
    `<w:pPr><w:jc w:val="${align}"/></w:pPr>`,
    `<w:r><w:rPr>${runProps}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`,
    "</w:p>",
    "</w:tc>"
  ].join("");
}

function insertTableAfterMaterialIntro(xml, tableXml) {
  let inserted = false;
  let result = xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (inserted) return paragraph;
    if (!isMaterialIntroParagraph(paragraph)) return paragraph;
    inserted = true;
    return `${ensureMaterialIntroColon(paragraph)}${halfLineBlankParagraph()}${tableXml}`;
  });
  if (inserted) return removeStandaloneMerchandiseHeading(result);

  result = xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (inserted) return paragraph;
    if (!isStandaloneMerchandiseHeading(paragraph)) return paragraph;
    inserted = true;
    return `${halfLineBlankParagraph()}${tableXml}`;
  });
  return inserted ? result : xml;
}

function isMaterialIntroParagraph(paragraph) {
  const text = normalizeForMatch(paragraphText(paragraph)).replace(/\s+/g, " ").trim();
  return text.includes("le agradecemos su pedido") && text.includes("siguiente material");
}

function ensureMaterialIntroColon(paragraph) {
  const text = paragraphText(paragraph);
  if (/SIGUIENTE\s+MATERIAL\s*:\s*$/i.test(text)) return paragraph;
  return replaceParagraphText(
    paragraph,
    text.replace(/SIGUIENTE\s+MATERIAL\s*:?\s*$/i, "SIGUIENTE MATERIAL:")
  );
}

function removeStandaloneMerchandiseHeading(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) =>
    isStandaloneMerchandiseHeading(paragraph) ? "" : paragraph
  );
}

function isStandaloneMerchandiseHeading(paragraph) {
  const text = normalizeForMatch(paragraphText(paragraph))
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*:\s*$/, "");
  return text === "mercancia" || text === "marcancia";
}

function halfLineBlankParagraph() {
  return [
    "<w:p>",
    '<w:pPr><w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"/></w:pPr>',
    "</w:p>"
  ].join("");
}

function blankLineParagraph() {
  return [
    "<w:p>",
    '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>',
    "</w:p>"
  ].join("");
}

function applyDocumentLayoutRules(xml) {
  return normalizeConfirmationTitleSpacing(
    collapseConsecutiveBlankParagraphs(
      normalizeLongParagraphSpacing(
        normalizeLabelValueBold(
          shrinkIntroParagraph(xml)
        )
      )
    )
  );
}

function normalizeLabelValueBold(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (paragraph.includes("<w:drawing")) return paragraph;
    const text = paragraphText(paragraph).replace(/\s+/g, " ").trim();
    const colonIndex = text.indexOf(":");
    if (colonIndex < 0 || colonIndex === text.length - 1) return paragraph;

    const label = text.slice(0, colonIndex + 1);
    const value = text.slice(colonIndex + 1).replace(/^\s*/, " ");
    if (!shouldSplitLabelValueBold(label)) return paragraph;

    const labelValueParagraph = setParagraphLeftIndent(
      replaceParagraphRuns(paragraph, [
        { text: label, bold: true },
        { text: value, bold: false }
      ]),
      "0"
    );
    return shouldUseBodyLabelLayout(label)
      ? setBodyLabelParagraphLayout(labelValueParagraph)
      : labelValueParagraph;
  });
}

function shouldSplitLabelValueBold(label) {
  const normalizedLabel = normalizeForMatch(label)
    .replace(/\s*:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return LABEL_VALUE_PREFIXES.includes(normalizedLabel);
}

function shouldUseBodyLabelLayout(label) {
  const normalizedLabel = normalizeForMatch(label)
    .replace(/\s*:\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return ["condiciones de entrega", "condiciones de pago"].includes(normalizedLabel);
}

function setBodyLabelParagraphLayout(paragraph) {
  const style = '<w:pStyle w:val="Textoindependiente"/>';
  const spacing = '<w:spacing w:line="220" w:lineRule="atLeast"/>';
  let result = paragraph;

  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(result)) {
    result = result.replace(/<w:pStyle\b[^>]*\/>/, style);
    if (!result.includes(style)) {
      result = result.replace("<w:pPr>", `<w:pPr>${style}`);
    }

    result = result.replace(/<w:spacing\b[^>]*\/>/, spacing);
    if (!result.includes(spacing)) {
      result = result.replace("</w:pPr>", `${spacing}</w:pPr>`);
    }
    return result;
  }

  return result.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${style}${spacing}</w:pPr>`);
}

function replaceParagraphRuns(paragraph, runs) {
  const normalizedParagraph = removeParagraphBoldFromProperties(paragraph);
  const runMatches = [...normalizedParagraph.matchAll(/<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g)];
  if (!runMatches.length) return paragraph;

  const firstRunXml = runMatches[0][0];
  const baseRunProps = firstRunXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] || "";
  const plainRunProps = removeBoldFromRunProps(baseRunProps);
  const replacementRuns = runs
    .map(({ text, bold }) => buildTextRun(text, bold ? addBoldToRunProps(plainRunProps) : plainRunProps))
    .join("");
  const start = runMatches[0].index;
  const lastRun = runMatches.at(-1);
  if (start === undefined || lastRun.index === undefined) return paragraph;
  const end = lastRun.index + lastRun[0].length;

  return `${normalizedParagraph.slice(0, start)}${replacementRuns}${normalizedParagraph.slice(end)}`;
}

function buildTextRun(text, runProps) {
  return [
    "<w:r>",
    runProps ? `<w:rPr>${runProps}</w:rPr>` : "",
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    "</w:r>"
  ].join("");
}

function removeBoldFromRunProps(runProps) {
  return String(runProps || "")
    .replace(/<w:b\b[^>]*\/>/g, "")
    .replace(/<w:bCs\b[^>]*\/>/g, "");
}

function addBoldToRunProps(runProps) {
  return `${removeBoldFromRunProps(runProps)}<w:b/><w:bCs/>`;
}

function removeParagraphBoldFromProperties(paragraph) {
  return paragraph.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, (paragraphProperties) =>
    removeBoldFromRunProps(paragraphProperties)
  );
}

function setParagraphLeftIndent(paragraph, left) {
  const indent = `<w:ind w:left="${left}"/>`;
  if (paragraph.includes("<w:pPr>")) {
    if (/<w:ind\b[^>]*\/>/.test(paragraph)) {
      return paragraph.replace(/<w:ind\b[^>]*\/>/, (existingIndent) => {
        if (/\bw:left="/.test(existingIndent)) {
          return existingIndent.replace(/\bw:left="-?\d+"/, `w:left="${left}"`);
        }
        return existingIndent.replace(/\/>$/, ` w:left="${left}"/>`);
      });
    }
    return paragraph.replace("</w:pPr>", `${indent}</w:pPr>`);
  }

  return paragraph.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${indent}</w:pPr>`);
}

function normalizeConfirmationTitleSpacing(xml) {
  const paragraphMatches = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)];
  const titleIndex = paragraphMatches.findIndex((match) => isConfirmationTitleParagraph(match[0]));
  if (titleIndex < 0) return xml;

  let endIndex = titleIndex;
  while (
    endIndex + 1 < paragraphMatches.length &&
    isBlankParagraph(paragraphMatches[endIndex + 1][0])
  ) {
    endIndex += 1;
  }

  const titleParagraph = normalizeConfirmationTitleText(paragraphMatches[titleIndex][0]);
  const start = paragraphMatches[titleIndex].index;
  const endMatch = paragraphMatches[endIndex];
  if (start === undefined || endMatch.index === undefined) return xml;
  const end = endMatch.index + endMatch[0].length;
  const replacement = [
    blankLineParagraph(),
    blankLineParagraph(),
    blankLineParagraph(),
    titleParagraph,
    blankLineParagraph(),
    blankLineParagraph()
  ].join("");

  return `${xml.slice(0, start)}${replacement}${xml.slice(end)}`;
}

function isConfirmationTitleParagraph(paragraph) {
  const text = normalizeForMatch(paragraphText(paragraph)).replace(/\s+/g, " ").trim();
  return text.includes("confirmacion de pedido");
}

function normalizeConfirmationTitleText(paragraph) {
  const text = paragraphText(paragraph).replace(
    /CONFIRMACI\u00d3N\s+DE\s+PEDIDO\s*:\s*/i,
    "CONFIRMACI\u00d3N DE PEDIDO "
  );
  return replaceParagraphText(paragraph, text);
}

function isBlankParagraph(paragraph) {
  return !paragraph.includes("<w:drawing") && paragraphText(paragraph).trim() === "";
}

function shrinkIntroParagraph(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = normalizeForMatch(paragraphText(paragraph)).replace(/\s+/g, " ");
    if (!text.includes("le agradecemos su pedido") || !text.includes("material")) {
      return paragraph;
    }
    return setParagraphFontSize(paragraph, 19);
  });
}

function normalizeLongParagraphSpacing(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = normalizeForMatch(paragraphText(paragraph))
      .replace(/\s+/g, " ")
      .trim();
    if (!shouldTightenParagraphSpacing(text)) return paragraph;

    return setParagraphSpacing(paragraph, {
      before: "0",
      after: "240",
      line: "240",
      lineRule: "auto"
    });
  });
}

function shouldTightenParagraphSpacing(text) {
  if (!text) return false;
  if (text.startsWith("reclamaciones:")) return true;
  if (text.startsWith("fuerza mayor:")) return true;
  return text.length > 140;
}

function collapseConsecutiveBlankParagraphs(xml) {
  let blankCount = 0;
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const isBlank = !paragraph.includes("<w:drawing") && paragraphText(paragraph).trim() === "";
    if (isBlank && paragraph.includes('w:line="120"')) {
      blankCount = 0;
      return paragraph;
    }
    if (!isBlank) {
      blankCount = 0;
      return paragraph;
    }

    blankCount += 1;
    if (blankCount > 1) return "";
    return setParagraphSpacing(paragraph, {
      before: "0",
      after: "0",
      line: "240",
      lineRule: "exact"
    });
  });
}

function setParagraphSpacing(paragraph, { before, after, line, lineRule }) {
  const spacing = `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="${lineRule}"/>`;
  if (paragraph.includes("<w:pPr>")) {
    if (/<w:spacing\b[^>]*\/>/.test(paragraph)) {
      return paragraph.replace(/<w:spacing\b[^>]*\/>/, spacing);
    }
    return paragraph.replace("<w:pPr>", `<w:pPr>${spacing}`);
  }

  return paragraph.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${spacing}</w:pPr>`);
}

function setParagraphJustification(paragraph, value) {
  const justification = `<w:jc w:val="${value}"/>`;
  if (paragraph.includes("<w:pPr>")) {
    if (/<w:jc\b[^>]*\/>/.test(paragraph)) {
      return paragraph.replace(/<w:jc\b[^>]*\/>/, justification);
    }
    return paragraph.replace("</w:pPr>", `${justification}</w:pPr>`);
  }

  return paragraph.replace(/<w:p([^>]*)>/, `<w:p$1><w:pPr>${justification}</w:pPr>`);
}

function setParagraphBold(paragraph) {
  return paragraph
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, (paragraphProperties) =>
      addBoldToRunProperties(paragraphProperties)
    )
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, (runProperties) =>
      addBoldToRunProperties(runProperties)
    );
}

function addBoldToRunProperties(runProperties) {
  return runProperties
    .replace(/<w:b\b[^>]*\/>/g, "")
    .replace(/<w:bCs\b[^>]*\/>/g, "")
    .replace("</w:rPr>", "<w:b/><w:bCs/></w:rPr>");
}

function setParagraphFontSize(paragraph, size) {
  const sizeXml = `<w:sz w:val="${size}"/>`;
  const complexSizeXml = `<w:szCs w:val="${size}"/>`;
  return paragraph
    .replace(/<w:sz w:val="\d+"\/>/g, sizeXml)
    .replace(/<w:szCs w:val="\d+"\/>/g, complexSizeXml);
}

function replaceCustomerHeaderBlock(xml, confirmation) {
  const customer = confirmation.customer || {};
  const customerName = sanitizeSingleLineText(customer.fiscalName || customer.commercialName || "");
  const customerAddressText = sanitizeSignatureName(customerAddress(customer));
  const customerTaxId = sanitizeSignatureName(customer.taxId || "");
  const confirmationDate = formatDateEs(confirmation.date);
  const paragraphMatches = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)];
  const logoParagraphIndex = paragraphMatches.findIndex((match, index) => {
    if (index > 8) return false;
    return match[0].includes("<w:drawing");
  });
  if (logoParagraphIndex < 0) return xml;

  const logoParagraph = paragraphMatches[logoParagraphIndex][0];
  const logoRun = shrinkHeaderLogoRun(
    logoParagraph.match(/<w:r(?:\s[^>]*)?>[\s\S]*?<w:drawing>[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/)?.[0]
  );
  if (!logoRun) return xml;

  const dateParagraphIndex = paragraphMatches.findIndex((match, index) => {
    if (index <= logoParagraphIndex || index > logoParagraphIndex + 6) return false;
    return paragraphText(match[0]).includes(confirmationDate);
  });
  const lastHeaderParagraphIndex = dateParagraphIndex > -1
    ? dateParagraphIndex
    : Math.min(logoParagraphIndex + 3, paragraphMatches.length - 1);
  const start = paragraphMatches[logoParagraphIndex].index;
  const endMatch = paragraphMatches[lastHeaderParagraphIndex];
  if (start === undefined || endMatch.index === undefined) return xml;

  const customerHeaderTable = buildCustomerHeaderTable({
    logoRun,
    customerName,
    customerAddressText,
    customerTaxId,
    confirmationDate
  });
  const end = endMatch.index + endMatch[0].length;
  return `${xml.slice(0, start)}${customerHeaderTable}${xml.slice(end)}`;
}

function buildCustomerHeaderTable({
  logoRun,
  customerName,
  customerAddressText,
  customerTaxId,
  confirmationDate
}) {
  const tableWidth = 10466;
  const leftWidth = 4800;
  const rightWidth = tableWidth - leftWidth;
  const cellProps = (width, extraProps = "") =>
    `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="top"/>${extraProps}</w:tcPr>`;
  const textParagraph = (
    text,
    { bold = false, size = 20, noWrap = false, fitWidth = "", spacingBefore = "0" } = {}
  ) => [
    `<w:p><w:pPr><w:spacing w:before="${spacingBefore}" w:after="0"/><w:jc w:val="right"/>${noWrap ? "<w:noWrap/>" : ""}${fitWidth ? `<w:fitText w:val="${fitWidth}"/>` : ""}</w:pPr>`,
    "<w:r>",
    `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`,
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t>`,
    "</w:r>",
    "</w:p>"
  ].join("");
  const customerTopSpacer = [
    "<w:p>",
    '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr>',
    "</w:p>"
  ].join("");
  const customerBlankLine = [
    "<w:p>",
    '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/><w:jc w:val="right"/></w:pPr>',
    "<w:r>",
    '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>',
    '<w:t xml:space="preserve"></w:t>',
    "</w:r>",
    "</w:p>"
  ].join("");
  const rightParagraphs = [
    customerTopSpacer,
    textParagraph(customerName, {
      bold: true,
      size: headerNameFontSize(customerName),
      noWrap: true,
      fitWidth: rightWidth
    }),
    textParagraph(customerAddressText),
    textParagraph(customerTaxId),
    customerBlankLine,
    textParagraph(confirmationDate)
  ].join("");

  return [
    "<w:tbl>",
    "<w:tblPr>",
    `<w:tblW w:w="${tableWidth}" w:type="dxa"/>`,
    '<w:tblLayout w:type="fixed"/>',
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>',
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>',
    "</w:tblPr>",
    `<w:tblGrid><w:gridCol w:w="${leftWidth}"/><w:gridCol w:w="${rightWidth}"/></w:tblGrid>`,
    "<w:tr>",
    `<w:tc>${cellProps(leftWidth)}<w:p><w:pPr><w:spacing w:after="0"/><w:ind w:left="-${STA_HEADER_LEFT_MARGIN_REDUCTION_DXA}"/><w:jc w:val="left"/></w:pPr>${logoRun}</w:p></w:tc>`,
    `<w:tc>${cellProps(rightWidth, "<w:noWrap/>")}${rightParagraphs}</w:tc>`,
    "</w:tr>",
    "</w:tbl>"
  ].join("");
}

function headerNameFontSize(value) {
  const length = String(value || "").length;
  if (length > 60) return 14;
  if (length > 45) return 16;
  if (length > 34) return 18;
  return 20;
}

function shrinkHeaderLogoRun(logoRun) {
  if (!logoRun) return "";
  const widthCx = "3000000";
  const heightCy = "1066300";
  return logoRun
    .replace(/<wp:extent cx="\d+" cy="\d+"\/>/, `<wp:extent cx="${widthCx}" cy="${heightCy}"/>`)
    .replace(/<a:ext cx="\d+" cy="\d+"\/>/, `<a:ext cx="${widthCx}" cy="${heightCy}"/>`);
}

function getStorageRate(confirmation) {
  const kind = getStorageDeliveryKind(confirmation);
  if (!kind) return "";
  if (confirmation.hasSheetMaterial) {
    return kind === "puerto" ? "0,25" : "0,20";
  }
  return kind === "puerto" ? "0,30" : "0,15";
}

function getStorageDeliveryKind(confirmation) {
  const eligibleItems = (confirmation.items || []).filter(
    (item) => item.hasStorageDeliveryPlace === true
  );
  const kinds = eligibleItems.map((item) =>
    normalizeStorageDeliveryKind(item.storageDeliveryKind || item.deliveryPlace)
  );
  if (kinds.includes("puerto")) return "puerto";
  if (kinds.includes("almacen")) return "almacen";
  return "";
}

function normalizeStorageDeliveryKind(value) {
  const normalized = normalizeForMatch(value);
  if (normalized.includes("puerto")) return "puerto";
  if (normalized.includes("almacen")) return "almacen";
  return "";
}

function updateStorageLine(xml, storageRate) {
  const storageText =
    `ALMACENAJES: 30 DÍAS LIBRES A PARTIR DE LA FECHA FACTURA, TRANSCURRIDO ESE PERIODO, SE FACTURARÁ A ${storageRate} €/MT POR DÍA.`;
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const normalizedText = normalizeForMatch(paragraphText(paragraph))
      .replace(/\s+/g, " ");
    const isStorageParagraph =
      normalizedText.includes("almacenajes") ||
      normalizedText.includes("30 dias libres") ||
      normalizedText.includes("30 d\u00edas libres") ||
      (normalizedText.includes("0,22") && normalizedText.includes("0,15")) ||
      (normalizedText.includes("0.22") && normalizedText.includes("0.15")) ||
      (normalizedText.includes("se facturar") && normalizedText.includes("eur/mt"));

    if (!isStorageParagraph) return paragraph;
    if (!storageRate) return "";
    return replaceParagraphText(
      paragraph,
      storageText
    ).replace(/<w:color w:val="EE0000"\/>/g, '<w:color w:val="000000"/>');
  });
}

function replaceReclamacionesLine(xml) {
  let replaced = false;
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = normalizeForMatch(paragraphText(paragraph));
    const isReclamacionesHeader = text.includes("reclamaciones");
    const isReclamacionesBody =
      text.includes("si se encuentran danos en las condiciones de los bienes") ||
      text.includes("cualquier reclamo debe enviarse al vendedor");

    if (!isReclamacionesHeader && !isReclamacionesBody) return paragraph;
    if (replaced) return "";
    replaced = true;
    return replaceParagraphText(paragraph, RECLAMACIONES_TEXT);
  });
}

function removePackingLine(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const text = paragraphText(paragraph);
    return shouldRemovePackingLine(text) ? "" : paragraph;
  });
}

function replaceDocumentCertificateLine(xml) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const normalizedText = normalizeForMatch(paragraphText(paragraph))
      .replace(/\s+/g, " ")
      .trim();
    const isOldCertificateLine =
      normalizedText.includes("mill test certificado 3.1") &&
      normalizedText.includes("en10204");
    return isOldCertificateLine
      ? replaceParagraphText(paragraph, "CERTIFICADO DE CALIDAD 3.1 DE ACUERDO A EN10204")
      : paragraph;
  });
}

function normalizeLegalCommonNouns(xml) {
  return replaceTextInParagraphs(xml, (text) =>
    text
      .replace(/\bFuerza Mayor\b/g, "fuerza mayor")
      .replace(/\bFuerza mayor\b/g, "fuerza mayor")
      .replace(/\bPartes\b/g, "partes")
      .replace(/\bParte\b/g, "parte")
      .replace(/\bAcuerdo\b/g, "acuerdo")
      .replace(/\bVendedor\b/g, "vendedor")
      .replace(/\bComprador\b/g, "comprador")
      .replace(/\bBienes\b/g, "bienes")
      .replace(/\bBien\b/g, "bien")
  );
}

function replaceSignatureBlockWithConfirmationNote(xml) {
  const paragraphMatches = [...xml.matchAll(/<w:p[\s\S]*?<\/w:p>/g)];
  const paragraphs = paragraphMatches.map((match) => match[0]);
  const headerParagraphIndex = paragraphs.findIndex((paragraph) => {
    const normalizedParagraphText = normalizeForMatch(paragraphText(paragraph));
    return normalizedParagraphText.includes("for and on behalf of");
  });
  if (headerParagraphIndex < 0) return xml;

  const signatureParagraphIndex = paragraphs.findIndex(
    (paragraph, index) => {
      if (index <= headerParagraphIndex) return false;
      const normalizedParagraphText = normalizeForMatch(paragraphText(paragraph));
      return (
        normalizedParagraphText.includes("steel trade advisors") &&
        (normalizedParagraphText.includes("s.l.u.") || normalizedParagraphText.includes("s.l."))
      );
    }
  );
  if (signatureParagraphIndex < 0) return xml;

  const headerMatch = paragraphMatches[headerParagraphIndex];
  const signatureMatch = paragraphMatches[signatureParagraphIndex];
  if (headerMatch.index === undefined || signatureMatch.index === undefined) return xml;
  if (signatureMatch.index < headerMatch.index) return xml;

  const sourceParagraph = findPreviousBodyParagraph(paragraphs, headerParagraphIndex) ||
    paragraphs[signatureParagraphIndex];
  const confirmationParagraph = buildFinalConfirmationParagraph(sourceParagraph);

  const start = headerMatch.index;
  const end = signatureMatch.index + signatureMatch[0].length;
  return `${xml.slice(0, start)}${confirmationParagraph}${xml.slice(end)}`;
}

function findPreviousBodyParagraph(paragraphs, beforeIndex) {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const paragraph = paragraphs[index];
    const text = paragraphText(paragraph).trim();
    if (!text || paragraph.includes("<w:drawing")) continue;
    return paragraph;
  }
  return "";
}

function buildFinalConfirmationParagraph(sourceParagraph) {
  return removeParagraphIndentation(
    setParagraphJustification(
      setParagraphBold(
        replaceParagraphText(sourceParagraph, FINAL_CONFIRMATION_TEXT)
      ),
      "both"
    )
  );
}

function removeParagraphIndentation(paragraph) {
  return paragraph.replace(/<w:ind\b[^>]*\/>/g, "");
}

function shouldRemovePackingLine(text) {
  const normalizedText = normalizeForMatch(text)
    .replace(/\s+/g, " ")
    .trim();

  const compactText = normalizedText.replace(/[^a-z0-9\s:]/g, " ");

  if (compactText.includes("standard export packing")) return true;
  if (compactText.includes("para todo menos para chapa")) return true;
  if (compactText.includes("packing list")) return false;
  if (compactText.includes("pcking")) return true;

  return (
    /\b(packing|pcking)\b/.test(compactText) ||
    compactText.includes("packing:")
  );
}

function removeBankDetails(xml, showBankDetails) {
  if (!showBankDetails) {
    return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
      const text = normalizeForMatch(paragraphText(paragraph));
      return isBankDetailsParagraph(text) ? "" : paragraph;
    });
  }

  const paragraphRe = /<w:p[\s\S]*?<\/w:p>/g;
  let result = "";
  let lastIndex = 0;
  let pendingBankHeaderParagraph = "";

  let match = paragraphRe.exec(xml);
  while (match) {
    result += xml.slice(lastIndex, match.index);
    const paragraph = match[0];
    const paragraphTextNormalized = normalizeForMatch(paragraphText(paragraph));

    if (isBankDetailsHeaderOnly(paragraphTextNormalized)) {
      pendingBankHeaderParagraph = paragraph;
      lastIndex = match.index + match[0].length;
      match = paragraphRe.exec(xml);
      continue;
    }

    if (isCaixaBankLine(paragraphTextNormalized)) {
      result += replaceParagraphText(pendingBankHeaderParagraph || paragraph, BANK_DETAILS_TEXT);
      pendingBankHeaderParagraph = "";
      lastIndex = match.index + match[0].length;
      match = paragraphRe.exec(xml);
      continue;
    }

    if (pendingBankHeaderParagraph) {
      result += replaceParagraphText(pendingBankHeaderParagraph, BANK_DETAILS_TEXT);
      pendingBankHeaderParagraph = "";
    }

    result += paragraph;
    lastIndex = match.index + match[0].length;
    match = paragraphRe.exec(xml);
  }

  if (pendingBankHeaderParagraph) {
    result += replaceParagraphText(pendingBankHeaderParagraph, BANK_DETAILS_TEXT);
  }
  result += xml.slice(lastIndex);
  return result;
}

function isCaixaBankLine(text) {
  return String(text || "").includes("caixa bank");
}

function isTransferOnlyBankHeader(text) {
  const normalizedText = String(text || "")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    normalizedText.includes("cuando el pago es por transferencia") &&
    !normalizedText.includes("caixa bank")
  );
}

function isBankDetailsHeaderOnly(text) {
  const normalizedText = String(text || "")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    !normalizedText.includes("caixa bank") &&
    (
      isTransferOnlyBankHeader(normalizedText) ||
      normalizedText.includes("detalles bancarios")
    )
  );
}

function isBankDetailsParagraph(text) {
  const normalizedText = String(text || "")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return (
    (normalizedText.includes("detalles") && normalizedText.includes("bancarios")) ||
    normalizedText.includes("detalles bancarios") ||
    normalizedText.includes("cuando el pago es por transferencia") ||
    normalizedText.includes("caixa bank")
  );
}

function replaceParagraphText(paragraph, replacement) {
  let wroteFirstRun = false;
  return paragraph.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (match, attrs = "") => {
    if (!wroteFirstRun) {
      wroteFirstRun = true;
      return `<w:t${attrs}>${escapeXml(replacement)}</w:t>`;
    }
    return `<w:t${attrs}></w:t>`;
  });
}

function paragraphText(paragraph) {
  return [...paragraph.matchAll(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((run) => unescapeXml(run[2]))
    .join("");
}

function normalizeForMatch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function sum(lines, key) {
  return roundMoney(lines.reduce((total, line) => total + (Number(line[key]) || 0), 0));
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true
  }).format(value || 0);
}

function formatUnits(value) {
  if (value === undefined || value === null || value === "") return "";
  return new Intl.NumberFormat("es-ES", {
    maximumFractionDigits: 0,
    useGrouping: true
  }).format(value);
}

function replaceTextInParagraphs(xml, replaceText) {
  return xml.replace(/<w:p[\s\S]*?<\/w:p>/g, (paragraph) => {
    const runs = [...paragraph.matchAll(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
    if (!runs.length) return paragraph;

    const text = runs.map((run) => unescapeXml(run[2])).join("");
    const replaced = replaceText(text);
    if (replaced === text) return paragraph;

    let wroteFirstRun = false;
    return paragraph.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (_match, attrs = "") => {
      if (!wroteFirstRun) {
        wroteFirstRun = true;
        return `<w:t${attrs}>${escapeXml(replaced)}</w:t>`;
      }
      return `<w:t${attrs}></w:t>`;
    });
  });
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeXml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
