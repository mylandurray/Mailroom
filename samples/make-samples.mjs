import * as XLSX from "xlsx";
import { writeFileSync } from "node:fs";
const out = (n) => `samples/${n}`;
const H = ["Name", "Address line 1", "Town", "Eircode"];
const irish = [
  ["Seán Ó Súilleabháin", "12 Main Street", "Dún Laoghaire", "A96 X2Y3"],
  ["Zoë Byrne", "4 Café Row", "Cork", "T12 A123"],
  ["Áine Ní Bhriain", "7 Bóthar na Trá", "Gaillimh", "H91 B456"],
];
const csv = (rows, sep = ",") => rows.map((r) => r.map((c) => (/[",;\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(sep)).join("\r\n") + "\r\n";
writeFileSync(out("utf8-no-bom.csv"), csv([H, ...irish]));
writeFileSync(out("utf8-bom.csv"), "\uFEFF" + csv([H, ...irish]));
// Windows-1252 bytes
const cp = { "\u2019": 0x92, "\u2013": 0x96, "\u20ac": 0x80, "\u201c": 0x93, "\u201d": 0x94 };
const ansiText = csv([H, ["Pádraig O’Brien", "St. Mary’s Terrace", "Apt 1–3 Ennis", "V95 €1"], ["Máire “Molly” Kelly", "3 Church Lane", "Sligo", "F91 K2L3"]]);
writeFileSync(out("excel-ansi.csv"), Buffer.from([...ansiText].map((c) => cp[c] ?? c.charCodeAt(0))));
writeFileSync(out("semicolon.csv"), csv([H, ...irish], ";"));
writeFileSync(out("no-header.csv"), csv(irish));
writeFileSync(out("header-only.csv"), csv([H]));
const save = (name, sheets, opts = {}) => {
  const wb = XLSX.utils.book_new();
  for (const [sname, ws, hidden] of sheets) {
    XLSX.utils.book_append_sheet(wb, ws, sname);
    if (hidden) { wb.Workbook ??= { Sheets: [] }; }
  }
  sheets.forEach(([, , hidden], i) => { if (hidden) { wb.Workbook.Sheets ??= []; wb.Workbook.Sheets[i] = { Hidden: 1 }; } });
  writeFileSync(out(name), XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true, ...opts }));
};
// filtered: 20 rows, 14 hidden via filter + 1 manually hidden => 5 visible, hidden column Notes
const rows20 = Array.from({ length: 20 }, (_, i) => [`Person ${i + 1}`, `${i + 1} High Street`, i < 6 ? "Cork" : "Dublin", `T12 X${100 + i}`, "internal note"]);
const fws = XLSX.utils.aoa_to_sheet([[...H, "Notes"], ...rows20]);
fws["!rows"] = [{}, ...rows20.map((r, i) => ({ hidden: r[2] !== "Cork" || i === 5 }))];
fws["!cols"] = [{}, {}, {}, {}, { hidden: true }];
fws["!autofilter"] = { ref: "A1:E21" };
save("filtered.xlsx", [["Addresses", fws]]);
const bws = XLSX.utils.aoa_to_sheet([H, ...irish]);
bws["!ref"] = "A1:Z1048576";
save("formatted-to-bottom.xlsx", [["Addresses", bws]]);
save("crm-export.xlsx", [["Export", XLSX.utils.aoa_to_sheet([["ID", "Email", "Phone", "First Name", "Last Name", "Address 1", "Address 2", "Town", "Eircode"], [1001, "a@example.com", "0871234567", "Seán", "Murphy", "12 Main St", "", "Cork", "T12 A123"], [1002, "b@example.com", "0869876543", "Zoë", "Byrne", "4 Café Row", "Rathmines", "Dublin 6", "D06 X285"]])]]);
save("polish-names.xlsx", [["Addresses", XLSX.utils.aoa_to_sheet([H, ["Łukasz Wiśniewski", "5 Oak\u200B Road", "Naas", "W91 A1B2"], ["Małgorzata Dąbrowska", "Flat 2\t10 Quay St", "Waterford", "X91 C3D4"], ["Ștefan Popescu", "8 Mill Lane", "Athlone", "N37 E5F6"]])]]);
save("long-addresses.xlsx", [["Addresses", XLSX.utils.aoa_to_sheet([["Name", "Address 1", "Address 2", "Town", "County", "Eircode", "Country"], ["Ms Mary Josephine Fitzgerald-O'Sullivan", "The Old Rectory, Ballinacurra Westmoreland Upper Crescent Road", "Carrigtwohill Industrial Estate", "Midleton", "County Cork", "P25 X9Y8", "Ireland"], ["The Very Reverend Monsignor Pádraig Seosamh Ó Conchobhair-Fitzmaurice", "Parochial House, Saint Brendan the Navigator Parish Church Grounds", "Knocknagoshel Lower Townland, Near the Old Creamery Crossroads", "Abbeyfeale", "County Limerick", "V94 X1Y2", "Ireland"]])]]);
save("hidden-first-sheet.xlsx", [["Lookup", XLSX.utils.aoa_to_sheet([["Code", "Value"], ["A", 1]]), true], ["Addresses", XLSX.utils.aoa_to_sheet([H, ...irish])]]);
const big = Array.from({ length: 10000 }, (_, i) => [`Person ${i + 1}`, `${i + 1} Long Road`, ["Cork", "Dublin", "Galway"][i % 3], `D0${i % 9} X${1000 + (i % 9000)}`]);
save("big.xlsx", [["Addresses", XLSX.utils.aoa_to_sheet([H, ...big])]]);
save("22-addresses.xlsx", [["Addresses", XLSX.utils.aoa_to_sheet([H, ...big.slice(0, 22)])]]);
save("empty.xlsx", [["Sheet1", XLSX.utils.aoa_to_sheet([])]]);
writeFileSync(out("empty-0-bytes.xlsx"), "");
writeFileSync(out("report-renamed.xlsx"), "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");
const good = XLSX.write(XLSX.utils.book_new(XLSX.utils.aoa_to_sheet([H, ...irish])), { type: "buffer", bookType: "xlsx" });
writeFileSync(out("truncated.xlsx"), good.subarray(0, Math.floor(good.length / 2)));
