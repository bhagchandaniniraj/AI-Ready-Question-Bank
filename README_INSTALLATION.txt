MARWADI UNIVERSITY QUESTION BANK — AUTO RESUME v7

WHAT CHANGED
1. POST-SAVE VERIFICATION IS DISABLED.
   After the university success message is detected and its OK button is
   automatically clicked, the script closes the blank Add New Question form
   and proceeds directly to the next Question ID. It does not reopen the
   saved record, read CKEditor from cache, compare saved values, or perform
   any post-save verification.

2. MOVABLE FLOATING PANEL.
   Drag the green top bar with your mouse to move the compact panel.
   Its position is saved and restored after page refresh.

3. TOP BAR CREDIT.
   The header displays: "Script by Niraj Bhagchandani".

4. DYNAMIC BATCH SIZE.
   The engine processes all N question objects in 01_QUESTION_DATA.js.

FILES
- 01_QUESTION_DATA.js: contains the same 10 existing question records.
- 02_AUTOMATION_ENGINE.user.js: Tampermonkey userscript.
- README_INSTALLATION.txt: these instructions.

INSTALLATION
1. Disable/remove the previous v6 Tampermonkey script. Do not run two versions.
2. Open the logged-in university ManageQuestionBank.aspx page.
3. Run 01_QUESTION_DATA.js once in DevTools > Sources > Snippets.
4. Open Tampermonkey > Dashboard and create/replace the userscript.
5. Paste 02_AUTOMATION_ENGINE.user.js and save (Ctrl+S).
6. Reload the Question Bank page.
7. Click Start / Resume once.
8. Move the panel by dragging its green header.

IMPORTANT
- This version intentionally skips all post-save verification, as requested.
- The batch advances when the university success popup is detected/handled.
  This means the progress counter reflects success confirmations received,
  not an independent read-back from the server.
- The script still checks the Question ID before filling and before clicking
  Update, and still checks for visible form validation errors before saving.
- It only updates existing question IDs in the data array.
- Marks, Difficulty, Module, Topics, Course Outcome, Bloom's Taxonomy and
  Answer Reference Media remain untouched.
- If the browser reloads, progress resumes from localStorage.
- JavaScript syntax and ZIP integrity checks are run when packaging. The script
  is not executed against the live university account by this package build.
