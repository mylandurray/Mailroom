// The user guide shown on the Help tab. Keep it in step with the app; README.md is for developers.
// Write for someone using Mailroom for the first time: short sentences, the words on the
// screen in <em>, and no jargon without an explanation.
const ISSUES = "https://github.com/mylandurray/Mailroom/issues";

const tip = (html) => `<p class="tip"><strong>Tip:</strong> ${html}</p>`;
const warn = (html) => `<p class="callout">${html}</p>`;

const groups = [
  [
    "Start here",
    [
      [
        "start",
        "What Mailroom does",
        `<p>Mailroom takes a <strong>spreadsheet of names and addresses</strong> and turns it into a
        <strong>PDF that's ready to print</strong>. You don't need to set anything up or install
        anything.</p>
        <p>What would you like to print?</p>
        <div class="help-choices">
          <a href="#help-labels"><strong>Address labels</strong><span>Sticky labels on an A4 sheet</span></a>
          <a href="#help-envelopes"><strong>Envelopes</strong><span>Addresses printed straight onto C5 or C4 envelopes</span></a>
          <a href="#help-designs"><strong>Letters, mailers or badges</strong><span>Names and addresses added to your own design</span></a>
        </div>
        <p><strong>Your information stays private.</strong> Everything happens inside your web
        browser. Your spreadsheet, addresses and passwords are never sent anywhere.</p>
        ${tip(`Want to have a look first? Go to the <a href="#print">Print tab</a> and click
        <em>Load sample addresses</em>. You can try everything without your own spreadsheet.`)}`,
      ],
      [
        "basics",
        "The basics in 4 steps",
        `<p>Whatever you're printing, it works the same way. The <em>Print</em> tab is laid out in
        this order: the bar along the top, then from left to right.</p>
        <ol class="steps">
          <li><strong>Load your spreadsheet.</strong> In the bar along the top (<em>01</em>), click <em>Choose a
          spreadsheet</em> and pick your file.</li>
          <li><strong>Tell Mailroom which column goes on which line.</strong> In box <em>02</em>,
          pick a column for each line of the address, for example <em>Name</em>, then
          <em>Street</em>, then <em>Town</em>.</li>
          <li><strong>Pick what you're printing on.</strong> Use the <em>Layout Preset</em> list
          above the preview (labels, envelopes, or your own design).</li>
          <li><strong>Check the preview, then download.</strong> Click <em>Download PDF</em> (top
          right), open the file and print it at <strong>Actual size / 100%</strong>.</li>
        </ol>
        ${warn(`<strong>Always print at “Actual size” or “100%”.</strong> If your printer is set to
        “Fit to page”, everything comes out slightly too small and won't line up.`)}`,
      ],
      [
        "spreadsheet",
        "Getting your spreadsheet ready",
        `<p>Mailroom reads Excel files (.xlsx or .xls), OpenDocument files (.ods) and CSV files.</p>
        <ul>
          <li><strong>One person or address per row.</strong></li>
          <li><strong>One kind of information per column</strong>, such as <em>Name</em>,
          <em>Street</em>, <em>Town</em>, <em>County</em>, <em>Eircode</em>.</li>
          <li><strong>Give each column a title in the first row</strong> (called a
          <em>heading</em>). It makes the columns easier to pick. If your first row is already an
          address, untick <em>First row contains column headings</em>.</li>
          <li>If the file has several tabs at the bottom, choose the right one under
          <em>Worksheet</em>.</li>
          <li>Rows you've hidden or filtered out in Excel are left out.</li>
          <li>If the file has a password, Mailroom asks for it. The password isn't saved.</li>
        </ul>
        ${tip(`Blank cells are fine. Mailroom skips empty lines so there are no gaps in the
        address.`)}`,
      ],
    ],
  ],
  [
    "How to…",
    [
      [
        "labels",
        "Print address labels",
        `<p><strong>You'll need:</strong> your spreadsheet and a pack of A4 label sheets.
        Mailroom is set up for sheets with 21 labels (Avery L7160 / J8160 size). For other
        sizes, see <a href="#help-label-sheets">other label sheets</a>.</p>
        <ol class="steps">
          <li><strong>Load your spreadsheet</strong> in the bar along the top (<em>01</em>). Click <em>Choose a
          spreadsheet</em>, or drag the file onto it.</li>
          <li><strong>Choose the address lines</strong> in box <em>02</em>. For each line, pick
          the column to print. To put two columns on the same line (e.g. <em>First name</em> and
          <em>Last name</em>), pick both. Use <em>+ Add address line</em> if you need more lines.
          <em>What's in each column</em> shows the first two rows, so you can see which column
          holds what.</li>
          <li><strong>Choose the label sheet.</strong> Above the preview, set <em>Layout
          Preset</em> to <em>21-up A4 labels</em>. You can change the <em>Text size</em> at the
          top of box <em>02</em>.</li>
          <li><strong>Check the preview.</strong> Use the arrows to look through the pages. If
          Mailroom thinks some addresses look incomplete, a warning appears above the preview: click its
          button to go to each one, or <em>Acknowledge</em> if they're fine.</li>
          <li><strong>Click <em>Download PDF</em></strong> at the top right.</li>
          <li><strong>Print the PDF at Actual size / 100%</strong>, not “Fit to page”.</li>
        </ol>
        ${tip(`Using a sheet with some labels already peeled off? Set <em>Start at label</em>
        (in the bar along the top) to the first unused label. Labels are counted across, then down.`)}
        ${tip(`Before printing on real labels, print one page on plain paper and hold it up
        against a label sheet to the light.`)}`,
      ],
      [
        "envelopes",
        "Print envelopes",
        `<p><strong>You'll need:</strong> your spreadsheet, envelopes, and a printer that can take
        them.</p>
        <ol class="steps">
          <li><strong>Load your spreadsheet</strong> and <strong>choose the address lines</strong>
          as for labels.</li>
          <li><strong>Set <em>Layout Preset</em></strong> to C5 (229 × 162 mm, fits A4 folded once)
          or C4 (324 × 229 mm, fits A4 flat). Each address gets its own page.</li>
          <li><strong>Add a ceadúnas if you need one</strong> (in box <em>03 Envelope
          extras</em>). This is the postage-paid licence mark printed in place of a stamp. Choose
          the image (PNG or JPEG under 1 MB); ask the office where the company's copy is kept. It
          prints top right. It isn't remembered, so add it again after reloading the page.</li>
          <li><strong>Add a return address if you want one.</strong> Under <em>Return
          address</em>, choose <em>Same on every envelope</em> and type it in, or <em>From
          spreadsheet columns</em>. It prints top left.</li>
          <li><strong>Download the PDF.</strong> In the print window, choose the envelope size
          (C5 or C4) as the paper size and print at 100%.</li>
        </ol>
        ${tip(`Envelopes go into printers in different ways (face up or down, flap left or right).
        Check your printer's manual or the picture on its tray, and print <strong>one</strong>
        test envelope first.`)}`,
      ],
      [
        "designs",
        "Print letters, mailers or name badges",
        `<p>Use this when you have your own design (a letter, a flyer, a badge) and want each copy
        to show a different person's name or address.</p>
        <p><strong>You'll need:</strong> your spreadsheet, and the design saved as a PDF (best,
        as it stays sharp), or a PNG or JPEG image. Canva, Word and most design programs can save
        a PDF. Flatten PDF forms and annotations before uploading if Mailroom cannot preserve them.</p>
        <ol class="steps">
          <li><strong>Set <em>Layout Preset</em></strong> to <em>Your own design</em>.</li>
          <li><strong>Load your spreadsheet</strong> as usual.</li>
          <li><strong>Choose your design</strong> under <em>Choose your design</em>. For an image,
          also pick the page size it should fill.</li>
          <li><strong>If your design has several pages</strong> (e.g. a letter with a back page),
          pick the page the names go on, and tick every page you want printed. Enable
          <em>Double-sided printing</em> to add a blank back after odd page sets, so each
          recipient starts on a new sheet. Use the same paper size and orientation for all
          selected pages, and enable duplex in your PDF viewer. Otherwise print single-sided.</li>
          <li><strong>Add and place text boxes.</strong> Use <em>+ Add text box…</em>, then drag
          the box on the preview to move it, or drag its corner to resize it. For each box, pick
          the columns to show, or type text that's the same on every copy.</li>
          <li><strong>Download the PDF</strong> and print at <strong>Actual size / 100%</strong>.</li>
        </ol>
        <p>You get one copy of the design per row of your spreadsheet, one per page. Mailroom
        doesn't fit several badges onto one sheet of paper. A print shop can do that for you.</p>
        ${tip(`If a name is too long for its box, the text gets smaller to fit. If it would get
        smaller than the box's <em>Shrink to</em> size, the box turns orange so you can make it
        bigger.`)}
        <h3>Window envelopes</h3>
        <p>An <em>Address</em> text box starts where the window is on most C5 and C4 window
        envelopes. Print one page on plain paper, fold it as you'll fold the letters, and check
        the address shows through the window. <em>Move to window envelope position</em> puts a
        box back if you've moved it.</p>
        <h3>Paper or badges that are already printed</h3>
        <p>Untick <em>Print the design</em>. You'll still see the design in the preview to help you
        place the text, but the PDF will only have the text on it.</p>
        <h3>Using the same design again</h3>
        <p>Click <em>Save project</em> to keep your design and text boxes in a file. Next time,
        click <em>Open project…</em>, then load the new spreadsheet. As long as the columns have
        the same headings, everything is set up again. Mailroom doesn't remember designs any other
        way, so save a project if you'll need it again.</p>`,
      ],
      [
        "label-sheets",
        "Use a different label sheet",
        `<p>If your labels aren't the 21-per-sheet kind, tell Mailroom about them once and it
        remembers them. This is called a <em>label preset</em>.</p>
        <ol class="steps">
          <li>Open the <em>Layout Preset</em> list above the preview and choose <em>+ New label
          preset…</em> at the bottom.</li>
          <li><strong>Look for your sheet</strong> under <em>Start from a common sheet</em>. Most
          Avery sheets are there. Choose it and everything is filled in for you. Check the sizes
          against the packet.</li>
          <li><strong>Not listed?</strong> Fill in the numbered steps using the measurements on the
          packet (or measure with a ruler). Each measurement has a letter showing where it is on
          the drawing, which updates as you type.</li>
          <li>Most sheets have the labels in the middle of the page, so leave <em>Centre the labels
          on the page</em> ticked unless yours don't.</li>
          <li>The message under the drawing tells you if the labels fit. Anything shown in red runs
          off the page. When it looks right, click <em>Save label preset</em>.</li>
        </ol>
        <p>Your new preset appears under <em>Your label presets</em> in the <em>Layout
        Preset</em> list. To change or remove it, choose it and click <em>Edit</em> or
        <em>Delete</em>.</p>
        ${tip(`Presets are saved in this browser on this computer only. On another computer,
        you'll need to add them again.`)}`,
      ],
      [
        "spreadsheet-presets",
        "Reuse your address lines for a repeat job",
        `<p>If you get the same kind of spreadsheet again and again, set up the address lines once
        and save them as a <em>spreadsheet preset</em>.</p>
        <ol class="steps">
          <li>Load the spreadsheet and choose the columns for each line in box <em>02</em>.</li>
          <li>Click <em>Save as preset…</em> and give it a name, such as “Weekly Dublin mailing”.</li>
          <li>Next time, load the new spreadsheet. If it has the same column headings, the preset
          is used automatically. Otherwise choose it from the <em>Spreadsheet Preset</em> list.</li>
        </ol>
        <p>If you change the columns afterwards, click <em>Update preset</em> to keep the change,
        or <em>Delete</em> to remove the preset. Presets follow the column
        <strong>headings</strong>, so it doesn't matter if the columns move around, but a
        spreadsheet that has lost or renamed a heading can't use the preset. Repeated headings
        are saved by occurrence (first, second, and so on). Older presets with ambiguous
        headings require you to choose the columns again and save the preset.</p>
        ${tip(`Presets only remember which columns go on which line and the text size, never the
        addresses. Like label presets, they are saved in this browser on this computer only.`)}`,
      ],
    ],
  ],
  [
    "If something's not right",
    [
      [
        "alignment",
        "The print doesn't line up",
        `<p><strong>First, check you printed at Actual size / 100%.</strong> If the labels are fine at
        the top but get further out towards the bottom, the PDF was printed with “Fit to page”.
        Print it again at 100%.</p>
        <p><strong>If everything is shifted by the same amount</strong> (e.g. all 2 mm too low),
        the printer itself is placing the page slightly off. This can be corrected in the
        printer's own settings, often called <em>registration</em>, <em>margin adjustment</em> or
        <em>image position</em>. If you're not sure how, ask whoever looks after the printer.</p>
        ${tip(`Test on plain paper first and hold it against a label sheet or envelope. It saves
        wasting labels.`)}`,
      ],
      [
        "troubleshooting",
        "Common problems",
        `<table>
          <thead><tr><th>What you see</th><th>What to do</th></tr></thead>
          <tbody>
            <tr><td>The <em>Download PDF</em> button is greyed out</td><td>Load a spreadsheet first and pick at least one column in box <em>02</em>. If a message under the preview names a problem, fix that first.</td></tr>
            <tr><td>My columns don't look right, or the first address is missing</td><td>Tick or untick <em>First row contains column headings</em>, and check the right <em>Worksheet</em> is chosen.</td></tr>
            <tr><td>Some addresses are orange in the preview</td><td>They're too long to fit, even with smaller text. Shorten them in the spreadsheet, choose a smaller <em>Text size</em>, or use fewer lines.</td></tr>
            <tr><td>A warning says addresses look incomplete</td><td>Some rows are missing parts of the address. Click the button in the warning to go through them, or <em>Acknowledge</em> if they're fine.</td></tr>
            <tr><td>Labels get further out of line towards the bottom</td><td>Print again at Actual size / 100%, not “Fit to page”.</td></tr>
            <tr><td>Everything is shifted by the same amount</td><td>See <a href="#help-alignment">the print doesn't line up</a>.</td></tr>
            <tr><td>“Password-protected in a way Mailroom can't open”</td><td>Open the file in Excel, choose <em>File → Save As → Excel Workbook (.xlsx)</em>, and load the new file.</td></tr>
            <tr><td>“Characters the PDF font can't print”</td><td>The message says which row. Mailroom can print most European letters and accents, plus Greek and Cyrillic, but not scripts such as Arabic or Chinese. Change that character in the spreadsheet.</td></tr>
            <tr><td>Accents look wrong (e.g. <code>SeÃ¡n</code> instead of Seán)</td><td>Please <a href="#help-contact">let us know</a> and say what type of file it was.</td></tr>
            <tr><td>“This PDF is protected”</td><td>Save or export your design again without a password.</td></tr>
            <tr><td>My design doesn't show in the preview</td><td>It will still be in the PDF. Open the downloaded PDF to check before printing lots.</td></tr>
            <tr><td>Nothing happens, or the page is blank</td><td>Use an up-to-date Microsoft Edge or Google Chrome, and open the link or file you were given.</td></tr>
            <tr><td>Someone else's return address or settings show up</td><td>Click <em>Forget saved settings</em> at the top right of the Print tab.</td></tr>
          </tbody>
        </table>`,
      ],
      [
        "contact",
        "Still stuck?",
        `<p>Ask whoever set Mailroom up for you, or
        <a href="${ISSUES}" target="_blank" rel="noopener">report it on GitHub</a>. It helps if
        you include:</p>
        <ul>
          <li>the type of spreadsheet (.xlsx, .xls or .csv)</li>
          <li>what you were printing (labels, envelopes or your own design)</li>
          <li>a screenshot of any message you saw</li>
        </ul>`,
      ],
    ],
  ],
  [
    "Good to know",
    [
      [
        "privacy",
        "What Mailroom remembers",
        `<p>To save you time, Mailroom remembers your column choices, return address, layout,
        label presets and spreadsheet presets <strong>on this computer, in this browser</strong>. It never saves the
        addresses themselves, your designs or the ceadúnas.</p>
        ${warn(`<strong>On a shared computer</strong>, the next person will see your settings.
        Click <em>Forget saved settings</em> (top right of the Print tab) when you finish.`)}`,
      ],
      [
        "limits",
        "Limits and details",
        `<ul>
          <li>Up to 10,000 populated, visible recipient rows per worksheet (excluding headings, blank rows and hidden rows) and 20,000 labels or pages per PDF. Split bigger
          lists into several files.</li>
          <li>Designs can be up to 20 MB and 50 pages.</li>
          <li>Long addresses get smaller automatically to fit, down to 6 pt. Anything that still
          doesn't fit is shown in orange.</li>
          <li>Addresses print in the Arimo font, which looks the same as Arial. It covers Irish and
          other European accents (such as á, Ł, ė and ş), Greek and Cyrillic.</li>
          <li>Mailroom works best in an up-to-date Microsoft Edge or Google Chrome. Firefox works
          too. Internet Explorer and browsers from before 2022 won't show the preview properly.</li>
        </ul>`,
      ],
      [
        "words",
        "Words you'll see",
        `<dl class="glossary">
          <dt>Column</dt><dd>A vertical strip of cells in your spreadsheet, such as all the towns.</dd>
          <dt>Heading</dt><dd>The title at the top of a column, such as “Town”.</dd>
          <dt>Row</dt><dd>One line across your spreadsheet: usually one person or address.</dd>
          <dt>Layout Preset</dt><dd>What you're printing on: a label sheet, an envelope size, or your own design.</dd>
          <dt>Label preset</dt><dd>The measurements of a label sheet, saved so you can use it again.</dd>
          <dt>Spreadsheet preset</dt><dd>The address lines you chose for one kind of spreadsheet, saved so a repeat job needs no setup.</dd>
          <dt>Actual size / 100%</dt><dd>A print setting that prints the PDF at its real size. Always use it with Mailroom.</dd>
          <dt>Fit to page</dt><dd>A print setting that shrinks the page slightly. Don't use it: labels won't line up.</dd>
          <dt>Ceadúnas</dt><dd>The postage-paid licence mark printed where a stamp would go.</dd>
          <dt>C5 / C4</dt><dd>Envelope sizes. C5 takes an A4 page folded once; C4 takes it flat.</dd>
          <dt>Text box</dt><dd>An area you place on your own design where names or addresses are printed.</dd>
          <dt>Project</dt><dd>A <code>.mailroom</code> file that keeps your design and text boxes for next time.</dd>
        </dl>`,
      ],
    ],
  ],
];

export const helpTemplate = `
<div class="help">
  <nav class="card help-nav" aria-label="Help topics">
    <h2>Help</h2>
    ${groups
      .map(
        ([group, sections]) =>
          `<h3>${group}</h3><ul>${sections
            .map(([id, title]) => `<li><a href="#help-${id}">${title}</a></li>`)
            .join("")}</ul>`,
      )
      .join("")}
  </nav>
  <div class="help-body">
    ${groups
      .flatMap(([, sections]) => sections)
      .map(
        ([id, title, body]) =>
          `<section class="card" id="help-${id}"><h2>${title}</h2>${body}</section>`,
      )
      .join("")}
  </div>
</div>`;
