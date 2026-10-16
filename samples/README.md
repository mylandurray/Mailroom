# Sample files

Safe test data for trying Mailroom. Regenerate with `node samples/make-samples.mjs` (this also creates `big.xlsx`, a 10,000-row file that isn't committed) and `node samples/make-design-samples.mjs` (the designs and `attendees.xlsx`).

| File | What it checks |
|---|---|
| `utf8-no-bom.csv`, `utf8-bom.csv` | Fadas and diaereses (Seán, Dún Laoghaire, Zoë) print correctly |
| `excel-ansi.csv` | Excel "CSV (Comma delimited)" bytes: O’Brien, St. Mary’s, 1–3, € |
| `semicolon.csv` | `;`-separated columns split correctly |
| `no-header.csv`, `header-only.csv` | Heading-row detection; an empty list gets a plain message |
| `filtered.xlsx` | 20 rows, 15 hidden by a filter or by hand, plus a hidden Notes column: 5 print |
| `formatted-to-bottom.xlsx` | Used range `A1:Z1048576` with 3 real rows loads instantly |
| `crm-export.xlsx` | ID/Email/Phone columns aren't auto-mapped; name/address ones are |
| `polish-names.xlsx` | Ł, ą, Ș print; a zero-width space and a tab are cleaned up |
| `long-addresses.xlsx` | Two 7-line addresses: one shrinks to about 8.7 pt, the other below 8 pt with a warning |
| `hidden-first-sheet.xlsx` | Opens the visible "Addresses" sheet, not the hidden "Lookup" |
| `22-addresses.xlsx` | 2 label sheets; with "Start at label 21", sheet 1 has only slot 21 filled |
| `empty.xlsx`, `empty-0-bytes.xlsx`, `report-renamed.xlsx`, `truncated.xlsx` | A plain-language message for each |
| `mailer-a4.pdf` + `attendees.xlsx` | Your own design: a 2-page A4 letter with 3 mm bleed round a trim box. Prints as exact A4, 2 pages per record, address in the window position |
| `badge.pdf` + `attendees.xlsx` | A 90 × 55 mm badge: starts with a bold centred name and an organisation; the very long name wraps and shrinks; Ł and ś print |
| `postcard-rotated.pdf` | A portrait page with /Rotate 90: shows and prints as A6 landscape, the right way up |
| `big.xlsx` (generated) | 10,000 rows: loads, and builds the PDF with a busy indicator |

Not generated: a `.xls` with only "Password to modify" set (Excel → Save As → Tools → General Options). It should open without a password prompt.
