const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const env = require("../config/env");
const { trimFloat } = require("../utils/normalizers");

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const TEMPLATE_NAME = "教学进度计划表.docx";
const DEFAULT_TEMPLATE_ROWS = 45;

async function exportPlanAsWord({ planDocument, offering }) {
  const templatePath = path.join(env.rootDir, TEMPLATE_NAME);
  const fileName = `${offering.courseName}-${offering.className}-${planDocument.type}.docx`
    .replace(/[\\/:*?"<>|]+/g, "_");
  const filePath = path.join(env.exportsDir, fileName);

  const templateBuffer = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuffer);
  const documentXml = await zip.file("word/document.xml").async("string");
  const document = new DOMParser().parseFromString(documentXml, "text/xml");

  fillTemplate(document, { planDocument, offering });

  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  const output = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(filePath, output);

  return { fileName, filePath };
}

function fillTemplate(document, { planDocument, offering }) {
  const body = document.getElementsByTagNameNS(WORD_NS, "body")[0];
  const bodyChildren = getElementChildren(body);
  const paragraphs = bodyChildren.filter((node) => localName(node) === "p");
  const tables = bodyChildren.filter((node) => localName(node) === "tbl");
  const rows = (planDocument.rows || []).filter((row) => isVisibleRow(row));

  replaceParagraphTextNode(paragraphs[0], 1, offering.courseName || "");
  replaceParagraphTextNode(paragraphs[1], 0, `（${offering.className || ""}）`);
  if (planDocument.type === "practice") {
    replaceParagraphTextNode(paragraphs[2], 0, "实践进度计划表");
  }

  const headerRows = getRows(tables[0]);
  const headerRow0Cells = getCells(headerRows[0]);
  const headerRow1Cells = getCells(headerRows[1]);

  setCellText(headerRow0Cells[1], inferMajorName(offering));
  setCellText(headerRow0Cells[3], offering.className || "");
  setCellText(headerRow0Cells[5], offering.teacher?.name || "");

  setCellText(headerRow1Cells[0], `总学时：${formatValue(planDocument.totalHours)}`);
  setCellText(headerRow1Cells[2], formatValue(planDocument.theoryHours));
  setCellText(headerRow1Cells[4], formatValue(planDocument.practiceHours));
  setCellText(headerRow1Cells[6], formatValue(planDocument.weeklyHours));

  const detailTable = tables[1];
  ensureDetailRowCapacity(detailTable, rows.length);
  const detailRows = getRows(detailTable);

  for (let index = 0; index < Math.max(DEFAULT_TEMPLATE_ROWS, rows.length); index += 1) {
    const rowNode = detailRows[index + 2];
    const cellNodes = getCells(rowNode);
    const row = rows[index] || {};

    setCellText(cellNodes[0], row.weekIndex ? String(row.weekIndex) : "");
    setCellText(cellNodes[1], row.dateText || "");
    setCellText(cellNodes[2], row.periodText || "");
    setCellText(cellNodes[3], row.topicText || "");
    setCellText(cellNodes[4], formatValue(row.hours));
    setCellText(cellNodes[5], formatValue(row.theoryHours));
    setCellText(cellNodes[6], formatValue(row.practiceHours));
  }
}

function ensureDetailRowCapacity(tableNode, rowCount) {
  const requiredRows = Math.max(DEFAULT_TEMPLATE_ROWS, rowCount);
  const rows = getRows(tableNode);
  const currentDataRows = rows.length - 4;

  if (requiredRows <= currentDataRows) {
    return;
  }

  const insertBeforeNode = rows[rows.length - 2];
  const templateDataRow = rows[rows.length - 3];

  for (let index = currentDataRows; index < requiredRows; index += 1) {
    const cloned = templateDataRow.cloneNode(true);
    tableNode.insertBefore(cloned, insertBeforeNode);
  }
}

function inferMajorName(offering) {
  if (offering?.courseName?.includes("城乡规划") || offering?.courseName?.includes("城市规划")) {
    return "城乡规划";
  }

  if (String(offering?.className || "").startsWith("城")) {
    return "城乡规划";
  }

  return offering?.teacher?.college || "";
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return trimFloat(value);
}

function isVisibleRow(row) {
  return Boolean(row.weekIndex || row.topicText || row.hours || row.periodText || row.theoryHours || row.practiceHours);
}

function replaceParagraphTextNode(paragraphNode, textIndex, value) {
  const textNodes = paragraphNode?.getElementsByTagNameNS(WORD_NS, "t") || [];
  if (!textNodes.length) {
    setParagraphText(paragraphNode, value);
    return;
  }

  const target = textNodes[textIndex] || textNodes[textNodes.length - 1];
  target.textContent = value;
}

function setCellText(cellNode, value) {
  const paragraph = getElementChildren(cellNode).find((node) => localName(node) === "p");
  if (!paragraph) {
    return;
  }

  setParagraphText(paragraph, value);
}

function setParagraphText(paragraphNode, value) {
  const document = paragraphNode.ownerDocument;
  const text = value == null ? "" : String(value);
  const directChildren = getElementChildren(paragraphNode);
  const firstRun = directChildren.find((node) => localName(node) === "r");
  const run = buildRun(document, firstRun, text);

  directChildren
    .filter((node) => localName(node) === "r")
    .forEach((node) => paragraphNode.removeChild(node));

  if (text) {
    paragraphNode.appendChild(run);
  }
}

function buildRun(document, templateRun, text) {
  const run = templateRun ? templateRun.cloneNode(true) : document.createElementNS(WORD_NS, "w:r");

  Array.from(run.childNodes)
    .filter((node) => localName(node) !== "rPr")
    .forEach((node) => run.removeChild(node));

  const textNode = document.createElementNS(WORD_NS, "w:t");
  if (/^\s|\s$/.test(text)) {
    textNode.setAttributeNS(XML_NS, "xml:space", "preserve");
  }
  textNode.appendChild(document.createTextNode(text));
  run.appendChild(textNode);
  return run;
}

function getRows(tableNode) {
  return getElementChildren(tableNode).filter((node) => localName(node) === "tr");
}

function getCells(rowNode) {
  return getElementChildren(rowNode).filter((node) => localName(node) === "tc");
}

function getElementChildren(node) {
  return Array.from(node.childNodes || []).filter((child) => child.nodeType === 1);
}

function localName(node) {
  return node.localName || String(node.nodeName || "").split(":").pop();
}

module.exports = { exportPlanAsWord };
