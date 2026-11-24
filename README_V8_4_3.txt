MARWADI UNIVERSITY QUESTION BANK — AUTO RESUME UPDATER
Version 8.4.3

PURPOSE OF THIS CORRECTION
- The university question form has one Expected Answer / Solution Key CKEditor field.
- There is no separate Alternate Answers field.
- Version 8.4.3 appends all alternate acceptable answers directly after the main answer in that same CKEditor field.
- HTML tags inside alternateAnswers are now interpreted as HTML formatting, rather than displayed as literal tag text.
- Plain-text alternate answers are also supported and are converted into readable paragraphs and line breaks.

WHAT IS FIXED
Previous behavior:
  "<p><strong>Nodes</strong> represent users.</p>"
was escaped and could appear in the editor as visible angle-bracket tags.

New behavior:
  "<p><strong>Nodes</strong> represent users.</p>"
is parsed as HTML and displayed with bold formatting and paragraph structure.

SUPPORTED FORMATTING
The sanitizer preserves common answer formatting, including:
- Paragraphs, divisions, line breaks and horizontal rules
- Bold, italic, underline, strike-through and headings
- Ordered lists, bullet lists and nested lists
- Tables, table headings, rows and cells
- Block quotes, code/preformatted text, subscript and superscript
- Safe inline styles such as text alignment, font weight, font style, text decoration and simple colors
- Safe links using HTTP, HTTPS or mailto

For safety, executable or embedded elements such as scripts, iframes, forms and embedded objects are removed. Unsupported wrapper tags are unwrapped while their readable text is retained. Unsafe attributes and unsafe link protocols are not passed to CKEditor.

JSON FORMAT — NO CHANGE REQUIRED
Keep the same question-data structure. The alternateAnswers property remains an array of strings (or a single string):

  "answer": "<p><strong>Main model answer</strong> goes here.</p>",
  "alternateAnswers": [
    "<p><strong>Alternative 1:</strong> Another acceptable explanation.</p>",
    "<ul><li>First key point</li><li>Second key point</li></ul>",
    "<table><tr><th>Term</th><th>Meaning</th></tr><tr><td>Node</td><td>User</td></tr></table>",
    "Plain-text alternative answer. It will be formatted automatically."
  ],
  "rubric": [ ... ]

Important:
- Keep the main answer in "answer".
- Put each additional acceptable answer in "alternateAnswers".
- HTML strings should use valid HTML tags and properly paired opening/closing tags where applicable.
- Do not wrap HTML in Markdown code fences (```html ... ```). Put the HTML fragment directly in the JSON string.
- Plain text remains valid; it does not need HTML tags.
- Avoid duplicating the same alternative in both answer and alternateAnswers.
- No separate Alternate Answers field is used on the university portal.

INSTALL / UPDATE
1. Stop the current batch using the updater's Stop control.
2. Extract this ZIP file.
3. Open the Tampermonkey Dashboard.
4. Open the existing Marwadi University Question Bank updater script for editing.
5. Replace the entire old userscript with the complete contents of:
   02_AUTOMATION_ENGINE_V8_4_3.user.js
6. Save the userscript.
7. Refresh the university question-bank page.
8. If you have changed the question data, run your existing question-data snippet again before starting. The JSON structure and localStorage data key are unchanged.
9. Press Start / Resume. Test one question first and inspect the Expected Answer field before running a large batch.

PROGRESS AND EXISTING FEATURES
- The existing data and progress storage keys are retained for compatibility with the previous v8.4.x updater.
- Auto-resume, saved progress, movable progress panel and Start / Resume, Stop, Reset and Skip controls are retained.
- Metadata and multi-topic selection behavior are retained.
- Existing rubrics are removed and recreated according to the supplied JSON rubric rows.
- Normal updates continue to update all supplied fields.
- Question-paper-restricted updates continue to update Expected Answer and rubrics only.
- Existing automatic success-popup handling and bounded recovery behavior are retained.
- Alternate answers are appended in both normal and restricted update modes.

VALIDATION NOTE
The userscript passed a JavaScript syntax check. This package has not been tested against a live university portal session in this environment. Verify the first saved question in the portal before starting an unattended batch.


README- v8.4.2
=====================
MARWADI UNIVERSITY QUESTION BANK — AUTO RESUME UPDATER
Version 8.4.2

PURPOSE OF THIS CORRECTION
- The university question form does not have a separate Alternate Answers field.
- Version 8.4.2 appends every alternate answer directly to the main Expected Answer.
- The combined content is submitted through the same Expected Answer CKEditor field.
- The updater no longer searches for, or attempts to populate, a separate Alternate Answers portal control.

HOW ALTERNATE ANSWERS ARE ADDED
Keep the main model answer in the question object's "answer" property. Add alternatives
at the same level using "alternateAnswers":

  "answer": "<p>Main model answer...</p>",
  "alternateAnswers": [
    "Another acceptable explanation...",
    "A second acceptable answer..."
  ],
  "rubric": [ ... ]

The property must be inside the same question object. It accepts either an array of
plain-text answers or one plain-text string. Empty values are ignored. The script
appends a heading, a short explanatory line, and a numbered list after the main answer.
Special HTML characters are escaped and line breaks in alternate answers are preserved.

IMPORTANT DATA NOTE
- Keep only the main model answer in "answer".
- Put additional acceptable answers in "alternateAnswers".
- If the same alternative is already written inside "answer" and is also listed in
  "alternateAnswers", it may appear twice. Remove the duplicate from one location.
- Existing question-data snippets using the same localStorage data key do not need to
  be rewritten just to use this correction. If you change the data, run your data
  snippet again before starting the batch.

INSTALL / UPDATE
1. Extract this ZIP file.
2. Open Tampermonkey Dashboard and edit your existing MU Question Bank updater.
3. Replace the entire old userscript with the complete contents of
   02_AUTOMATION_ENGINE_V8_4_2.user.js.
4. Save the userscript and refresh the Marwadi University Question Bank page.
5. Use Start / Resume. The existing progress keys are retained by this version.

NORMAL AND RESTRICTED UPDATES
- Normal update: writes the question prompt, combined Expected Answer, metadata and rubrics.
- Restricted update: writes the combined Expected Answer and rubrics only, as in the
  previous updater's question-paper lock handling.
- Alternate answers are appended in both modes.

PRESERVED FEATURES
- Existing JSON/localStorage data format and batch signature fields.
- Auto-resume and saved progress tracking.
- Movable progress panel and Start / Resume, Stop, Reset and Skip controls.
- Rubric row replacement and population.
- Automatic success confirmation handling and bounded popup recovery.
- Existing question identity checks and restricted question-paper handling.

VALIDATION
The userscript passed a JavaScript syntax check. The answer-builder helper was tested
for empty alternatives, multiple alternatives, single-string input, special characters,
and line breaks. The live university portal was not available for an end-to-end save
in this environment; observe the first updated question in the portal before running
an unattended large batch.
