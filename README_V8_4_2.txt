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
