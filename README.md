::: {align="center"}
# AI-Ready-Question-Bank

### A structured AI-assisted workflow for university question banks

**Question Design · Bloom's Taxonomy · Student-Friendly Answers ·
Flexible Rubrics · Browser Automation**

[![GitHub](https://img.shields.io/badge/GitHub-AI--Ready--Question--Bank-181717?logo=github)](https://github.com/bhagchandaniniraj/AI-Ready-Question-Bank)
[![Tampermonkey](https://img.shields.io/badge/Automation-Tampermonkey-00485B?logo=tampermonkey)](https://www.tampermonkey.net/)
[![Chrome](https://img.shields.io/badge/Browser-Google%20Chrome-4285F4?logo=googlechrome)](https://www.google.com/chrome/)

*A practical toolkit for preparing consistent, understandable and
AI-evaluation-aware assessment content.*
:::

------------------------------------------------------------------------

## Contents

1.  [About the project](#1-about-the-project)
2.  [Features](#2-features)
3.  [How the workflow fits together](#3-how-the-workflow-fits-together)
4.  [Requirements](#4-requirements)
5.  [Install Tampermonkey](#5-install-tampermonkey-in-google-chrome)
6.  [Enable userscript
    execution](#6-enable-userscript-execution-in-chrome)
7.  [Install the automation
    userscript](#7-install-the-question-bank-automation-userscript)
8.  [Generate question data with
    ChatGPT](#8-generate-question-data-with-chatgpt)
9.  [Load the question-data JavaScript
    file](#9-load-the-question-data-javascript-file)
10. [Run the updater](#10-run-the-question-bank-updater)
11. [Question-data
    structure](#11-understand-the-question-data-structure)
12. [Batch processing](#12-batch-processing)
13. [Troubleshooting](#13-troubleshooting)
14. [Security and responsible
    use](#14-security-privacy-and-responsible-use)
15. [Limitations and verification](#15-limitations-and-verification)
16. [Contributing](#16-contributing)
17. [Disclaimer](#17-disclaimer)

------------------------------------------------------------------------

## 1. About the project

**AI-Ready-Question-Bank** is an educational workflow that combines
ChatGPT-generated academic content with browser-based question-bank
updating.

It is designed for educators, faculty members and academic
administrators who need to prepare or revise university questions in a
consistent format.

The workflow helps transform source questions into:

-   concise, student-friendly examination questions;
-   questions aligned with the assigned level of **Bloom's Taxonomy**;
-   clear model answers written in accessible language;
-   alternative answers that express the same correct knowledge in
    different ways;
-   keyword-oriented marking rubrics with partial-mark allocation; and
-   structured JavaScript data that can be loaded by a compatible
    question-bank automation userscript.

The project supports academic preparation and repetitive data entry. It
does not replace subject-expert review or institutional approval.

## 2. Features

  -----------------------------------------------------------------------
  Capability                          Purpose
  ----------------------------------- -----------------------------------
  Question refinement                 Makes wording clearer while
                                      preserving the intended learning
                                      objective and cognitive level.

  Bloom's Taxonomy                    Uses suitable action verbs for
                                      Apply, Analyze and Evaluate
                                      questions.

  Student-friendly answers            Presents accurate content in simple
                                      language.

  Alternative answers                 Supports valid paragraphs, bullets,
                                      tables and other suitable formats.

  Flexible marking rubrics            Recognizes relevant concepts,
                                      keywords, equivalent terminology
                                      and partial understanding.

  Fractional marks                    Supports allocations such as 0.25,
                                      0.50, 0.75 and 1.25.

  Structured question data            Uses a consistent JavaScript object
                                      structure.

  Batch processing                    Supports a variable number of
                                      question records.

  Browser automation                  Uses a compatible Tampermonkey
                                      userscript to populate existing
                                      question records.
  -----------------------------------------------------------------------

### Assessment principles

Generated answers and rubrics should reward correct concepts rather than
exact sentence matching. They should recognize technically correct
synonyms, equivalent expressions and concise explanations, and avoid
unnecessary deductions for minor spelling or grammar errors when meaning
is clear.

A keyword alone should not receive marks if it is unrelated to the
question or used incorrectly. Marking flexibility must not compromise
academic accuracy.

## 3. How the workflow fits together

The project uses two separate JavaScript components. They have different
purposes and must not be confused.

``` text
              SOURCE QUESTION BANK
                       |
                       v
                 CHATGPT PROMPT
                       |
                       v
          QUESTIONS + ANSWERS + RUBRICS
                       |
                       v
             QUESTION DATA FILE (.js)
                       |
                       v
       CHROME DEVTOOLS / SNIPPETS / CONSOLE
                       |
                       v
            BROWSER LOCAL STORAGE (V7)
                       |
                       v
       TAMPERMONKEY AUTOMATION (.user.js)
                       |
                       v
       QUESTION BANK MANAGEMENT PORTAL
                       |
                       v
             UPDATED EXISTING QUESTIONS
```

### Component A --- Question Data JavaScript

Example: `GRC_449222-449291.js`

This file contains question IDs, metadata, old and updated questions,
question HTML, expected answers, alternative answers and marking
rubrics. It also contains the required Version 7 storage code.

**This is a data file, not a Tampermonkey userscript.** It is executed
through Chrome DevTools on the authorized Question Bank Management
Portal.

### Component B --- Tampermonkey Automation Userscript

Example: `Marwadi-University-Question-Bank-Auto-Resume-Updater.user.js`

This is the browser automation component. It is installed in
Tampermonkey and runs on the portal pages allowed by its userscript
metadata.

The compatible updater reads the stored question data and performs the
configured update workflow for existing question IDs.

**The `.user.js` file is installed in Tampermonkey. The question-data
`.js` file is loaded separately through DevTools.**

> The automation userscript must be obtained from a trusted project
> release or repository file. Generating a question-data file does not
> install the automation engine.

## 4. Requirements

Before beginning, make sure you have:

1.  A desktop or laptop running Windows.
2.  Google Chrome.
3.  An account with authorized access to your institution's Question
    Bank Management Portal.
4.  Tampermonkey installed in Chrome.
5.  The compatible question-bank automation `.user.js` file.
6.  A question-data `.js` file generated for your question IDs.
7.  Permission to edit the relevant existing questions.

The instructions below use Google Chrome on Windows. Menu labels may
vary slightly between versions.

## 5. Install Tampermonkey in Google Chrome

Tampermonkey is a browser extension that manages userscripts: JavaScript
programs that run on specified websites.

### Step 1 --- Open the Chrome Web Store

Visit the official listing:

**[Install Tampermonkey from the Chrome Web
Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)**

### Step 2 --- Add the extension

1.  Click **Add to Chrome**.
2.  Review the extension information and requested permissions.
3.  Click **Add extension** when Chrome asks for confirmation.
4.  Wait for installation to finish.

### Step 3 --- Pin Tampermonkey to the toolbar

1.  Click Chrome's **Extensions** puzzle-piece icon.
2.  Find **Tampermonkey**.
3.  Click the pin icon next to it.
4.  Confirm that the Tampermonkey icon is visible in the browser
    toolbar.

### Step 4 --- Open the Tampermonkey Dashboard

1.  Click the Tampermonkey icon.
2.  Select **Dashboard**.
3.  Use the dashboard to add, edit, enable, disable and manage
    userscripts.

Official resources: [Tampermonkey
website](https://www.tampermonkey.net/) · [Tampermonkey
FAQ](https://www.tampermonkey.net/faq.php?locale=en)

## 6. Enable userscript execution in Chrome

Chrome-based browsers may require an additional permission before
Tampermonkey can execute userscripts.

Tampermonkey's official guidance states that Tampermonkey version 5.3 or
later in Chrome-based browsers requires either the **Allow User
Scripts** setting (available in Chrome 138 and later) or Developer Mode.

### Option A --- Allow User Scripts (Chrome 138 and later)

1.  Right-click the Tampermonkey toolbar icon.
2.  Select **Manage Extension**.
3.  Locate **Allow User Scripts**.
4.  Turn it on.
5.  Return to the portal tab and reload it.

### Option B --- Enable Developer Mode

If the Allow User Scripts toggle is not available:

1.  Open a new Chrome tab.
2.  Enter `chrome://extensions` and press Enter.
3.  Locate the **Developer mode** toggle, usually at the top-right.
4.  Turn Developer mode on.
5.  Return to the portal tab and reload it.

Use the option supported by your Chrome and Tampermonkey versions. You
do not need to enable both if one supported method is sufficient.

Official instructions: [Tampermonkey --- Permission to execute
userscripts](https://www.tampermonkey.net/faq.php?locale=en&q=Q209)

## 7. Install the question-bank automation userscript

The automation userscript is the component that runs the updater panel
on the Question Bank Management Portal.

### Method A --- Install from a published `.user.js` link

Use this method when the project provides a direct raw link to the
userscript.

1.  Open the trusted `.user.js` file link from the project repository.
2.  Tampermonkey should display the userscript installation page.
3.  Review the script name, source code and website permissions.
4.  Confirm that the source is trusted and the website scope is
    appropriate.
5.  Click **Install**.
6.  Open the Tampermonkey Dashboard.
7.  Confirm that the script appears in the installed scripts list and is
    enabled.

### Method B --- Install manually through the Tampermonkey editor

Use this method when you have downloaded the userscript file.

1.  Open the Tampermonkey Dashboard.
2.  Click **Add a new script** (the plus icon).
3.  A new editor tab will open.
4.  Open the downloaded `.user.js` file in Notepad or another text
    editor.
5.  Copy the complete contents, including the userscript metadata
    header.
6.  Return to the Tampermonkey editor.
7.  Replace the default template with the complete script.
8.  Press **Ctrl + S** to save.
9.  Close the editor.
10. Return to the Dashboard and confirm that the script is enabled.

A userscript normally starts with a metadata block similar to this:

``` javascript
// ==UserScript==
// @name         Question Bank Auto-Resume Updater
// @namespace    AI-Ready-Question-Bank
// @version      1.0.0
// @description  Updates existing question-bank records.
// @match        https://YOUR-AUTHORIZED-PORTAL-HOST/*
// @grant        none
// ==/UserScript==
```

This is an illustrative header, not a replacement for the actual
updater. The supplied userscript must contain its own correct metadata,
permissions and website matching rule.

**Important:** Do not copy the illustrative `@match` value into a
working script. Use the exact authorized portal URL pattern supplied
with the compatible updater. Do not broaden the matching rule to every
website.

Official instructions: [How to install new scripts in
Tampermonkey](https://www.tampermonkey.net/faq.php?locale=en&q=Q102)

## 8. Generate question data with ChatGPT

### Step 1 --- Prepare your source

Provide ChatGPT with the question-bank source. Supported source formats
may include TXT, PDF, DOCX, XLSX or a structured table of question IDs
and metadata.

Include as much of the following information as available:

  -----------------------------------------------------------------------
  Field                               Example
  ----------------------------------- -----------------------------------
  Question ID                         449291

  Question Type                       Regular

  Marks                               4

  Difficulty                          Medium

  Course Outcome                      CO2

  Bloom's Taxonomy                    Apply

  Module                              Governance Structures and
                                      Principles (Theory)

  Topics                              Board governance, Corporate
                                      governance models, Role of
                                      stakeholders in governance
  -----------------------------------------------------------------------

### Step 2 --- Provide the master prompt

Use the project's master prompt to request:

1.  The original question.
2.  An updated question, when necessary.
3.  Appropriate Bloom's Taxonomy action verbs.
4.  A simple and accurate model answer.
5.  Alternative answers in suitable formats.
6.  Flexible, keyword-oriented marking rubrics.
7.  Fractional mark allocation where useful.
8.  A complete JavaScript question-data file.
9.  The mandatory Version 7 local-storage script.
10. Validation of question IDs and rubric totals.

### Step 3 --- Review the generated content

Check that the question ID is correct, the updated question preserves
the intended learning objective, the answer is factually correct,
alternatives are valid, the rubric covers important concepts and the
total rubric marks equal the question's maximum marks.

### Step 4 --- Download the generated ZIP

The generated ZIP should contain the question-data `.js` file. Extract
it before proceeding.

Recommended filename convention:

`SUBJECTSHORT_QUESTION_FROM-QUESTION_TO.js`

Examples:

``` text
GRC_449222-449291.js
CYBER_463110-463249.js
COMPLIANCE_456556-456743.js
```

Use the smallest and largest question IDs in the batch, regardless of
their order in the source list.

## 9. Load the question-data JavaScript file

This step stores the generated question records in the local storage of
the currently open portal origin.

### Step 1 --- Open the authorized portal

1.  Open Google Chrome.
2.  Sign in to your institution's Question Bank Management Portal.
3.  Navigate to the appropriate subject and question-management area.
4.  Confirm that you are using an account authorized to update the
    records.

### Step 2 --- Open Chrome Developer Tools

On Windows, use either shortcut:

``` text
Ctrl + Shift + I
```

or

``` text
Ctrl + Shift + J
```

You can also open Developer Tools through Chrome's menu:

**More Tools → Developer Tools**

### Step 3 --- Open the Console or Snippets

**Recommended: use Snippets for reusable data files.**

1.  Open the **Sources** tab.
2.  Find **Snippets** in the left panel.
3.  Click **New Snippet**.
4.  Give it a meaningful name, such as `GRC_449222-449291`.
5.  Open the generated question-data `.js` file in Notepad.
6.  Copy the entire file.
7.  Paste it into the snippet editor.
8.  Press **Ctrl + S** to save.
9.  Press **Ctrl + Enter** to execute it.

Alternatively, you can paste the complete, reviewed data file into the
Console and execute it there.

Only execute code you have reviewed and trust. Chrome may display a
self-XSS warning before allowing console pasting. Follow the browser's
instructions only after reviewing the code.

### Step 4 --- Required Version 7 storage code

Every generated question-data file must end with this storage script:

``` javascript
try {
    localStorage.setItem("__MU_MARWADI_QB_DATA_V7__", JSON.stringify(window.questionData));
    console.log(
        "MU QB: " + window.questionData.length +
        " question records stored for Version 7 automation."
    );
    console.table(window.questionData.map(q => ({
        questionId: q.questionId,
        marks: q.marks,
        rubricTotal: q.rubric.reduce((sum, row) => sum + Number(row.marks), 0),
        difficulty: q.difficulty,
        bloomsTaxonomy: q.bloomsTaxonomy,
        topic: q.topics
    })));
} catch (error) {
    console.error("MU QB data storage failed:", error);
    alert("Could not store question data: " + (error.message || error));
}
```

This code stores the question array, uses the Version 7 storage key,
reports the number of records, displays a summary table and reports
storage errors.

### Step 5 --- Confirm successful storage

After execution, look for a message similar to:

``` text
MU QB: 19 question records stored for Version 7 automation.
```

A table should also appear with question IDs, marks, rubric totals,
difficulty, Bloom's Taxonomy and topics.

You can independently check the number of stored records by running:

``` javascript
JSON.parse(
    localStorage.getItem("__MU_MARWADI_QB_DATA_V7__")
)?.length
```

The result should equal the number of question records in your batch.

**Important:** Run the data file on the same website origin where the
updater will read it. Browser local storage is origin-specific. Do not
run it from a blank tab, a different website or a local file page.

## 10. Run the question-bank updater

### Step 1 --- Open the relevant question-management page

1.  Return to the authorized Question Bank Management Portal.
2.  Open the correct subject.
3.  Navigate to the existing question-management interface.
4.  Confirm that you are not on the blank Add New Question form.

### Step 2 --- Confirm the updater is active

1.  Click the Tampermonkey icon.
2.  Confirm that the question-bank updater is enabled.
3.  If necessary, reload the portal page.
4.  Locate the updater panel provided by the userscript.

### Step 3 --- Check the loaded batch

Before starting, confirm the question count, first question ID, current
question ID (if displayed), loaded-data status and any error or warning
shown by the panel.

### Step 4 --- Start processing

Use the Start or Run control provided by the installed updater.

The compatible updater is designed to process supplied existing question
IDs and populate the configured fields:

-   Question Prompt;
-   Expected Answer / Solution Key; and
-   Marking Rubric rows.

The updater configuration used in this workflow is intended to preserve
the existing metadata fields:

-   Marks;
-   Difficulty;
-   Module;
-   Topics;
-   Course Outcome; and
-   Bloom's Taxonomy.

The configured save-and-resume behavior may handle the update action,
confirmation dialog and page reload, depending on the installed
userscript version.

**Do not assume every third-party or modified userscript has these
capabilities.** Check the actual script version and its instructions
before running it.

### Step 5 --- Monitor progress

Keep the browser open while processing. Monitor the updater panel for
total records, current question ID, completed records, remaining records
and error messages.

Do not run multiple copies of the updater simultaneously on the same
portal session.

### Step 6 --- Review the final records

After processing, reopen and refresh a sample of updated questions from
the portal. Confirm that the Question Prompt, Expected Answer / Solution
Key and rubric rows have been saved correctly on the server.

## 11. Understand the question-data structure

Each question uses the following standardized object structure:

  Property             Description
  -------------------- ----------------------------------
  `questionId`         Existing question's unique ID
  `questionType`       Question type
  `marks`              Maximum marks
  `difficulty`         Difficulty level
  `courseOutcome`      Course outcome
  `bloomsTaxonomy`     Assigned Bloom's level
  `module`             Module name
  `topics`             Topic name
  `oldQuestion`        Original question
  `updatedQuestion`    Improved question
  `question`           Question content in HTML
  `answer`             Expected answer in HTML
  `alternateAnswers`   Array of acceptable alternatives
  `rubric`             Array of marking criteria

### Example question record

``` javascript
window.questionData = [
    {
        "questionId": 123456,
        "questionType": "Regular",
        "marks": 4,
        "difficulty": "Medium",
        "courseOutcome": "CO1",
        "bloomsTaxonomy": "Apply",
        "module": "Example Module",
        "topics": "Example Topic",
        "oldQuestion": "Original question text",
        "updatedQuestion": "Explain the concept using a suitable example.",
        "question": "<p>Explain the concept using a suitable example.</p>",
        "answer": "<p><strong>Definition:</strong> A simple explanation.</p>",
        "alternateAnswers": [
            "<ul><li>Alternative explanation in bullet format.</li></ul>",
            "<p>Alternative explanation in paragraph format.</p>"
        ],
        "rubric": [
            {
                "criterion": "Definition",
                "expectedEvidence": "Accepts the correct definition and equivalent terminology.",
                "marks": 1.0
            },
            {
                "criterion": "Explanation",
                "expectedEvidence": "Accepts relevant concepts and short correct explanations.",
                "marks": 2.0
            },
            {
                "criterion": "Example",
                "expectedEvidence": "Accepts a relevant and technically correct example.",
                "marks": 1.0
            }
        ]
    }
];
```

The example is illustrative. Replace the example ID and content with
actual question-bank records before execution.

### Rubric validation

**Sum of rubric marks = Question marks**

For example:

  Criterion          Marks
  ------------- ----------
  Definition          1.00
  Explanation         2.00
  Example             1.00
  **Total**       **4.00**

Use numeric values for marks, not text strings.

## 12. Batch processing

The question-data array supports a variable number of records.

    Records supplied   Records in the batch
  ------------------ ----------------------
                   1                      1
                   5                      5
                  10                     10
                  25                     25
                  50                     50
                 100                    100

The updater should read the available records dynamically rather than
rely on a hard-coded question count.

For a new batch:

1.  Generate a new question-data file.
2.  Review the IDs and content.
3.  Execute the new file on the authorized portal origin.
4.  Confirm the storage message and record count.
5.  Start the updater.

The new data file replaces the previously stored Version 7 batch under
the same local-storage key. Keep a separate backup of earlier batches if
you need them later.

For large batches, test a small number of records first and process the
remainder only after confirming that the workflow behaves as expected.

## 13. Troubleshooting

  -----------------------------------------------------------------------
  Problem                             What to check
  ----------------------------------- -----------------------------------
  Tampermonkey icon is missing        Open Chrome Extensions and pin
                                      Tampermonkey to the toolbar.

  Userscript does not run             Check that Tampermonkey is enabled,
                                      user-script execution is permitted
                                      and the portal URL matches the
                                      script's `@match` rule.

  Chrome blocks userscripts           Enable Allow User Scripts or the
                                      supported Developer Mode option.

  Data is not stored                  Check that the complete data file
                                      was executed on the correct portal
                                      origin and inspect Console errors.

  Stored count is incorrect           Check the `window.questionData`
                                      array and confirm that the intended
                                      batch was executed.

  Updater panel is missing            Check the userscript's enabled
                                      status, matching URL and page
                                      reload.

  Question ID is not found            Confirm the ID exists and that the
                                      correct subject and authorized
                                      account are open.

  Rubric rows are not populated       Check the rubric array, its field
                                      names and the portal's current form
                                      structure.

  Automation stops after reload       Check the updater's resume
                                      mechanism and whether the stored
                                      batch is still present.

  A JavaScript error appears          Copy the complete error text and
                                      note the current question ID.
  -----------------------------------------------------------------------

### How to report an error

``` text
Project: AI-Ready-Question-Bank

Automation version:
Browser:
Current question ID:
Total questions in batch:
Completed question IDs:

Exact error message:
[Paste the complete error here]

What happened immediately before the error:
[Brief explanation]
```

Do not include passwords, session cookies, authentication tokens or
private student information in error reports.

## 14. Security, privacy and responsible use

Browser automation can interact with pages using the permissions granted
to the userscript. Install only scripts from sources you trust.

Recommended precautions:

1.  Use the automation only with explicit institutional authorization.
2.  Review the userscript source before installation.
3.  Keep the userscript's website matching rule as narrow as practical.
4.  Do not share login credentials, cookies, session tokens or private
    student data.
5.  Keep a backup of original question content.
6.  Review AI-generated answers and rubrics before applying them to
    official records.
7.  Test a small batch before processing a large batch.
8.  Do not execute unfamiliar code merely because it is included in a
    ZIP file.
9.  Disable or remove the userscript when it is no longer needed.

See the [official Tampermonkey
FAQ](https://www.tampermonkey.net/faq.php?locale=en) for information
about permissions and userscript behavior.

## 15. Limitations and verification

Please understand the following:

-   The question-data generator prepares content; it does not
    independently verify institutional records.
-   The updater depends on the portal's current page structure and may
    need maintenance if the portal changes.
-   The Version 7 storage message confirms that data was written to
    browser local storage. It does not prove that the server has saved
    the question updates.
-   Some updater configurations intentionally skip post-save content
    verification because browser cache can return stale values.
-   When verification is skipped, a processed counter is not proof of
    server-side persistence.
-   Always refresh and reopen sample records to confirm that changes are
    present on the server.
-   The automation is designed for existing questions and should not be
    used to create new records unless a separate, explicitly supported
    workflow is developed.

## 16. Contributing

Contributions and suggestions are welcome.

You can help improve the project by improving the master ChatGPT prompt,
adding question-data validation, refining Bloom's Taxonomy mapping,
improving answer and rubric quality, reporting browser compatibility
issues, improving the automation userscript and expanding the
documentation.

### Contribution workflow

1.  Fork the repository.
2.  Create a feature branch.
3.  Make your changes.
4.  Test the changes using sample data.
5.  Submit a Pull Request describing the improvement.

For bugs or feature requests, use the repository's GitHub Issues
section.

## 17. Disclaimer

AI-Ready-Question-Bank is an independent educational project. It is not
an official product, service or endorsement of any university or
academic institution.

The project is intended to assist authorized academic users with
question preparation and repetitive question-bank administration.

Users are responsible for ensuring they have permission to modify
institutional records, checking the academic accuracy of generated
content, complying with institutional policies, protecting confidential
information and confirming that updates have been saved correctly.

The project is provided as an educational and productivity aid. No
guarantee is made that the automation will work with every portal
version or institutional configuration.

------------------------------------------------------------------------

::: {align="center"}
### Built for clearer questions. Designed for fairer assessment. Engineered for efficient workflows.

**Created by Niraj Bhagchandani**

[Visit the GitHub
Repository](https://github.com/bhagchandaniniraj/AI-Ready-Question-Bank)
:::
