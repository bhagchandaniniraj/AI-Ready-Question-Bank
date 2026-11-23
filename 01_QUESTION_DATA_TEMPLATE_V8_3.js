/*
 * 01_QUESTION_DATA_TEMPLATE_V8_3.js
 *
 * 1. Replace the placeholder Question ID with an EXISTING Question ID.
 * 2. Replace the sample field values with the values for your own subject.
 * 3. Run this snippet in Chrome DevTools > Sources > Snippets.
 * 4. Then let the v8.3 userscript process the stored JSON.
 *
 * IMPORTANT:
 * - "module" is ONE module only.
 * - "topics" is an ARRAY: include one or more exact topic labels/IDs.
 * - If a topic label itself contains commas, keep it as one array item.
 * - Rubric marks must add up exactly to the question's "marks".
 * - You can use labels OR portal option IDs for module/topics.
 * - Omit a field to leave that portal field unchanged.
 */

window.questionData = [
  {
    "questionId": "REPLACE_WITH_EXISTING_QUESTION_ID",

    "questionType": "Regular",
    "marks": 4,
    "difficulty": "Medium",

    "module": {
      "text": "EXACT MODULE LABEL FROM THE PORTAL DROPDOWN"
    },

    "topics": [
      {
        "text": "EXACT TOPIC LABEL 1"
      },
      {
        "text": "EXACT TOPIC LABEL 2"
      }
    ],

    "courseOutcome": "CO3",
    "bloomsTaxonomy": "Apply",

    "question": "<p>Write the updated question prompt here.</p>",

    "answer": "<p>Write the expected answer or solution key here.</p>",

    "alternateAnswers": [
      "Alternative acceptable answer 1.",
      "Alternative acceptable answer 2."
    ],

    "rubric": [
      {
        "criterion": "Criterion 1",
        "expectedEvidence": "Describe the evidence required for this criterion.",
        "marks": 2
      },
      {
        "criterion": "Criterion 2",
        "expectedEvidence": "Describe the evidence required for this criterion.",
        "marks": 2
      }
    ]
  }
];

try {
  localStorage.setItem(
    "__MU_MARWADI_QB_DATA_V7__",
    JSON.stringify(window.questionData)
  );
  console.log(
    "MU QB v8.3: " + window.questionData.length +
    " question record(s) stored. Ready for Start / Resume."
  );
} catch (error) {
  console.error("MU QB data storage failed:", error);
  alert("Could not store question data: " + (error.message || error));
}
