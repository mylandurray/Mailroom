// Sample designs for "Your own design". Run: node samples/make-design-samples.mjs
import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

const MM = 72 / 25.4;
const green = rgb(0.16, 0.31, 0.24);
const gold = rgb(0.7, 0.59, 0.33);
const pale = rgb(0.93, 0.95, 0.91);

// A4 letter and its back page, with 3 mm bleed round a trim box, as print shops ask for.
{
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const bleed = 3 * MM;
  for (const back of [false, true]) {
    const page = doc.addPage([216 * MM, 303 * MM]);
    page.setTrimBox(bleed, bleed, 210 * MM, 297 * MM);
    const top = 300 * MM;
    // Band runs into the bleed at the top so trimming leaves no white edge.
    page.drawRectangle({ x: 0, y: top - 32 * MM, width: 216 * MM, height: 32 * MM + bleed, color: green });
    page.drawText(back ? "How to reach us" : "Riverside Community Garden", {
      x: 23 * MM,
      y: top - 20 * MM,
      size: 20,
      font: bold,
      color: rgb(1, 1, 1),
    });
    if (!back) {
      page.drawText("Unit 4, Mill Lane, Kilkenny · R95 X2Y3", { x: 23 * MM, y: top - 28 * MM, size: 9, font, color: pale });
      const body = [
        "Dear neighbour,",
        "",
        "Our spring open day is on Saturday 14 March, from 11am to 4pm.",
        "Bring the family, bring a friend, and bring a pot if you'd like a seedling to take home.",
        "",
        "Warm regards,",
        "The Riverside team",
      ];
      body.forEach((line, i) =>
        page.drawText(line, { x: 23 * MM, y: top - 110 * MM - i * 16, size: 11, font, color: rgb(0.15, 0.15, 0.15) }),
      );
    } else {
      page.drawRectangle({ x: 23 * MM, y: 120 * MM, width: 170 * MM, height: 90 * MM, color: pale });
      page.drawText("Map", { x: 100 * MM, y: 162 * MM, size: 24, font: bold, color: gold });
    }
    page.drawRectangle({ x: 0, y: 0, width: 216 * MM, height: 13 * MM + bleed, color: gold });
  }
  writeFileSync("samples/mailer-a4.pdf", await doc.save());
}

// A 90 × 55 mm name badge with room for a name and an organisation in the middle.
{
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([90 * MM, 55 * MM]);
  page.drawRectangle({ x: 0, y: 44 * MM, width: 90 * MM, height: 11 * MM, color: green });
  page.drawText("SUMMIT 2026", { x: 6 * MM, y: 48 * MM, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: 0, width: 90 * MM, height: 5 * MM, color: gold });
  writeFileSync("samples/badge.pdf", await doc.save());
}

// An A6 postcard stored portrait with /Rotate 90, as some design tools export landscape pages.
{
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([105 * MM, 148 * MM]);
  // Drawn turned anticlockwise, so it reads correctly once the viewer turns the page clockwise.
  page.drawRectangle({ x: 0, y: 0, width: 20 * MM, height: 148 * MM, color: green });
  page.drawText("Greetings from Kilkenny", {
    x: 13 * MM,
    y: 8 * MM,
    size: 16,
    font: bold,
    color: rgb(1, 1, 1),
    rotate: degrees(90),
  });
  page.drawLine({ start: { x: 20 * MM, y: 74 * MM }, end: { x: 100 * MM, y: 74 * MM }, color: gold, thickness: 1 });
  page.setRotation(degrees(90));
  writeFileSync("samples/postcard-rotated.pdf", await doc.save());
}

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.aoa_to_sheet([
    ["First name", "Last name", "Organisation", "Address 1", "Town", "Eircode"],
    ["Seán", "Ó Súilleabháin", "Kilkenny County Council", "12 Main Street", "Kilkenny", "R95 A1B2"],
    ["Zoë", "Byrne", "Byrne & Daughters Ltd", "4 Café Row", "Cork", "T12 A123"],
    ["Łukasz", "Wiśniewski", "Irish Polish Society", "5 Oak Road", "Naas", "W91 A1B2"],
    ["Maximiliana", "Featherstonehaugh-Cholmondeley", "The Very Long Name Institute of Horticultural Research and Development", "The Old Rectory, Upper Ballinacarrig", "Castlecomer", "R95 Z9Y8"],
    ["Aoife", "Kelly", "", "3 Church Lane", "Sligo", "F91 K2L3"],
  ]),
  "Attendees",
);
writeFileSync("samples/attendees.xlsx", XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("Wrote mailer-a4.pdf, badge.pdf, postcard-rotated.pdf, attendees.xlsx");
