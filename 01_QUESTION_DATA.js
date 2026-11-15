/*
 * 01_QUESTION_DATA.js — MARWADI UNIVERSITY QUESTION BANK
 * Run once in Chrome DevTools > Sources > Snippets.
 * The updater processes every object in this array: 5, 10, 50, or N records.
 * After changing the array, run this snippet again before starting the batch.
 */

window.questionData = [
  {
    "questionId": 463297,
    "oldQuestion": "Discuss in detail the advantages and risks of accepting cybersecurity threats.",
    "bloomsTaxonomy": "Evaluate",
    "marks": 8,
    "question": "<p>Evaluate the advantages and risks of accepting a cybersecurity risk. Give one example.</p>",
    "answer": "<h3>Model Answer</h3>\n<p><strong>Risk acceptance</strong> means that an organization knows about a risk but decides not to take further action because the risk is small or the cost of reducing it is greater than the possible loss. The risk still exists.</p>\n<p><strong>Advantages:</strong> It saves money and time, avoids unnecessary controls, and allows the organization to use its resources for more serious risks.</p>\n<p><strong>Risks:</strong> The threat may still cause damage. Poorly managed acceptance can create hidden weaknesses, financial loss, legal problems, or damage to the organization's reputation.</p>\n<p><strong>Example:</strong> A company may accept a very small risk from occasional minor phishing emails when the possible loss is low and basic security controls are already in place.</p>\n<p>The decision should be approved, recorded, assigned to a responsible person, and reviewed regularly because threats can change. Therefore, risk acceptance is useful only when it is a careful and informed decision.</p>\n<h3>Alternative Answer — Short Points</h3>\n<ul>\n<li><strong>Meaning:</strong> Knowingly keeping a risk without taking additional action.</li>\n<li><strong>Advantages:</strong> Saves cost, saves time, and keeps resources available for major risks.</li>\n<li><strong>Risks:</strong> The threat remains and may cause loss, security problems, or reputation damage.</li>\n<li><strong>Example:</strong> Accepting a low-level phishing risk when its impact is very small.</li>\n<li><strong>Control:</strong> Record, approve, assign, and regularly review the accepted risk.</li>\n<li><strong>Evaluation:</strong> Accept only risks that are within the organization's limits.</li>\n</ul>",
    "rubric": [
      {
        "criterion": "Meaning of Risk Acceptance",
        "expectedEvidence": "Explains that the organization knows about a risk but decides not to take further action; understands that the risk still exists. Accept equivalent simple wording.",
        "marks": 1.5
      },
      {
        "criterion": "Advantages",
        "expectedEvidence": "Mentions saving money, time, effort, avoiding unnecessary controls, or using resources for more serious risks. Award credit for any relevant advantage.",
        "marks": 1.5
      },
      {
        "criterion": "Risks and Limitations",
        "expectedEvidence": "Mentions that the threat remains and may cause damage, hidden vulnerabilities, financial loss, legal problems, or reputation damage. Relevant keywords earn credit.",
        "marks": 2
      },
      {
        "criterion": "Suitable Conditions and Approval",
        "expectedEvidence": "States that acceptance is suitable for low-impact or low-likelihood risks and should be approved, documented, or assigned to a responsible person.",
        "marks": 1.5
      },
      {
        "criterion": "Example and Review",
        "expectedEvidence": "Gives a relevant example such as accepting a minor phishing risk and/or explains that accepted risks should be reviewed when threats change.",
        "marks": 1
      },
      {
        "criterion": "Clarity, Keywords and Language",
        "expectedEvidence": "Give generous credit for relevant keywords and correct meaning, even in brief bullets, a table, or a paragraph. Do not deduct for minor spelling or grammar mistakes if the meaning is clear. Award the maximum marks when the required concepts are present.",
        "marks": 0.5
      }
    ]
  },
  {
    "questionId": 463296,
    "oldQuestion": "Evaluate when risk avoidance is the best treatment strategy.",
    "bloomsTaxonomy": "Evaluate",
    "marks": 8,
    "question": "<p>Evaluate when an organization should avoid a cybersecurity risk. Give one example and mention one limitation.</p>",
    "answer": "<h3>Model Answer</h3>\n<p><strong>Risk avoidance</strong> means stopping an activity that creates an unacceptable risk. An organization chooses not to do something when the possible harm is greater than the benefit.</p>\n<p>Risk avoidance is suitable when a threat may cause serious financial loss, legal problems, regulatory violations, or damage to important information. It is useful when the risk cannot be reduced to an acceptable level.</p>\n<p><strong>Example:</strong> A company may decide not to use a third-party application that has weak security and may expose customer data. By not using it, the company avoids that particular risk.</p>\n<p><strong>Advantages:</strong> It removes exposure to the activity, protects important data, and can help the organization meet legal and security requirements.</p>\n<p><strong>Limitation:</strong> Avoidance may also mean losing business opportunities, reducing innovation, or becoming less competitive.</p>\n<p>Therefore, an organization should choose avoidance when the possible harm is greater than the benefit, while considering the cost of losing the opportunity.</p>\n<h3>Alternative Answer — Short Points</h3>\n<ul>\n<li><strong>Meaning:</strong> Stop or do not start an activity that creates an unacceptable risk.</li>\n<li><strong>When to use:</strong> When the possible impact is very high or legal and security requirements cannot be met.</li>\n<li><strong>Example:</strong> Do not use an insecure third-party application.</li>\n<li><strong>Benefit:</strong> Removes exposure to that activity and protects data and reputation.</li>\n<li><strong>Limitation:</strong> May reduce innovation, business opportunities, or competitiveness.</li>\n<li><strong>Evaluation:</strong> Avoid the activity when its risk is greater than its expected benefit.</li>\n</ul>",
    "rubric": [
      {
        "criterion": "Meaning of Risk Avoidance",
        "expectedEvidence": "Explains that risk avoidance means stopping, not starting, or eliminating an activity that creates an unacceptable risk.",
        "marks": 1.5
      },
      {
        "criterion": "When Avoidance Is Suitable",
        "expectedEvidence": "Identifies high impact, unacceptable threats, serious financial loss, legal or regulatory problems, or risks that cannot be reduced adequately.",
        "marks": 1.5
      },
      {
        "criterion": "Advantages",
        "expectedEvidence": "Explains that avoidance removes exposure to the activity and may protect data, finances, compliance, or reputation.",
        "marks": 1.5
      },
      {
        "criterion": "Relevant Example",
        "expectedEvidence": "Gives an example such as refusing to use an insecure third-party application or cloud service. Accept other relevant cybersecurity examples.",
        "marks": 1.5
      },
      {
        "criterion": "Limitations and Evaluation",
        "expectedEvidence": "Mentions lost opportunities, reduced innovation, cost, or lower competitiveness and makes a reasonable judgment about when avoidance is appropriate.",
        "marks": 1.5
      },
      {
        "criterion": "Clarity, Keywords and Language",
        "expectedEvidence": "Give generous credit for relevant keywords and correct meaning, even in brief bullets, a table, or a paragraph. Do not deduct for minor spelling or grammar mistakes if the meaning is clear. Award the maximum marks when the required concepts are present.",
        "marks": 0.5
      }
    ]
  }
];

try {
    localStorage.setItem("__MU_MARWADI_QB_DATA_V7__", JSON.stringify(window.questionData));
    console.log("MU QB: " + window.questionData.length + " question record(s) stored.");
} catch (error) {
    console.error("MU QB data storage failed:", error);
    alert("Could not store question data: " + (error.message || error));
}
