// ==UserScript==
// @name         Marwadi University Question Bank — Auto Resume Updater
// @namespace    MU-QuestionBank-Automation
// @version      8.4.3
// @description  JSON-driven updater; appends alternate acceptable answers to the same Expected Answer CKEditor field; retains auto-resume, rubric and popup recovery.
// @match        https://academic.marwadiuniversity.ac.in:553/ManageQuestionBank.aspx*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(function MUQuestionBankAutoResume() {
    "use strict";

    const W = (typeof unsafeWindow !== "undefined") ? unsafeWindow : window;
    const D = W.document;

    const DATA_KEY = "__MU_MARWADI_QB_DATA_V7__";
    const STATE_KEY = "__MU_MARWADI_QB_STATE_V7__";
    const HOST_ID = "__muQuestionBankAutoResumePanelV7";
    const POSITION_KEY = "__MU_MARWADI_QB_PANEL_POSITION_V7__";

    // These IDs were read from the ManageQuestionBank.aspx page source supplied
    // for this update. The grid uses DevExpress paging (100 rows per page).
    const IDS = {
        grid: "ctl00_ContentPlaceHolder1_grdQuestionBank",
        modal: "AddQuestion",
        cancelButton: "ctl00_ContentPlaceHolder1_btnCancel",
        hiddenQuestionId: "ctl00_ContentPlaceHolder1_HFQuestionBankID",
        questionEditor: "ctl00_ContentPlaceHolder1_ckQuestion",
        answerEditor: "ctl00_ContentPlaceHolder1_ckAnswer",
        marks: "ctl00_ContentPlaceHolder1_drpQuestionMarks",
        difficulty: "ctl00_ContentPlaceHolder1_cmbQueLevel",
        module: "ctl00_ContentPlaceHolder1_cmbSyllabusModule",
        topics: "ctl00_ContentPlaceHolder1_lstSyllabusTopic",
        courseOutcome: "ctl00_ContentPlaceHolder1_drpCO",
        bloomsTaxonomy: "ctl00_ContentPlaceHolder1_drpBloomsTaxonomy",
        rubricTable: "tblRubrics",
        addRubric: "ctl00_ContentPlaceHolder1_btnAddRubricRow",
        saveButton: "ctl00_ContentPlaceHolder1_btnSave"
    };

    const SUCCESS_TEXT = /record\s+update\s+successfully|record\s+updated\s+successfully|question\s+updated\s+successfully|update\s+successful|successfully\s+updated|saved\s+successfully/i;
    const QUESTION_PAPER_LOCK_TEXT = /question[\s\S]{0,80}already[\s\S]{0,80}asked[\s\S]{0,80}question\s+paper[\s\S]{0,100}(?:can\s*not|cannot|can't)[\s\S]{0,30}edit/i;

    // Recovery is deliberately bounded. A failed question is retried from the
    // beginning of that same question; completed question IDs are never replayed.
    const RECOVERY = Object.freeze({
        maxRetriesPerQuestion: 5,
        // For the known drpQuestionMarks server error, a 1-mark MCQ gets
        // three total opening attempts (initial attempt + two retries).
        oneMarkDropdownMaxAttempts: 3,
        oneMarkDropdownRetryDelaysMs: [5000, 10000],
        oneMarkDropdownSkipRefreshDelayMs: 1500,
        baseDelayMs: 5000,
        maxDelayMs: 60000,
        postbackTimeoutMs: 60000,
        elementTimeoutMs: 45000,
        openFormTimeoutMs: 60000,
        successTimeoutMs: 90000,
        popupCloseTimeoutMs: 20000,
        // If the university has already displayed its success confirmation but
        // the OK dialog refuses to close, wait 10 seconds and reload into the
        // saved "advance" stage. The successful save is NOT submitted again.
        successPopupStuckRefreshDelayMs: 10000,
        successPopupStuckMaxRefreshes: 2
    });

    const sleep = ms => new Promise(resolve => W.setTimeout(resolve, ms));
    const byId = id => D.getElementById(id);

    let ui = null;
    let localBusy = false;
    let successObserver = null;
    let recoveryTimer = null;
    let popupClickBusy = false;
    let popupClickAttempts = 0;
    let rubricDeleteInProgress = false;

    function readState() {
        try {
            const raw = W.localStorage.getItem(STATE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.error("[MU QB] Could not read progress:", error);
            return null;
        }
    }

    function writeState(state) {
        state.updatedAt = new Date().toISOString();
        W.localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function setStatus(message) {
        const state = readState();
        if (ui?.status) {
            ui.status.textContent = message;
            const isError = state?.stage === "error" ||
                /^\s*(STOPPED|ERROR|CANNOT|FAILED)/i.test(String(message || ""));
            ui.status.classList.toggle("error", !!isError);
            if (ui.copyError) ui.copyError.hidden = !isError;
        }
        if (state) {
            state.status = message;
            writeState(state);
        }
        updateSkipButton();
    }

    function setProgress(index, total) {
        if (ui?.bar) ui.bar.style.width = total ? (Math.round(index / total * 100) + "%") : "0%";
        if (ui?.count) ui.count.textContent = total ? (index + " / " + total) : "0 / 0";
    }

    function updateSkipButton() {
        if (!ui?.skip) return;
        const state = readState();
        // Any error that pauses on a concrete current Question ID can be
        // manually skipped. Batch/data errors without a current ID remain
        // non-skippable so the user cannot accidentally skip an unknown row.
        const canSkip = !!state && !state.running && state.stage === "error" &&
            !!String(state.currentQuestionId || "").trim() &&
            Number.isInteger(Number(state.index)) && state.index >= 0;
        ui.skip.hidden = !canSkip;
        ui.skip.disabled = !canSkip;
    }

    function setPanelRunning(running) {
        if (!ui) return;
        ui.start.disabled = !!running;
        ui.stop.disabled = !running;
        if (ui.skip) ui.skip.disabled = !!running;
        updateSkipButton();
    }

    function isMarksDropdownMismatch(message) {
        const text = String(message || "");
        return /drpQuestionMarks/i.test(text) &&
            /SelectedValue/i.test(text) &&
            /(does not exist in the list of items|invalid)/i.test(text);
    }

    function isPermanentFailure(message) {
        const text = String(message || "");
        return isMarksDropdownMismatch(text) || [
            /question data is not stored/i,
            /question data must be a non-empty array/i,
            /question item \d+ is not an object/i,
            /has no questionid/i,
            /duplicate question id/i,
            /has no question text/i,
            /has no answer text/i,
            /has no rubric rows/i,
            /rubric row \d+ is incomplete or has invalid marks/i,
            /validation message before update/i,
            /validation|field is required|required field|invalid input|invalid marks|duplicate record/i,
            /safety (?:check|stop).*failed/i,
            /refusing to edit the wrong record/i,
            /different existing question is already open/i,
            /DATA\/PORTAL FIELD ERROR/i,
            /unknown automation stage/i,
            /progress belongs to a different batch|question batch does not match|cannot safely match legacy progress/i,
            /unauthorized|access denied|permission denied/i
        ].some(pattern => pattern.test(text));
    }

    function isRetryableServerFailure(message) {
        const text = String(message || "");
        return [
            /did not finish after \d+ seconds.*server\/page may be busy or unresponsive/i,
            /PageRequestManagerServerErrorException/i,
            /HTTP\s*(?:500|502|503|504)\b/i,
            /internal server error|service unavailable|bad gateway|gateway timeout/i,
            /failed to fetch|networkerror|connection (?:reset|closed|refused)|ERR_(?:CONNECTION|NETWORK|TIMED_OUT)/i,
            /request timed out|server response timed out|server is not responding/i,
            /timed out waiting for (?:Question Bank grid page|Edit form for Question ID|new rubric row for Question ID|existing rubric row removal for Question ID|module and topic options after module change|success popup and automatic OK click for Question ID)/i
        ].some(pattern => pattern.test(text));
    }

    function isQuestionPaperLockedMessage(message) {
        const text = String(message || "").replace(/\s+/g, " ").trim();
        return QUESTION_PAPER_LOCK_TEXT.test(text) ||
            /question.*already.*asked.*question paper.*(?:cannot|can\s*not|can't).*edit/i.test(text);
    }

    // The portal blocks prompt/metadata edits once a question has appeared in a
    // question paper. In that case, retry the same record in answer+rubric-only
    // mode. If the portal rejects that restricted retry too, pause safely.
    function markQuestionPaperLocked(state, message, source) {
        if (!state || !state.running) return false;
        const questionId = String(state.currentQuestionId || "").trim();
        if (!questionId) return false;

        const reason = String(message || "The question has already been asked in a question paper.");
        const alreadyRestricted = String(state.restrictedModeQuestionId || "") === questionId;
        const restrictedSaveInProgress = alreadyRestricted && state.stage === "saving" &&
            state.saveMode === "answers_rubrics";

        if (restrictedSaveInProgress) {
            state.running = false;
            state.stage = "error";
            state.resumeStage = "restricted_prepare";
            state.recoveryPending = false;
            state.lastPageAlert = null;
            state.lastError = "The portal repeated its question-paper edit restriction during the answer/rubric-only retry: " + reason;
            state.status = "ERROR: Question ID " + questionId +
                " was also rejected when only Expected Answer and Rubrics were being updated." +
                "\nNo further automatic save was attempted. Check whether the portal permits answer/rubric edits for this record." +
                "\nIf you want the batch to continue without changing this question, click Skip this ID and continue.";
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
            return true;
        }

        if (!Array.isArray(state.restrictedQuestionIds)) state.restrictedQuestionIds = [];
        if (!state.restrictedQuestionIds.includes(questionId)) {
            state.restrictedQuestionIds.push(questionId);
        }
        state.restrictedModeQuestionId = questionId;
        state.stage = "restricted_prepare";
        state.resumeStage = "restricted_prepare";
        state.successPopupHandled = false;
        state.recoveryPending = false;
        state.lastPageAlert = null;
        state.lastError = null;
        state.status = "QUESTION-PAPER LOCK DETECTED: Question ID " + questionId +
            " cannot have its prompt or metadata edited. Re-opening it and updating Expected Answer + Rubrics only.";
        writeState(state);
        setStatus(state.status);
        console.warn("[MU QB] Question-paper lock detected; switching this ID to answer/rubric-only mode:", {
            questionId, source: source || "unknown", message: reason
        });
        return true;
    }

    function isRestrictedQuestion(item, state = readState()) {
        return !!state && String(state.restrictedModeQuestionId || "") === String(item?.questionId || "");
    }

    function addSkippedLogEntry(state, entry) {
        if (!Array.isArray(state.skippedIds)) state.skippedIds = [];
        if (!Array.isArray(state.skippedLog)) state.skippedLog = [];

        const questionId = String(entry.questionId);
        if (!state.skippedIds.includes(questionId)) state.skippedIds.push(questionId);

        // Keep one canonical log entry per skipped question ID.
        const existing = state.skippedLog.findIndex(row => String(row.questionId) === questionId);
        const normalized = {
            questionId,
            marks: entry.marks == null ? null : Number(entry.marks),
            reason: String(entry.reason || "Skipped"),
            attempts: Number(entry.attempts || 0),
            error: String(entry.error || ""),
            skippedAt: entry.skippedAt || new Date().toISOString()
        };
        if (existing >= 0) state.skippedLog[existing] = normalized;
        else state.skippedLog.push(normalized);
    }

    function reloadForResume(delayMs, questionId, statusMessage) {
        if (recoveryTimer) W.clearTimeout(recoveryTimer);
        recoveryTimer = W.setTimeout(() => {
            const latest = readState();
            if (!latest?.running || !latest.recoveryPending) return;
            latest.status = statusMessage || ("Refreshing the page and resuming Question ID " +
                (latest.currentQuestionId || questionId || "the next question") + "...");
            writeState(latest);
            try {
                W.location.reload();
            } catch (reloadError) {
                latest.running = false;
                latest.stage = "error";
                latest.recoveryPending = false;
                latest.lastError = String(reloadError?.stack || reloadError);
                latest.status = "ERROR: Automatic page refresh failed. " +
                    (reloadError?.message || reloadError);
                writeState(latest);
                setStatus(latest.status);
                setPanelRunning(false);
            }
        }, delayMs);
    }

    function scheduleRecovery(error) {
        const state = readState();
        if (!state || !state.running) return false;
        if (state.recoveryPending) return true;

        let batch = [];
        try { batch = readBatch(); } catch (_) {}
        const item = batch[state.index];
        const questionId = String(state.currentQuestionId || item?.questionId || "").trim();
        if (questionId) state.currentQuestionId = questionId;

        const shortError = String(error?.message || error || "Unknown automation error");
        const detail = String(error?.stack || shortError);
        const combinedError = shortError + " " + String(state.lastPageAlert || "");

        // A success popup has already been positively detected (stage="advance",
        // successPopupHandled=true), so a timeout waiting for its OK dialog to
        // disappear is a UI-dismissal problem, NOT a failed save. Preserve the
        // advance stage, wait 10 seconds, reload, and continue with the NEXT ID.
        // Never return to "prepare" or "restricted_prepare" here: that could
        // submit the already-confirmed question a second time.
        const successPopupCloseTimedOut =
            state.stage === "advance" && state.successPopupHandled === true &&
            /timed out waiting for success popup to close after automatic ok click/i.test(shortError);

        if (successPopupCloseTimedOut) {
            const refreshAttempts = Number(state.successPopupRecoveryRefreshCount || 0);
            if (refreshAttempts >= RECOVERY.successPopupStuckMaxRefreshes) {
                state.running = false;
                state.stage = "error";
                state.resumeStage = "advance";
                state.recoveryPending = false;
                state.lastError = detail;
                state.status = "SAFE PAUSE: The success confirmation was detected for Question ID " +
                    questionId + ", but the popup remained open after " + refreshAttempts +
                    " automatic page refresh attempts." +
                    "\nThe save will not be repeated. Progress is preserved at the confirmed-success stage." +
                    "\nClose the portal dialog manually, then press Start / Resume. You may also use Skip this ID if necessary." +
                    "\nSuccessfully updated: " + processed + " | Skipped: " + ((state.skippedIds || []).length);
                writeState(state);
                setStatus(state.status);
                setPanelRunning(false);
                console.error("[MU QB] Success popup remained stuck after automatic refresh attempts:", error);
                return true;
            }

            state.successPopupRecoveryRefreshCount = refreshAttempts + 1;
            state.running = true;
            state.stage = "advance";
            state.resumeStage = "advance";
            state.successPopupHandled = true;
            state.recoveryPending = true;
            state.lastError = detail;
            state.lastPageAlert = null;
            state.resumeNotice = "The success confirmation for Question ID " + questionId +
                " was already received. The popup did not close; continuing to the next question without resubmitting this ID.";
            state.status = "SUCCESS CONFIRMED — POPUP DID NOT CLOSE: Question ID " + questionId +
                " was confirmed by the portal." +
                "\nWaiting 10 seconds, then automatically refreshing and continuing from the next question." +
                "\nThe current question will NOT be submitted again." +
                "\nAutomatic popup recovery refresh " + state.successPopupRecoveryRefreshCount + "/" +
                RECOVERY.successPopupStuckMaxRefreshes +
                " | Successfully updated: " + processed + " | Skipped: " + ((state.skippedIds || []).length);
            writeState(state);
            setStatus(state.status);
            setProgress(state.index || 0, batch.length || 0);
            setPanelRunning(true);
            reloadForResume(RECOVERY.successPopupStuckRefreshDelayMs, questionId,
                "Success was confirmed for Question ID " + questionId +
                ". Refreshing in 10 seconds and continuing with the next question...");
            console.warn("[MU QB] Confirmed-success popup did not close; scheduled safe advance refresh:", {
                questionId,
                refreshAttempt: state.successPopupRecoveryRefreshCount,
                delayMs: RECOVERY.successPopupStuckRefreshDelayMs
            });
            return true;
        }
        const restrictedForCurrent = String(state.restrictedModeQuestionId || "") === questionId;
        const resumeStage = state.stage === "advance" ? "advance" :
            (restrictedForCurrent ? "restricted_prepare" : "prepare");
        const retryKey = questionId || ("index:" + state.index);
        const processed = Array.isArray(state.completedIds) ? state.completedIds.length : 0;

        // Special handling for the known ASP.NET marks-dropdown exception.
        // A 1-mark question is a valid MCQ: retry opening it three total times,
        // then record it as skipped and continue. Other mark values still pause
        // for manual/administrator review without being silently skipped.
        if (isMarksDropdownMismatch(combinedError)) {
            const blockedItem = batch.find(row => String(row.questionId) === questionId) || item;
            const markValue = blockedItem?.marks;

            if (Number(markValue) === 1) {
                if (state.retryQuestionId !== retryKey) {
                    state.retryQuestionId = retryKey;
                    state.retryCount = 0;
                }

                const attempt = Number(state.retryCount || 0) + 1;
                state.retryCount = attempt;
                state.lastError = detail;
                state.lastPageAlert = null;
                state.stage = resumeStage;
                state.resumeStage = resumeStage;
                state.successPopupHandled = false;
                state.recoveryPending = true;

                if (attempt < RECOVERY.oneMarkDropdownMaxAttempts) {
                    const delay = RECOVERY.oneMarkDropdownRetryDelaysMs[
                        Math.min(attempt - 1, RECOVERY.oneMarkDropdownRetryDelaysMs.length - 1)
                    ];
                    state.status = "ONE-MARK MCQ RETRY: Question ID " + questionId +
                        " encountered the drpQuestionMarks server error. Attempt " + attempt + "/" +
                        RECOVERY.oneMarkDropdownMaxAttempts + " failed; refreshing before the next attempt." +
                        "\nMarks: 1 (valid MCQ)." +
                        "\nSuccessfully updated: " + processed + " | Skipped: " +
                        ((state.skippedIds || []).length) +
                        "\nRetrying in " + Math.ceil(delay / 1000) + " seconds...";
                    writeState(state);
                    setStatus(state.status);
                    setProgress(state.index || 0, batch.length || 0);
                    setPanelRunning(true);
                    reloadForResume(delay, questionId,
                        "Refreshing before attempt " + (attempt + 1) + "/" +
                        RECOVERY.oneMarkDropdownMaxAttempts + " for Question ID " + questionId + "...");
                    console.warn("[MU QB] One-mark dropdown retry scheduled:", {
                        questionId, attempt, maxAttempts: RECOVERY.oneMarkDropdownMaxAttempts, delay
                    });
                    return true;
                }

                // Third failed attempt: record a skip and move the saved cursor
                // forward before refreshing. This prevents re-opening the failed ID.
                addSkippedLogEntry(state, {
                    questionId,
                    marks: 1,
                    reason: "drpQuestionMarks SelectedValue missing from dropdown after 3 attempts",
                    attempts: attempt,
                    error: shortError
                });
                state.index += 1;
                state.currentQuestionId = null;
                state.restrictedModeQuestionId = null;
                state.saveMode = null;
                state.retryQuestionId = null;
                state.retryCount = 0;
                state.running = true;
                state.stage = "prepare";
                state.resumeStage = "prepare";
                state.recoveryPending = true;
                state.successPopupHandled = false;
                state.successPopupAttempts = 0;
                state.lastPageAlert = null;
                state.resumeNotice = "Question ID " + questionId +
                    " was skipped after " + attempt + " failed attempts because the portal's drpQuestionMarks dropdown rejected the valid 1-mark value. Continuing with the next question.";
                state.status = "AUTO-SKIPPED: Question ID " + questionId +
                    " was NOT updated after " + attempt + " failed attempts (1-mark dropdown error)." +
                    "\nRefreshing and continuing with the next question..." +
                    "\nSuccessfully updated: " + processed + " | Skipped: " + state.skippedIds.length;
                writeState(state);
                setStatus(state.status);
                setProgress(state.index, batch.length);
                setPanelRunning(true);
                reloadForResume(RECOVERY.oneMarkDropdownSkipRefreshDelayMs, questionId,
                    "Question ID " + questionId + " was logged as skipped. Refreshing and continuing with the next question...");
                console.error("[MU QB] Automatically skipped one-mark question after three failed attempts:", {
                    questionId, marks: 1, attempts: attempt, error: shortError
                });
                return true;
            }
        }

        if (isPermanentFailure(combinedError)) {
            state.running = false;
            state.stage = "error";
            state.resumeStage = resumeStage;
            state.recoveryPending = false;
            state.lastError = detail;
            if (isMarksDropdownMismatch(combinedError)) {
                const blockedItem = batch.find(item => item.questionId === questionId);
                const markValue = blockedItem?.marks;
                const marksHint = markValue === 1
                    ? " The data file correctly specifies 1 mark. A one-mark MCQ is valid; do not increase its marks to bypass this error. The portal dropdown must contain the exact underlying value 1 before the server assigns SelectedValue."
                    : Number.isFinite(markValue)
                        ? " The data file specifies " + markValue + " mark(s). Confirm that this exact underlying value is present in the portal dropdown before the server assigns SelectedValue."
                        : " Confirm that the stored mark value is present in the portal dropdown before the server assigns SelectedValue.";
                state.status = "PORTAL CONFIGURATION ERROR: Question ID " + (questionId || "unknown") +
                    " is present in the grid, but the server cannot open its edit form because drpQuestionMarks has a SelectedValue that is missing from its dropdown items." +
                    "\nThis is not a missing Question ID or a slow-server timeout." + marksHint +
                    "\nNo automatic refresh/retry was attempted because repeating this request will not repair the server-side dropdown. Ask the portal administrator to bind the Marks list before assigning SelectedValue." +
                    "\nProgress is preserved. Press Start / Resume after the portal-side correction. Alternatively, use Skip this ID and continue only if you intentionally want to leave this question unchanged." +
                    "\nSuccessfully updated: " + processed + " | Skipped: " + ((state.skippedIds || []).length);
            } else {
                state.status = "ERROR: " + shortError +
                    "\nID: " + (questionId || "not set") +
                    " | Processed: " + processed +
                    "\nAutomatic retry was not attempted because this appears to be a data, validation, permission, or safety issue. Correct it and press Start / Resume." +
                    "\nIf you want to leave this question unchanged and continue, click Skip this ID and continue.";
            }
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
            console.error("[MU QB] Manual intervention required:", error);
            return true;
        }

        if (!isRetryableServerFailure(combinedError)) {
            state.running = false;
            state.stage = "error";
            state.resumeStage = resumeStage;
            state.recoveryPending = false;
            state.lastError = detail;
            state.status = "SAFE PAUSE: " + shortError +
                "\nQuestion ID: " + (questionId || "not set") +
                "\nNo automatic refresh was attempted because this was not identified as a server-response failure." +
                "\nCorrect the data or portal-field issue, then press Start / Resume. The same question is preserved." +
                "\nIf you want to leave this question unchanged and continue, click Skip this ID and continue." +
                "\nSuccessfully updated: " + processed + " | Skipped: " + ((state.skippedIds || []).length);
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
            console.warn("[MU QB] Paused without refresh; error was not classified as a server response:", error);
            return true;
        }

        if (state.retryQuestionId !== retryKey) {
            state.retryQuestionId = retryKey;
            state.retryCount = 0;
        }

        const nextAttempt = Number(state.retryCount || 0) + 1;
        if (nextAttempt > RECOVERY.maxRetriesPerQuestion) {
            state.running = false;
            state.stage = "error";
            state.resumeStage = resumeStage;
            state.recoveryPending = false;
            state.lastError = detail;
            state.status = "ERROR: Automatic recovery limit reached for Question ID " +
                (questionId || "unknown") + "." +
                "\nLast issue: " + shortError +
                "\nProcessed: " + processed +
                "\nThe batch is safely paused. Press Start / Resume to try this same question again, or click Skip this ID and continue to leave it unchanged.";
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
            console.error("[MU QB] Automatic retry limit reached:", error);
            return true;
        }

        state.retryCount = nextAttempt;
        state.stage = resumeStage;
        state.resumeStage = resumeStage;
        state.successPopupHandled = resumeStage === "advance"
            ? !!state.successPopupHandled : false;
        state.recoveryPending = true;
        state.lastError = detail;
        state.lastPageAlert = null;

        const delay = Math.min(
            RECOVERY.baseDelayMs * Math.pow(2, nextAttempt - 1),
            RECOVERY.maxDelayMs
        );
        state.status = "TEMPORARY ISSUE: " + shortError +
            "\nQuestion ID: " + (questionId || "not set") +
            " | Processed: " + processed +
            "\nAutomatic recovery " + nextAttempt + "/" + RECOVERY.maxRetriesPerQuestion +
            ". Refreshing and resuming this same question in " +
            Math.ceil(delay / 1000) + " seconds...";
        writeState(state);
        setStatus(state.status);
        setProgress(state.index || 0, batch.length || 0);
        setPanelRunning(true);

        if (recoveryTimer) W.clearTimeout(recoveryTimer);
        recoveryTimer = W.setTimeout(() => {
            const latest = readState();
            if (!latest?.running || !latest.recoveryPending ||
                Number(latest.retryCount) !== nextAttempt) return;

            latest.status = "Refreshing the page and resuming Question ID " +
                (latest.currentQuestionId || questionId || "unknown") + "...";
            writeState(latest);
            try {
                W.location.reload();
            } catch (reloadError) {
                latest.running = false;
                latest.stage = "error";
                latest.recoveryPending = false;
                latest.lastError = String(reloadError?.stack || reloadError);
                latest.status = "ERROR: Automatic page refresh failed. " +
                    (reloadError?.message || reloadError);
                writeState(latest);
                setStatus(latest.status);
                setPanelRunning(false);
            }
        }, delay);

        console.warn("[MU QB] Automatic recovery scheduled:", {
            questionId, attempt: nextAttempt, delay, error: shortError
        });
        return true;
    }

    function readBatch() {
        const raw = W.localStorage.getItem(DATA_KEY);
        if (!raw) {
            throw new Error("Question data is not stored. Run 01_QUESTION_DATA.js once in this tab, then reload.");
        }
        return validateBatch(JSON.parse(raw));
    }

    function hasAnyKey(object, keys) {
        return keys.some(key => Object.prototype.hasOwnProperty.call(object, key));
    }

    function normalizeChoice(raw) {
        if (raw == null || raw === "") return null;
        if (typeof raw === "object" && !Array.isArray(raw)) {
            const value = raw.value ?? raw.id ?? raw.code ?? raw.optionValue ?? "";
            const text = raw.text ?? raw.name ?? raw.label ?? raw.title ?? raw.code ?? "";
            return {
                raw,
                value: String(value).trim(),
                text: String(text).trim(),
                index: raw.index == null && raw.optionIndex == null
                    ? null : Number(raw.index ?? raw.optionIndex)
            };
        }
        const value = String(raw).trim();
        return { raw, value, text: value, index: null };
    }

    function validateBatch(raw) {
        if (!Array.isArray(raw) || !raw.length) {
            throw new Error("Question data must be a non-empty array.");
        }

        const seen = new Set();
        return raw.map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new Error("Question item " + (index + 1) + " is not an object.");
            }

            const questionId = String(item.questionId ?? "").trim();
            const question = item.question ?? item.questionPrompt ?? item.updatedQuestion;
            const answer = item.answer ?? item.expectedAnswer ?? item.solutionKey;
            const rubric = item.rubric ?? item.markingRubric;

            if (!questionId) throw new Error("Question item " + (index + 1) + " has no questionId.");
            if (seen.has(questionId)) throw new Error("Duplicate Question ID: " + questionId);
            seen.add(questionId);

            if (typeof question !== "string" || !question.trim()) {
                throw new Error("Question ID " + questionId + " has no question text.");
            }
            if (typeof answer !== "string" || !answer.trim()) {
                throw new Error("Question ID " + questionId + " has no answer text.");
            }
            if (!Array.isArray(rubric) || !rubric.length) {
                throw new Error("Question ID " + questionId + " has no rubric rows.");
            }

            rubric.forEach((row, rowIndex) => {
                if (!row || !String(row.criterion ?? "").trim() ||
                    !String(row.expectedEvidence ?? "").trim() ||
                    row.marks == null || !Number.isFinite(Number(row.marks)) ||
                    Number(row.marks) < 0) {
                    throw new Error("Question ID " + questionId +
                        ", rubric row " + (rowIndex + 1) + " is incomplete or has invalid marks.");
                }
            });

            const normalizedRubric = rubric.map(row => ({
                criterion: String(row.criterion),
                expectedEvidence: String(row.expectedEvidence),
                marks: Number(row.marks)
            }));

            const marksProvided = Object.prototype.hasOwnProperty.call(item, "marks") &&
                item.marks != null && item.marks !== "";
            const marks = marksProvided ? Number(item.marks) : null;
            if (marks !== null && (!Number.isInteger(marks) || marks < 1)) {
                throw new Error("Question ID " + questionId + " has invalid question-level marks: " + item.marks + ". Marks must be a positive whole number.");
            }
            if (marks !== null) {
                const rubricTotal = normalizedRubric.reduce((sum, row) => sum + row.marks, 0);
                if (Math.abs(rubricTotal - marks) > 0.000001) {
                    throw new Error("Question ID " + questionId + " has question marks " + marks +
                        " but its rubric totals " + rubricTotal + ". Correct the data before running the batch.");
                }
            }

            const moduleRaw = item.module ?? item.moduleName ?? item.moduleId ?? null;
            const moduleProvided = hasAnyKey(item, ["module", "moduleName", "moduleId"]) &&
                moduleRaw != null && moduleRaw !== "";
            const topicsRaw = item.topics ?? item.topicNames ?? item.topicIds ?? item.topic ?? null;
            const topicsProvided = hasAnyKey(item, ["topics", "topicNames", "topicIds", "topic"]) &&
                topicsRaw != null && topicsRaw !== "";
            if (topicsProvided && topicsRaw != null &&
                typeof topicsRaw !== "string" && !Array.isArray(topicsRaw)) {
                throw new Error("DATA/PORTAL FIELD ERROR: Question ID " + questionId +
                    " has topics in an unsupported format. Use an array of topic names/IDs or a legacy string.");
            }
            if (Array.isArray(topicsRaw) && topicsRaw.some(topic =>
                topic == null || (typeof topic !== "string" && typeof topic !== "number" &&
                (typeof topic !== "object" || Array.isArray(topic))))) {
                throw new Error("DATA/PORTAL FIELD ERROR: Question ID " + questionId +
                    " has an invalid topic item. Use strings, numeric IDs, or {value,text} objects.");
            }

            const difficultyRaw = item.difficulty ?? item.questionLevel ?? null;
            const coRaw = item.courseOutcome ?? item.co ?? item.courseOutcomeId ?? null;
            const bloomRaw = item.bloomsTaxonomy ?? item.bloomTaxonomy ?? item.bloom ?? null;
            const questionTypeRaw = item.questionType ?? item.type ?? null;
            const alternateRaw = item.alternateAnswers ?? item.alternativeAnswers ?? null;

            return {
                questionId,
                question,
                answer,
                rubric: normalizedRubric,
                marks,
                marksProvided,
                difficulty: normalizeChoice(difficultyRaw),
                difficultyProvided: hasAnyKey(item, ["difficulty", "questionLevel"]) &&
                    difficultyRaw != null && difficultyRaw !== "",
                module: normalizeChoice(moduleRaw),
                moduleProvided,
                topics: topicsRaw,
                topicsProvided,
                topicsLegacyString: typeof topicsRaw === "string",
                courseOutcome: normalizeChoice(coRaw),
                courseOutcomeProvided: hasAnyKey(item, ["courseOutcome", "co", "courseOutcomeId"]) &&
                    coRaw != null && coRaw !== "",
                bloomsTaxonomy: normalizeChoice(bloomRaw),
                bloomsProvided: hasAnyKey(item, ["bloomsTaxonomy", "bloomTaxonomy", "bloom"]) &&
                    bloomRaw != null && bloomRaw !== "",
                questionType: normalizeChoice(questionTypeRaw),
                questionTypeProvided: hasAnyKey(item, ["questionType", "type"]) &&
                    questionTypeRaw != null && questionTypeRaw !== "",
                alternateAnswers: alternateRaw == null ? [] :
                    (Array.isArray(alternateRaw) ? alternateRaw.map(String) : [String(alternateRaw)]),
                alternateAnswersProvided: hasAnyKey(item, ["alternateAnswers", "alternativeAnswers"]) &&
                    alternateRaw != null,
                answerReferenceMediaProvided: hasAnyKey(item, ["answerReferenceMedia", "referenceMedia"]) &&
                    (item.answerReferenceMedia ?? item.referenceMedia) != null
            };
        });
    }

    function hashBatchPayload(signaturePayload, batchLength) {
        const serialized = JSON.stringify(signaturePayload);
        let hash = 2166136261;
        for (let index = 0; index < serialized.length; index++) {
            hash ^= serialized.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return batchLength + ":" + (hash >>> 0).toString(16);
    }

    function getLegacyBatchSignature(batch) {
        return hashBatchPayload(batch.map(item => ({
            questionId: item.questionId,
            question: item.question,
            answer: item.answer,
            rubric: item.rubric
        })), batch.length);
    }

    function getBatchSignature(batch) {
        const signaturePayload = batch.map(item => ({
            questionId: item.questionId,
            question: item.question,
            answer: item.answer,
            rubric: item.rubric,
            marks: item.marks,
            marksProvided: item.marksProvided,
            difficulty: item.difficulty,
            difficultyProvided: item.difficultyProvided,
            module: item.module,
            moduleProvided: item.moduleProvided,
            topics: item.topics,
            topicsProvided: item.topicsProvided,
            courseOutcome: item.courseOutcome,
            courseOutcomeProvided: item.courseOutcomeProvided,
            bloomsTaxonomy: item.bloomsTaxonomy,
            bloomsProvided: item.bloomsProvided,
            questionType: item.questionType,
            questionTypeProvided: item.questionTypeProvided,
            alternateAnswers: item.alternateAnswers,
            alternateAnswersProvided: item.alternateAnswersProvided,
            answerReferenceMediaProvided: item.answerReferenceMediaProvided
        }));
        return hashBatchPayload(signaturePayload, batch.length);
    }

    function assertBatchMatchesState(state, batch) {
        const signature = getBatchSignature(batch);
        const validIds = new Set(batch.map(item => String(item.questionId)));
        const completed = Array.isArray(state.completedIds)
            ? state.completedIds.map(String) : [];
        const skipped = Array.isArray(state.skippedIds)
            ? state.skippedIds.map(String) : [];
        const processed = [...completed, ...skipped];
        const processedSet = new Set(processed);
        const index = Number(state.index || 0);

        if (!Number.isInteger(index) || index < 0 || index > batch.length) {
            throw new Error("Stored progress belongs to a different batch or has an invalid question index. Load the correct question-data file or press Reset for a new batch.");
        }

        if (state.batchSignature && state.batchSignature !== signature) {
            if (state.batchSignature === getLegacyBatchSignature(batch)) {
                state.batchSignature = signature;
                writeState(state);
            } else {
                throw new Error("The loaded question-data file does not match the saved progress. Restore the original batch to resume, or press Reset to start this batch from the beginning.");
            }
        }

        if (processed.some(id => !validIds.has(id)) ||
            (state.currentQuestionId && !validIds.has(String(state.currentQuestionId)))) {
            throw new Error("Stored progress belongs to a different batch. The saved question IDs are not present in the loaded data file. Restore the correct data file or press Reset for a new batch.");
        }

        if (processedSet.size !== processed.length || processed.length !== index ||
            batch.slice(0, index).some(item => !processedSet.has(item.questionId)) ||
            batch.slice(index).some(item => processedSet.has(item.questionId))) {
            throw new Error("Saved progress does not match the completed/skipped question sequence. The batch has been paused to prevent a question from being repeated or silently omitted. Restore the matching data file or press Reset for a new batch.");
        }

        if (!Array.isArray(state.skippedIds)) state.skippedIds = [];

        if (!state.batchSignature) {
            state.batchSignature = signature;
            writeState(state);
        }
    }

    // Handle native alerts. Known success alerts are consumed automatically.
    // Transient alerts are suppressed and trigger refresh/recovery so a blocked
    // native dialog cannot leave the batch waiting indefinitely. Validation,
    // permission and safety alerts remain visible and pause for manual review.
    try {
        const originalAlert = W.alert.bind(W);
        Object.defineProperty(W, "alert", {
            configurable: true,
            writable: true,
            value: function (message) {
                const text = String(message ?? "");
                const state = readState();

                if (state?.running && isQuestionPaperLockedMessage(text)) {
                    markQuestionPaperLocked(state, text, "window.alert");
                    return;
                }

                if (state?.running && state.stage === "saving" && SUCCESS_TEXT.test(text)) {
                    state.stage = "advance";
                    state.successPopupHandled = true;
                    state.status = "Success received for Question ID " +
                        (state.currentQuestionId || "") + ".";
                    state.lastPageAlert = null;
                    writeState(state);
                    console.info("[MU QB] Suppressed success alert:", text);
                    return;
                }

                if (state?.running) {
                    const previousStage = state.stage;
                    state.lastPageAlert = text || "Unexpected page alert.";

                    if (isMarksDropdownMismatch(text)) {
                        writeState(state);
                        scheduleRecovery(new Error("Page alert: " + (text || "Marks dropdown configuration error.")));
                        return;
                    }

                    if (isPermanentFailure(text)) {
                        state.running = false;
                        state.stage = "error";
                        state.resumeStage = previousStage === "advance" ? "advance" : "prepare";
                        state.lastError = "Page alert: " + state.lastPageAlert;
                        state.status = "ERROR: Page validation/safety alert: " +
                            state.lastPageAlert + "\nQuestion ID: " +
                            (state.currentQuestionId || "not set") +
                            " | Processed: " +
                            ((state.completedIds || []).length) +
                            "\nCorrect the issue, then press Start / Resume.";
                        writeState(state);
                        setPanelRunning(false);
                        return originalAlert(message);
                    }

                    writeState(state);
                    scheduleRecovery(new Error("Page alert: " + (text || "Unexpected page alert.")));
                    return;
                }

                return originalAlert(message);
            }
        });
    } catch (error) {
        console.warn("[MU QB] Could not wrap window.alert:", error);
    }

    // Auto-confirm only a confirmation raised synchronously by a rubric-row
    // remove action. All other page confirmations remain under the user's control.
    try {
        const originalConfirm = W.confirm.bind(W);
        Object.defineProperty(W, "confirm", {
            configurable: true,
            writable: true,
            value: function (message) {
                const state = readState();
                if (state?.running && isQuestionPaperLockedMessage(message)) {
                    markQuestionPaperLocked(state, message, "window.confirm");
                    return false;
                }
                if (rubricDeleteInProgress && state?.running) {
                    console.info("[MU QB] Auto-confirmed rubric-row removal:", String(message || ""));
                    return true;
                }
                return originalConfirm(message);
            }
        });
    } catch (error) {
        console.warn("[MU QB] Could not wrap window.confirm for rubric cleanup:", error);
    }

    // The supplied page loads SweetAlert. Its success popup is HTML, not
    // window.alert(). Detect that popup and click only its OK/Confirm button.
    function isVisible(element) {
        if (!element) return false;
        const style = W.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            rect.width > 0 && rect.height > 0;
    }

    function getSuccessPopup() {
        const buttonNodes = Array.from(D.querySelectorAll(
            "button, input[type='button'], input[type='submit'], a"
        ));

        for (const button of buttonNodes) {
            if (!isVisible(button) || button.disabled) continue;
            const label = String(
                button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || button.title || ""
            ).replace(/\s+/g, " ").trim();
            if (!/^(ok|okay|confirm|yes)$/i.test(label)) continue;

            let container = button.parentElement;
            for (let depth = 0; container && container !== D.body && container !== D.documentElement && depth < 8; depth++, container = container.parentElement) {
                if (!isVisible(container)) continue;
                const text = String(container.innerText || container.textContent || "")
                    .replace(/\s+/g, " ").trim();
                if (SUCCESS_TEXT.test(text)) return { popup: container, button, text };
            }
        }

        const candidates = D.querySelectorAll(
            ".sweet-alert, .swal-modal, .swal2-popup, .swal2-container, .swal-overlay, [role='dialog'], .modal"
        );
        for (const popup of candidates) {
            if (!isVisible(popup)) continue;
            const text = String(popup.innerText || popup.textContent || "")
                .replace(/\s+/g, " ").trim();
            if (!SUCCESS_TEXT.test(text)) continue;
            const ok = Array.from(popup.querySelectorAll(
                "button, input[type='button'], input[type='submit']"
            )).find(button => {
                const label = String(button.innerText || button.textContent || button.value || button.getAttribute("aria-label") || button.title || "")
                    .replace(/\s+/g, " ").trim();
                return /^(ok|okay|confirm|yes)$/i.test(label) && !button.disabled;
            });
            if (ok) return { popup, button: ok, text };
        }
        return null;
    }
    function getQuestionPaperLockNotice(state = readState()) {
        // IMPORTANT:
        // Once a question is known to be locked, the portal keeps the red
        // "already asked in question paper" text in the AddQuestion form title.
        // That title is informational and remains visible while Expected Answer
        // and Rubrics are edited. It must NOT be treated as a second rejection.
        // Genuine server-side validation/alert elements are still inspected.
        const questionId = String(state?.currentQuestionId || "").trim();
        const alreadyRestricted = !!questionId &&
            String(state?.restrictedModeQuestionId || "") === questionId;

        const selectors = [
            // Actual validation/alert elements inside the form remain actionable.
            "#AddQuestion .validation-summary-errors",
            "#AddQuestion .field-validation-error",
            "#AddQuestion .alert",
            "#AddQuestion [role='alert']",
            // Portal-generated alert/dialog containers outside the form.
            ".sweet-alert", ".swal-modal", ".swal2-popup", ".swal2-container",
            ".bootbox", ".toast", ".alert", "[role='alert']",
            "[role='alertdialog']", "[role='dialog']"
        ];

        // Inspect the form title/header only on the first, full-edit attempt.
        // After lock detection, this same title is a persistent banner and is
        // deliberately ignored during the answer/rubric-only retry.
        if (!alreadyRestricted) {
            selectors.push(
                "#AddQuestion .modal-title",
                "#AddQuestion .modal-header",
                "#AddQuestion h1", "#AddQuestion h2", "#AddQuestion h3",
                "#AddQuestion h4", "#AddQuestion h5", "#AddQuestion h6"
            );
        }

        const seen = new Set();
        for (const selector of selectors) {
            for (const element of D.querySelectorAll(selector)) {
                if (seen.has(element) || !isVisible(element)) continue;
                seen.add(element);
                const text = String(element.innerText || element.textContent || "")
                    .replace(/\s+/g, " ").trim();
                if (!isQuestionPaperLockedMessage(text)) continue;

                // Defensive filter for the persistent title/banner in an
                // already-restricted record. Do not suppress real validation
                // summaries or alert elements; those were checked above.
                if (alreadyRestricted && element.closest("#AddQuestion") &&
                    !element.matches(
                        ".validation-summary-errors, .field-validation-error, .alert, [role='alert']"
                    )) {
                    continue;
                }
                return { element, text };
            }
        }
        return null;
    }

    function handleQuestionPaperLockNotice() {
        const state = readState();
        if (!state?.running || !state.currentQuestionId) return false;
        if (!["prepare", "saving", "restricted_prepare"].includes(state.stage)) return false;

        // A known lock banner is expected to remain visible during the restricted
        // retry. getQuestionPaperLockNotice() ignores that persistent title, but
        // continues to detect fresh validation summaries and actual alert dialogs.
        const found = getQuestionPaperLockNotice(state);
        if (!found) return false;

        const handled = markQuestionPaperLocked(state, found.text, "visible portal message");
        if (!handled) return false;

        // If the portal uses an HTML alert instead of window.alert, dismiss only
        // the OK/Close control inside the exact matching notice.
        let container = found.element;
        for (let depth = 0; container && depth < 6; depth++, container = container.parentElement) {
            const button = Array.from(container.querySelectorAll(
                "button, input[type='button'], input[type='submit'], a"
            )).find(node => {
                if (!isVisible(node) || node.disabled) return false;
                const label = String(node.innerText || node.textContent || node.value ||
                    node.getAttribute("aria-label") || node.title || "").replace(/\s+/g, " ").trim();
                return /^(ok|okay|close|got it)$/i.test(label);
            });
            if (button) {
                try { button.click(); } catch (error) {
                    console.warn("[MU QB] Could not dismiss question-paper lock notice:", error);
                }
                break;
            }
        }
        return true;
    }

    function handleSuccessPopup() {
        const state = readState();
        if (!state?.running || !["saving", "advance"].includes(state.stage)) return;
        if (popupClickBusy) return;

        const found = getSuccessPopup();
        if (!found) return;

        if (state.stage === "saving") {
            state.stage = "advance";
            state.successPopupHandled = true;
            state.status = "Success popup detected. Automatically clicking OK for Question ID " +
                (state.currentQuestionId || "") + "...";
        }

        popupClickAttempts += 1;
        state.successPopupAttempts = popupClickAttempts;
        writeState(state);
        setStatus(state.status || "Automatically closing the success confirmation...");
        popupClickBusy = true;

        W.setTimeout(() => {
            try {
                if (found.button && found.button.isConnected && isVisible(found.button) &&
                    !found.button.disabled) {
                    found.button.click();
                }
            } catch (error) {
                console.error("[MU QB] Could not auto-click success OK:", error);
            }

            W.setTimeout(() => {
                popupClickBusy = false;
                const latest = readState();
                if (!getSuccessPopup()) return;

                if (latest?.running && latest.stage === "advance") {
                    if (popupClickAttempts >= 5) {
                        scheduleRecovery(new Error(
                            "The success confirmation popup did not close after 5 automatic OK-click attempts."
                        ));
                    } else {
                        handleSuccessPopup();
                    }
                }
            }, 1200);
        }, 350);
    }

    function installSuccessPopupObserver() {
        if (successObserver || !D.documentElement) return;
        successObserver = new W.MutationObserver(() => {
            handleQuestionPaperLockNotice();
            handleSuccessPopup();
        });
        successObserver.observe(D.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "aria-hidden"]
        });
        // Also check in case a notice/popup was added before the observer.
        handleQuestionPaperLockNotice();
        handleSuccessPopup();
    }

    function waitFor(getter, label, timeout = RECOVERY.elementTimeoutMs, allowPaused = false) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = () => {
                let result;
                try { result = getter(); } catch (_) {}
                if (result) return resolve(result);

                const state = readState();
                if (!state?.running && !allowPaused) {
                    return reject(new Error("Batch stopped while waiting for " + label + "."));
                }
                if (Date.now() - started > timeout) {
                    return reject(new Error("Timed out waiting for " + label + "."));
                }
                W.setTimeout(poll, 250);
            };
            poll();
        });
    }

    function modalElement() {
        return byId(IDS.modal);
    }

    function modalIsVisible() {
        const modal = modalElement();
        if (!modal) return false;

        const style = W.getComputedStyle(modal);
        const rect = modal.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden" ||
            rect.width === 0 || rect.height === 0) return false;

        // Bootstrap 3 on this page uses the "in" class when the modal is open.
        // "show" is also accepted for newer Bootstrap markup.
        if (modal.classList.contains("in") || modal.classList.contains("show") ||
            modal.getAttribute("aria-hidden") === "false") return true;

        return !!D.querySelector(".modal-backdrop") && isVisible(modal);
    }

    function currentFormQuestionId() {
        return String(byId(IDS.hiddenQuestionId)?.value || "").trim();
    }

    function modalTitleText() {
        const modal = modalElement();
        if (!modal) return "";
        const title = modal.querySelector(
            ".modal-title, .modal-header h1, .modal-header h2, .modal-header h3, .modal-header h4, [data-modal-title]"
        );
        if (title) return String(title.textContent || "").replace(/\s+/g, " ").trim();
        const header = modal.querySelector(".modal-header");
        return String(header?.textContent || "").replace(/\s+/g, " ").trim();
    }

    function isBlankAddQuestionForm() {
        if (!modalIsVisible()) return false;

        const title = modalTitleText();
        if (/add\s+new\s+question/i.test(title)) return true;

        const modal = modalElement();
        const footer = modal?.querySelector(".modal-footer") || modal;
        const labels = Array.from(footer?.querySelectorAll(
            "button, input[type='button'], input[type='submit'], a"
        ) || []).map(node =>
            String(node.innerText || node.textContent || node.value || "")
                .replace(/\s+/g, " ").trim().toUpperCase()
        ).join(" ");

        if (/ADD\s+QUESTION/.test(labels) && !/UPDATE\s+QUESTION/.test(labels)) return true;

        const id = currentFormQuestionId();
        return !id || id === "0";
    }

    function getQuestionRows() {
        const grid = byId(IDS.grid);
        if (!grid) return [];
        return Array.from(grid.querySelectorAll("tr[id*='_DXDataRow']"));
    }

    function findQuestionRow(questionId) {
        const wanted = String(questionId).trim();
        return getQuestionRows().find(row =>
            row.cells && row.cells[1] &&
            String(row.cells[1].textContent || "").trim() === wanted
        ) || null;
    }

    function getPagerInfo() {
        const pager = byId(IDS.grid + "_DXPagerBottom");
        const summary = pager?.querySelector(".dxp-summary");
        const text = String(summary?.textContent || "");
        const match = text.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
        if (!match) return null;
        return {
            current: Number(match[1]) - 1,
            count: Number(match[2])
        };
    }

    function getGridClient() {
        try {
            return W.grdQuestionBank ||
                W.ASPx?.GetControlCollection?.().GetByName("grdQuestionBank") ||
                null;
        } catch (_) {
            return W.grdQuestionBank || null;
        }
    }

    async function goToGridPage(pageIndex) {
        const before = getPagerInfo();
        if (!before || before.current === pageIndex) return;

        const gridClient = getGridClient();
        if (gridClient && typeof gridClient.GotoPage === "function") {
            gridClient.GotoPage(pageIndex);
        } else if (W.ASPx && typeof W.ASPx.GVPagerOnClick === "function") {
            W.ASPx.GVPagerOnClick(IDS.grid, "PN" + pageIndex);
        } else {
            const pager = byId(IDS.grid + "_DXPagerBottom");
            const link = Array.from(pager?.querySelectorAll("a.dxp-num") || [])
                .find(anchor => Number(anchor.textContent.trim()) === pageIndex + 1);
            if (!link) throw new Error("Could not navigate to Question Bank grid page " + (pageIndex + 1) + ".");
            link.click();
        }

        await waitFor(() => {
            const info = getPagerInfo();
            return info && info.current === pageIndex;
        }, "Question Bank grid page " + (pageIndex + 1), RECOVERY.openFormTimeoutMs);
        await sleep(250);
    }

    async function findQuestionRowAcrossPages(questionId) {
        let row = findQuestionRow(questionId);
        if (row) return row;

        const pagerInfo = getPagerInfo();
        if (!pagerInfo || pagerInfo.count < 1) {
            throw new Error("Question ID " + questionId +
                " is not on the current grid page and the grid pager could not be read.");
        }

        const pageOrder = [];
        for (let offset = 1; offset <= pagerInfo.count; offset++) {
            pageOrder.push((pagerInfo.current + offset) % pagerInfo.count);
        }

        for (const pageIndex of pageOrder) {
            await goToGridPage(pageIndex);
            row = findQuestionRow(questionId);
            if (row) return row;
        }

        throw new Error("Question ID " + questionId +
            " was not found in any of the " + pagerInfo.count + " grid pages.");
    }

    function hideAddQuestionModal(allowPaused = false) {
        const modal = modalElement();
        if (!modal || !modalIsVisible()) return Promise.resolve();

        try {
            if (W.jQuery && W.jQuery.fn && typeof W.jQuery.fn.modal === "function") {
                W.jQuery(modal).modal("hide");
            } else {
                const closeLink = modal.querySelector("a.close");
                if (closeLink) closeLink.click();
                else throw new Error("The Add Question modal close control was not found.");
            }
        } catch (error) {
            return Promise.reject(error);
        }

        return waitFor(() => !modalIsVisible(),
            "Add Question form to close", RECOVERY.popupCloseTimeoutMs, allowPaused).then(() => {
                try { if (typeof W.HideModal === "function") W.HideModal(); } catch (_) {}
            });
    }

    async function closeBlankAddQuestionFormIfNeeded(allowPaused = false) {
        if (!modalIsVisible() || !isBlankAddQuestionForm()) return;

        const modal = modalElement();
        const title = modalTitleText() || "Add New Question";
        setStatus("Closing blank form...");

        const footer = modal?.querySelector(".modal-footer") || modal;
        const cancel = byId(IDS.cancelButton) ||
            Array.from(footer?.querySelectorAll(
                "button, input[type='button'], input[type='submit'], a"
            ) || []).find(node => {
                const label = String(node.innerText || node.textContent || node.value || "")
                    .replace(/\s+/g, " ").trim();
                return /^cancel$/i.test(label) && !node.disabled;
            });

        if (cancel) {
            cancel.click();
        } else if (W.jQuery && W.jQuery.fn && typeof W.jQuery.fn.modal === "function") {
            W.jQuery(modal).modal("hide");
        } else {
            const closeLink = modal?.querySelector("a.close, button.close, [data-dismiss='modal']");
            if (closeLink) closeLink.click();
            else throw new Error(
                "Blank Add New Question form is open, but its Cancel/Close button was not found. Visible title: " +
                title + "."
            );
        }

        try {
            await waitFor(() => !modalIsVisible(),
                "blank Add New Question form to close using Cancel", 15000, allowPaused);
        } catch (firstError) {
            if (W.jQuery && W.jQuery.fn && typeof W.jQuery.fn.modal === "function") {
                W.jQuery(modal).modal("hide");
                await waitFor(() => !modalIsVisible(),
                    "blank Add New Question form to close", 15000, allowPaused);
            } else {
                throw new Error(
                    "Could not close the blank Add New Question form. Cancel click did not hide it. " +
                    "Original detail: " + firstError.message
                );
            }
        }
        await sleep(250);
    }

    async function waitForPagePostbackIdle(label = "page postback to finish", allowPaused = false) {
        const prm = W.Sys?.WebForms?.PageRequestManager?.getInstance?.();
        if (!prm || typeof prm.get_isInAsyncPostBack !== "function") return;
        await waitFor(
            () => !prm.get_isInAsyncPostBack(),
            label,
            RECOVERY.postbackTimeoutMs,
            allowPaused
        );
    }

    function runPartialPostback(action, label, timeout = RECOVERY.postbackTimeoutMs) {
        const prm = W.Sys?.WebForms?.PageRequestManager?.getInstance?.();
        if (!prm) {
            action();
            return sleep(1000);
        }

        return new Promise((resolve, reject) => {
            let finished = false;
            let timer;

            const cleanup = () => {
                try { prm.remove_endRequest(onEnd); } catch (_) {}
                W.clearTimeout(timer);
            };

            const onEnd = (sender, args) => {
                if (finished) return;
                finished = true;
                cleanup();
                const error = args?.get_error?.();
                if (error) {
                    try { args?.set_errorHandled?.(true); } catch (_) {}
                    reject(new Error(label + " failed: " +
                        ((error.name ? error.name + ": " : "") + (error.message || error))));
                }
                else resolve();
            };

            prm.add_endRequest(onEnd);
            timer = W.setTimeout(() => {
                if (finished) return;
                finished = true;
                cleanup();
                reject(new Error(label + " did not finish after " + Math.round(timeout / 1000) + " seconds. The server/page may be busy or unresponsive."));
            }, timeout);

            try {
                action();
            } catch (error) {
                if (!finished) {
                    finished = true;
                    cleanup();
                    reject(error);
                }
            }
        });
    }

    async function reopenExistingQuestionForRestrictedRetry(questionId) {
        await waitForPagePostbackIdle("question-paper restriction response to finish");
        if (modalIsVisible()) {
            const openId = currentFormQuestionId();
            if (openId !== questionId) {
                throw new Error("Restricted retry safety stop: expected Question ID " +
                    questionId + ", but a different form is open (" + (openId || "unknown") + ").");
            }
            // Discard unsaved prompt/metadata changes from the first full attempt.
            // Re-opening the record reloads its original prompt before the
            // answer/rubric-only save, preventing the locked prompt being resubmitted.
            await hideAddQuestionModal();
            await sleep(300);
        }
        await openExistingQuestion(questionId);
        if (currentFormQuestionId() !== questionId) {
            throw new Error("Restricted retry could not re-open the correct Question ID " + questionId + ".");
        }
    }

    async function openExistingQuestion(questionId) {
        await closeBlankAddQuestionFormIfNeeded();

        if (modalIsVisible()) {
            if (isBlankAddQuestionForm()) {
                throw new Error("The blank Add New Question form is still open after the Cancel attempt.");
            }
            const openId = currentFormQuestionId();
            if (openId === questionId) return;
            throw new Error("A different existing question is already open (ID " +
                (openId || "unknown") + "). Refusing to edit the wrong record.");
        }

        const row = await findQuestionRowAcrossPages(questionId);
        const editLink = row.querySelector('a[title="Edit Question"]');
        if (!editLink) {
            throw new Error("Edit Question link not found for Question ID " + questionId + ".");
        }

        setStatus("Opening existing Question ID " + questionId + "...");
        await runPartialPostback(() => editLink.click(), "Opening Question ID " + questionId);

        await waitFor(
            () => modalIsVisible() && currentFormQuestionId() === questionId,
            "Edit form for Question ID " + questionId,
            RECOVERY.openFormTimeoutMs
        );

        if (currentFormQuestionId() !== questionId) {
            throw new Error("Safety check failed: edit form ID is not " + questionId + ".");
        }
    }

    function normalizeMatchText(value) {
        return String(value ?? "")
            .normalize("NFKC")
            .replace(/[–—]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function getFormSelect(fieldKey) {
        const selectors = {
            module: ["#" + IDS.module, 'select[name$="$cmbSyllabusModule"]'],
            topics: ["#" + IDS.topics, 'select[multiple][name$="$lstSyllabusTopic"]'],
            difficulty: ["#" + IDS.difficulty, 'select[name$="$cmbQueLevel"]'],
            courseOutcome: ["#" + IDS.courseOutcome, 'select[name$="$drpCO"]'],
            bloomsTaxonomy: ["#" + IDS.bloomsTaxonomy, 'select[name$="$drpBloomsTaxonomy"]']
        };
        const modal = modalElement() || D;
        for (const selector of (selectors[fieldKey] || [])) {
            const element = modal.querySelector(selector);
            if (element) return element;
        }
        return null;
    }

    function getUsableOptions(select) {
        return Array.from(select?.options || []).filter(option =>
            !option.disabled && option.value !== "" &&
            !/^\s*(?:\(none\)|\(select\)|select)\s*$/i.test(option.textContent || "")
        );
    }

    function choiceParts(choice) {
        if (choice && typeof choice === "object" && !Array.isArray(choice)) {
            return {
                value: String(choice.value ?? choice.id ?? choice.code ?? choice.optionValue ?? "").trim(),
                text: String(choice.text ?? choice.name ?? choice.label ?? choice.title ?? choice.code ?? "").trim(),
                index: choice.index == null && choice.optionIndex == null
                    ? null : Number(choice.index ?? choice.optionIndex)
            };
        }
        const value = String(choice ?? "").trim();
        return { value, text: value, index: null };
    }

    function resolveSingleOption(select, choice, fieldLabel) {
        if (!select) {
            throw new Error("DATA/PORTAL FIELD ERROR: The " + fieldLabel +
                " control was not found in the current question form.");
        }

        const parts = choiceParts(choice);
        const options = getUsableOptions(select);
        if (parts.index != null && Number.isInteger(parts.index)) {
            const index = parts.index >= 1 ? parts.index - 1 : parts.index;
            if (options[index]) return options[index];
        }

        let match = options.find(option => option.value === parts.value && parts.value !== "");
        if (match) return match;

        for (const candidate of [parts.text, parts.value].filter(Boolean)) {
            const normalized = normalizeMatchText(candidate);
            match = options.find(option => normalizeMatchText(option.textContent) === normalized);
            if (match) return match;
        }

        const bloomText = parts.text.replace(/[–—]/g, "-");
        if (/^l\d+\s*-\s*/i.test(bloomText)) {
            const stripped = bloomText.replace(/^l\d+\s*-\s*/i, "");
            match = options.find(option =>
                normalizeMatchText(option.textContent) === normalizeMatchText(stripped));
            if (match) return match;
        }

        const coMatch = parts.text.match(/^CO\s*(\d+)$/i) || parts.value.match(/^CO\s*(\d+)$/i);
        if (fieldLabel.toLowerCase().includes("course outcome") && coMatch) {
            const coIndex = Number(coMatch[1]) - 1;
            if (options[coIndex]) return options[coIndex];
        }

        throw new Error("DATA/PORTAL FIELD ERROR: Could not match " + fieldLabel +
            " value \"" + (parts.text || parts.value) +
            "\" to any option currently supplied by the portal. No approximate option was selected.");
    }

    function refreshChosen(select) {
        if (!select || !W.jQuery) return;
        try { W.jQuery(select).trigger("chosen:updated"); } catch (_) {}
    }

    function setSelectOption(select, option, description, triggerChange = true) {
        if (!select || !option) {
            throw new Error("DATA/PORTAL FIELD ERROR: Cannot set " + description +
                " because the control or matching option is missing.");
        }
        select.value = option.value;
        if (triggerChange) {
            select.dispatchEvent(new W.Event("input", { bubbles: true }));
            select.dispatchEvent(new W.Event("change", { bubbles: true }));
        }
        refreshChosen(select);
    }

    async function setModuleFromJson(item) {
        if (!item.moduleProvided) return;

        const select = getFormSelect("module");
        const option = resolveSingleOption(select, item.module, "Module");
        const previousValue = select.value;

        if (previousValue !== option.value) {
            setStatus("Question ID " + item.questionId +
                ": selecting module \"" + option.textContent.trim() +
                "\" and waiting for its topic list...");
            await runPartialPostback(() => {
                const current = getFormSelect("module");
                if (!current) {
                    throw new Error("DATA/PORTAL FIELD ERROR: Module dropdown disappeared before selection.");
                }
                current.value = option.value;
                current.dispatchEvent(new W.Event("change", { bubbles: true }));
                refreshChosen(current);
            }, "Changing module and loading its topics", RECOVERY.openFormTimeoutMs);

            await waitFor(() => {
                const currentModule = getFormSelect("module");
                const currentTopics = getFormSelect("topics");
                return currentModule && currentModule.value === option.value &&
                    currentTopics && currentTopics.options.length > 0;
            }, "module and topic options after module change", RECOVERY.openFormTimeoutMs);

            if (currentFormQuestionId() !== item.questionId) {
                throw new Error("DATA/PORTAL FIELD ERROR: Module selection changed the open form identity. Expected Question ID " +
                    item.questionId + ", found " + (currentFormQuestionId() || "unknown") + ".");
            }
            await sleep(150);
        } else {
            refreshChosen(select);
        }
    }

    function resolveTopicOptions(select, rawTopics, legacyString, questionId) {
        const options = getUsableOptions(select);
        const matchOne = raw => {
            const parts = choiceParts(raw);
            let option = options.find(candidate =>
                parts.value !== "" && candidate.value === parts.value);
            if (option) return option;
            const text = parts.text || parts.value;
            const normalized = normalizeMatchText(text);
            return options.find(candidate =>
                normalizeMatchText(candidate.textContent) === normalized) || null;
        };

        if (rawTopics == null || rawTopics === "") return [];
        let requested;
        if (Array.isArray(rawTopics)) {
            requested = rawTopics;
        } else {
            const wholeMatch = matchOne(rawTopics);
            if (wholeMatch) return [wholeMatch];

            if (legacyString) {
                // Greedy longest-option parsing preserves legacy topic labels
                // that contain commas (for example, "A, B, C") while still
                // recognizing several topics joined with comma separators.
                let remaining = String(rawTopics).trim();
                const parsed = [];
                let parseFailed = false;

                while (remaining) {
                    const candidates = options.map(option => {
                        const label = String(option.textContent || "").trim();
                        const value = String(option.value || "").trim();
                        const matched = [label, value].filter(Boolean)
                            .filter(candidate => {
                                const prefix = remaining.slice(0, candidate.length);
                                const boundary = remaining.slice(candidate.length);
                                return normalizeMatchText(prefix) === normalizeMatchText(candidate) &&
                                    (boundary === "" || /^[;,]\s*/.test(boundary));
                            })
                            .sort((a, b) => b.length - a.length)[0];
                        return matched ? { option, matchedLength: matched.length } : null;
                    }).filter(Boolean).sort((a, b) => b.matchedLength - a.matchedLength);

                    const chosen = candidates[0];
                    if (!chosen) {
                        parseFailed = true;
                        break;
                    }

                    parsed.push(chosen.option);
                    remaining = remaining.slice(chosen.matchedLength).replace(/^[;,]\s*/, "").trim();
                }

                requested = !parseFailed && parsed.length
                    ? parsed
                    : String(rawTopics).split(/[;,]/).map(value => value.trim()).filter(Boolean);
            } else {
                requested = [rawTopics];
            }
        }

        const resolved = [];
        const missing = [];
        for (const topic of requested) {
            const option = matchOne(topic);
            if (option) {
                if (!resolved.some(existing => existing.value === option.value)) resolved.push(option);
            } else {
                missing.push(typeof topic === "object" ? JSON.stringify(topic) : String(topic));
            }
        }

        if (missing.length) {
            throw new Error("DATA/PORTAL FIELD ERROR: Question ID " + questionId +
                " has topic value(s) not available under the selected module: " +
                missing.join(" | ") +
                ". Check the JSON module/topics pair. The script will not select a different topic.");
        }
        return resolved;
    }

    function setTopicsFromJson(item) {
        if (!item.topicsProvided) return;

        const select = getFormSelect("topics");
        if (!select || !select.multiple) {
            throw new Error("DATA/PORTAL FIELD ERROR: The Topics control was not found or is not a multi-select list.");
        }

        const resolved = resolveTopicOptions(
            select, item.topics, item.topicsLegacyString, item.questionId
        );
        const wanted = new Set(resolved.map(option => option.value));

        Array.from(select.options).forEach(option => {
            option.selected = wanted.has(option.value);
        });
        select.dispatchEvent(new W.Event("input", { bubbles: true }));
        select.dispatchEvent(new W.Event("change", { bubbles: true }));
        refreshChosen(select);

        const selectedValues = Array.from(select.selectedOptions).map(option => option.value);
        if (selectedValues.length !== wanted.size ||
            selectedValues.some(value => !wanted.has(value))) {
            throw new Error("DATA/PORTAL FIELD ERROR: Topics could not be selected exactly for Question ID " +
                item.questionId + ".");
        }
    }

    function setMarksFromJson(item) {
        if (!item.marksProvided) return;

        const group = byId(IDS.marks);
        const scope = group || modalElement() || D;
        const radios = Array.from(scope.querySelectorAll(
            'input[type="radio"][name$="$drpQuestionMarks"], input[type="radio"]'
        ));
        const target = Number(item.marks);
        const radio = radios.find(candidate => {
            const label = candidate.id
                ? D.querySelector('label[for="' + candidate.id.replace(/"/g, '\\"') + '"]')
                : null;
            const labelText = String(label?.textContent || "").trim();
            const fromLabel = labelText.match(/\d+(?:\.\d+)?/);
            const fromValue = String(candidate.value || "").match(/^\s*(\d+(?:\.\d+)?)/);
            const numeric = fromLabel ? Number(fromLabel[0]) : (fromValue ? Number(fromValue[1]) : NaN);
            return Number.isFinite(numeric) && Math.abs(numeric - target) < 0.000001;
        });

        if (!radio) {
            throw new Error("DATA/PORTAL FIELD ERROR: Marks option " + target +
                " is not present in the current portal form. The script will not substitute another mark value.");
        }
        radio.click();
        if (!radio.checked) radio.checked = true;
        radio.dispatchEvent(new W.Event("change", { bubbles: true }));
    }

    function setSingleFieldFromJson(fieldKey, choice, fieldLabel) {
        const select = getFormSelect(fieldKey);
        const option = resolveSingleOption(select, choice, fieldLabel);
        setSelectOption(select, option, fieldLabel, true);
    }

    // Difficulty is rendered by some portal versions as a segmented
    // High / Medium / Low radio-button group rather than a normal <select>.
    // Do not assume that the control is always a select. Resolve only an exact
    // label/value match and wait briefly for asynchronous portal binding.
    function findDifficultySelect(modal) {
        const candidates = [];
        const byId = modal.querySelector("#" + IDS.difficulty);
        if (byId && byId.tagName === "SELECT") candidates.push(byId);
        const byName = modal.querySelector('select[name$="$cmbQueLevel"]');
        if (byName && !candidates.includes(byName)) candidates.push(byName);
        const any = Array.from(modal.querySelectorAll("select")).find(select =>
            String(select.id || "").toLowerCase().includes("cmbquelevel") ||
            String(select.name || "").toLowerCase().includes("cmbquelevel")
        );
        if (any && !candidates.includes(any)) candidates.push(any);
        return candidates[0] || null;
    }

    function exactVisibleText(element) {
        if (!element) return "";
        const value = element.getAttribute?.("aria-label") ||
            element.getAttribute?.("title") ||
            element.innerText || element.textContent || element.value || "";
        return normalizeMatchText(value);
    }

    function findDifficultyGroup(modal, wantedText) {
        const labelNodes = Array.from(modal.querySelectorAll(
            "label, span, div, p, strong, b, small"
        )).filter(element => isVisible(element) &&
            normalizeMatchText(element.textContent) === "difficulty");

        for (const label of labelNodes) {
            let ancestor = label;
            for (let depth = 0; ancestor && depth < 8; depth++, ancestor = ancestor.parentElement) {
                const texts = new Set();
                const nodes = ancestor.querySelectorAll(
                    "button, label, [role='radio'], [role='button'], a, .btn, span, div, input[type='radio']"
                );
                for (const node of nodes) {
                    if (!isVisible(node)) continue;
                    const text = exactVisibleText(node);
                    if (["high", "medium", "low"].includes(text)) texts.add(text);
                }
                if (texts.has(wantedText) && texts.size >= 2) return ancestor;
            }
        }
        return null;
    }

    function clickDifficultyChoice(group, wantedText) {
        if (!group) return false;

        // Prefer a real radio input and its associated label when available.
        for (const radio of Array.from(group.querySelectorAll('input[type="radio"]'))) {
            let label = null;
            if (radio.id) {
                try { label = group.querySelector('label[for="' +
                    radio.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]'); }
                catch (_) {}
            }
            if (!label) label = radio.closest("label");
            const labelText = exactVisibleText(label);
            const radioValue = normalizeMatchText(radio.value);
            if (labelText === wantedText || radioValue === wantedText) {
                if (label) label.click();
                else radio.click();
                radio.checked = true;
                radio.dispatchEvent(new W.Event("input", { bubbles: true }));
                radio.dispatchEvent(new W.Event("change", { bubbles: true }));
                return true;
            }
        }

        const interactive = Array.from(group.querySelectorAll(
            "button, [role='radio'], [role='button'], label, a, .btn, [aria-pressed], [data-value]"
        )).filter(element => isVisible(element) && exactVisibleText(element) === wantedText);
        if (interactive.length) {
            interactive[0].click();
            return true;
        }

        // Some legacy markup attaches the click handler to a plain span/div.
        const plain = Array.from(group.querySelectorAll("span, div"))
            .filter(element => isVisible(element) && exactVisibleText(element) === wantedText)
            .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
        if (plain.length) {
            const target = plain[0].closest("[role='radio'], [role='button'], button, label, a") || plain[0];
            target.click();
            return true;
        }
        return false;
    }

    function difficultyDiagnostics(modal) {
        const select = findDifficultySelect(modal);
        const options = select ? Array.from(select.options || []).map(option =>
            String(option.value) + ":" + String(option.textContent || "").trim()
        ) : [];
        const buttons = Array.from(modal.querySelectorAll(
            "button, label, [role='radio'], [role='button'], .btn, input[type='radio']"
        )).filter(isVisible).map(node => exactVisibleText(node)).filter(Boolean);
        return "select=" + (select ? (select.id || select.name || "found") : "not found") +
            "; options=[" + options.join(" | ") + "]" +
            "; visible choice labels=[" + Array.from(new Set(buttons)).join(" | ") + "]";
    }

    async function setDifficultyFromJson(item) {
        if (!item.difficultyProvided) return;
        const parts = choiceParts(item.difficulty);
        const wantedText = normalizeMatchText(parts.text || parts.value);
        if (!wantedText) return;

        const allowed = ["high", "medium", "low"];
        if (!allowed.includes(wantedText)) {
            throw new Error("DATA/PORTAL FIELD ERROR: Unsupported Difficulty value \"" +
                (parts.text || parts.value) + "\" for Question ID " + item.questionId +
                ". Use High, Medium, or Low, or provide an exact portal option object.");
        }

        const deadline = Date.now() + 12000;
        let lastDiagnostic = "";
        while (Date.now() < deadline) {
            const modal = modalElement() || D;
            const select = findDifficultySelect(modal);
            if (select) {
                const options = getUsableOptions(select);
                let option = options.find(candidate =>
                    candidate.value === parts.value && !!parts.value
                );
                if (!option) {
                    option = options.find(candidate =>
                        normalizeMatchText(candidate.textContent) === wantedText
                    );
                }
                if (option) {
                    setSelectOption(select, option, "Difficulty", true);
                    return;
                }
            }

            const group = findDifficultyGroup(modal, wantedText);
            if (group && clickDifficultyChoice(group, wantedText)) return;

            lastDiagnostic = difficultyDiagnostics(modal);
            await sleep(300);
        }

        throw new Error("DATA/PORTAL FIELD ERROR: Could not select Difficulty value \"" +
            (parts.text || parts.value) + "\" for Question ID " + item.questionId +
            " after waiting 12 seconds for the portal control. The script checked both a native dropdown and the visible High/Medium/Low choice group; it did not choose an approximate option. " +
            "Portal diagnostics: " + lastDiagnostic);
    }

    function findOptionalField(fieldKey) {
        const modal = modalElement() || D;
        const patterns = {
            questionType: /(question.?type|que.?type)/i
        };
        const pattern = patterns[fieldKey];
        if (!pattern) return null;

        const controls = Array.from(modal.querySelectorAll(
            "select, textarea, input:not([type='hidden']), [contenteditable='true']"
        ));
        return controls.find(control =>
            pattern.test(String(control.id || "")) ||
            pattern.test(String(control.name || "")) ||
            pattern.test(String(control.getAttribute("aria-label") || "")) ||
            pattern.test(String(control.title || ""))
        ) || null;
    }

    function noteUnsupportedField(item, fieldLabel) {
        const state = readState() || {};
        if (!Array.isArray(state.unsupportedFields)) state.unsupportedFields = [];
        const entry = fieldLabel;
        if (!state.unsupportedFields.includes(entry)) state.unsupportedFields.push(entry);
        writeState(state);
        console.info("[MU QB] JSON field retained but no separate editable portal control was found:", entry);
    }

    async function setOptionalFieldFromJson(item, fieldKey, fieldLabel, rawValue) {
        if (rawValue == null) return;
        const control = findOptionalField(fieldKey);
        if (!control) {
            noteUnsupportedField(item, fieldLabel);
            return;
        }

        const value = Array.isArray(rawValue) ? rawValue.map(String).join("\n\n") : String(rawValue);
        if (control.tagName === "SELECT") {
            const option = resolveSingleOption(control, rawValue, fieldLabel);
            setSelectOption(control, option, fieldLabel, true);
        } else if (control.isContentEditable) {
            control.innerHTML = value;
            control.dispatchEvent(new W.Event("input", { bubbles: true }));
            control.dispatchEvent(new W.Event("change", { bubbles: true }));
        } else {
            control.value = value;
            control.dispatchEvent(new W.Event("input", { bubbles: true }));
            control.dispatchEvent(new W.Event("change", { bubbles: true }));
        }
    }

    async function applyQuestionMetadata(item) {
        await setModuleFromJson(item);
        if (isRestrictedQuestion(item)) return;

        setTopicsFromJson(item);
        if (isRestrictedQuestion(item)) return;

        setMarksFromJson(item);
        if (isRestrictedQuestion(item)) return;
        if (item.difficultyProvided) {
            await setDifficultyFromJson(item);
        }
        if (isRestrictedQuestion(item)) return;
        if (item.courseOutcomeProvided) {
            setSingleFieldFromJson("courseOutcome", item.courseOutcome, "Course Outcome");
        }
        if (isRestrictedQuestion(item)) return;
        if (item.bloomsProvided) {
            setSingleFieldFromJson("bloomsTaxonomy", item.bloomsTaxonomy, "Bloom's Taxonomy");
        }
        if (isRestrictedQuestion(item)) return;

        if (item.questionTypeProvided) {
            await setOptionalFieldFromJson(item, "questionType", "Question Type", item.questionType?.raw);
        }
        if (isRestrictedQuestion(item)) return;
        if (item.answerReferenceMediaProvided) {
            noteUnsupportedField(item, "Answer Reference Media (browser file inputs cannot be populated from JSON)");
        }
    }

    function getRubricRows() {
        const table = byId(IDS.rubricTable);
        const tbody = table?.tBodies?.[0];
        return tbody ? Array.from(tbody.rows).filter(row => row.cells && row.cells.length >= 3) : [];
    }

    function getRubricDeleteControl(row) {
        if (!row || !row.cells || row.cells.length < 1) return null;
        const actionCell = row.cells[row.cells.length - 1];
        const controls = Array.from(actionCell.querySelectorAll(
            "a, button, input[type='button'], input[type='submit'], input[type='image']"
        )).filter(control => !control.disabled && isVisible(control));
        if (!controls.length) return null;

        const semantic = controls.filter(control => {
            const signature = [
                control.textContent, control.value, control.title,
                control.getAttribute("aria-label"), control.className,
                control.getAttribute("onclick"), control.getAttribute("href"),
                control.querySelector("i")?.className
            ].filter(Boolean).join(" ");
            return /(remove|delete|trash|times|cross|close|clear|✖|×|✕|fa-trash|fa-times|glyphicon-remove)/i.test(signature);
        });

        if (semantic.length === 1) return semantic[0];
        if (semantic.length > 1) return null;
        return controls.length === 1 ? controls[0] : null;
    }

    async function clearExistingRubricRows(questionId) {
        let guard = 0;
        while (getRubricRows().length) {
            const rows = getRubricRows();
            const before = rows.length;
            const removeControl = getRubricDeleteControl(rows[0]);
            if (!removeControl) {
                throw new Error("DATA/PORTAL FIELD ERROR: Question ID " + questionId +
                    " has " + before + " existing rubric row(s), but the row's Action cell does not expose one unambiguous remove/delete control. Nothing was changed in the rubric section.");
            }

            setStatus("Question ID " + questionId + ": deleting existing rubric row " +
                before + " of " + before + "...");
            rubricDeleteInProgress = true;
            try {
                removeControl.click();
            } finally {
                rubricDeleteInProgress = false;
            }

            await waitFor(
                () => getRubricRows().length < before,
                "existing rubric row removal for Question ID " + questionId,
                RECOVERY.postbackTimeoutMs
            );
            await sleep(150);

            guard += 1;
            if (guard > 100) {
                throw new Error("DATA/PORTAL FIELD ERROR: Rubric cleanup exceeded 100 rows for Question ID " +
                    questionId + ". The batch was paused for safety.");
            }
        }
    }

    async function ensureRubricRowCount(requiredCount, questionId) {
        await clearExistingRubricRows(questionId);

        let count = getRubricRows().length;
        while (count < requiredCount) {
            const before = count;
            setStatus("Question ID " + questionId + ": adding new rubric row " +
                (count + 1) + " of " + requiredCount + "...");

            await runPartialPostback(() => {
                const button = byId(IDS.addRubric);
                if (!button) {
                    throw new Error("DATA/PORTAL FIELD ERROR: Rubric Add Row button was not found.");
                }
                button.click();
            }, "Adding rubric row");

            await waitFor(() => getRubricRows().length > before,
                "new rubric row for Question ID " + questionId,
                RECOVERY.postbackTimeoutMs);
            count = getRubricRows().length;
        }

        if (count !== requiredCount) {
            throw new Error("DATA/PORTAL FIELD ERROR: Question ID " + questionId +
                " expected exactly " + requiredCount + " new rubric rows, but found " + count + ".");
        }
    }

    function controlInCell(cell) {
        return cell?.querySelector(
            'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="image"]), textarea, select'
        ) || null;
    }

    function setControl(control, value, description) {
        if (!control) throw new Error("Could not find " + description + " input in the rubric.");
        control.value = String(value ?? "");
        control.dispatchEvent(new W.Event("input", { bubbles: true }));
        control.dispatchEvent(new W.Event("change", { bubbles: true }));
        if (W.jQuery) W.jQuery(control).trigger("change");
    }

    function populateRubrics(rubrics, questionId) {
        const rows = getRubricRows();
        if (rows.length !== rubrics.length) {
            throw new Error("Question ID " + questionId + ": expected " + rubrics.length +
                " rubric rows, found " + rows.length + ".");
        }

        rubrics.forEach((rubric, index) => {
            const cells = rows[index].cells;
            setControl(controlInCell(cells[0]), rubric.criterion, "Criterion row " + (index + 1));
            setControl(controlInCell(cells[1]), rubric.expectedEvidence, "Expected Evidence row " + (index + 1));
            setControl(controlInCell(cells[2]), rubric.marks, "Marks row " + (index + 1));
        });
    }

    // Build the complete Expected Answer for the portal's single CKEditor field.
    // The university form has no separate Alternate Answers control, so all
    // alternate acceptable answers are appended to the main answer here.
    // HTML in alternateAnswers is parsed as markup (not escaped as visible text),
    // sanitized to a formatting allow-list, and then passed to CKEditor as HTML.
    const ANSWER_HTML_ALLOWED_TAGS = new Set([
        "A", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "INS",
        "P", "DIV", "SPAN", "BR", "HR", "WBR", "CENTER", "H1", "H2", "H3", "H4", "H5", "H6",
        "UL", "OL", "LI", "DL", "DT", "DD", "TABLE", "CAPTION", "COLGROUP",
        "COL", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "BLOCKQUOTE",
        "PRE", "CODE", "SUB", "SUP", "SMALL", "BIG", "MARK", "ABBR", "CITE",
        "Q", "KBD", "SAMP", "VAR", "ADDRESS", "FIGURE", "FIGCAPTION", "FONT"
    ]);

    const ANSWER_HTML_DROP_TAGS = new Set([
        "SCRIPT", "STYLE", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED",
        "APPLET", "FORM", "INPUT", "BUTTON", "TEXTAREA", "SELECT", "OPTION",
        "LINK", "META", "BASE", "SVG", "MATH", "VIDEO", "AUDIO", "SOURCE",
        "CANVAS", "TEMPLATE"
    ]);

    const ANSWER_HTML_VOID_TAGS = new Set(["BR", "HR", "WBR", "COL"]);

    function escapeAnswerHtml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function decodeEncodedAnswerMarkup(value) {
        const text = String(value ?? "");
        // Also support data generators that have already entity-encoded tags,
        // e.g. "&lt;p&gt;Answer&lt;/p&gt;". Ordinary entities such as "&lt; 5"
        // are left untouched unless they clearly encode a known HTML tag.
        const knownTag = "(?:p|div|span|br|hr|strong|b|em|i|u|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|code)";
        if (!new RegExp("&lt;\\/?" + knownTag + "\\b", "i").test(text) || !/&gt;/i.test(text)) {
            return text;
        }
        const decoder = D.createElement("textarea");
        decoder.innerHTML = text;
        return decoder.value;
    }

    function safeAnswerInlineStyle(styleText) {
        const probe = D.createElement("span");
        probe.setAttribute("style", String(styleText || ""));
        const allowedProperties = [
            "text-align", "font-weight", "font-style", "text-decoration",
            "vertical-align", "white-space", "color", "background-color",
            "border", "border-collapse", "padding", "margin", "width", "height"
        ];
        const safe = [];
        for (const property of allowedProperties) {
            const value = probe.style.getPropertyValue(property).trim();
            if (!value) continue;
            // Only simple CSS values are retained; URL/expression-based values
            // and other executable or externally-loaded CSS are rejected.
            if (!/^[a-z0-9#(),.%\s-]+$/i.test(value) || /url|expression|javascript|var\s*\(/i.test(value)) {
                continue;
            }
            safe.push(property + ":" + value);
        }
        return safe.length ? ' style="' + escapeAnswerHtml(safe.join(";")) + '"' : "";
    }

    function sanitizeAlternateAnswerHtml(rawValue) {
        const source = decodeEncodedAnswerMarkup(String(rawValue ?? "").trim());
        if (!source) return "";

        // Plain text remains fully supported. It is escaped and converted into
        // paragraphs/line breaks, while actual HTML fragments retain formatting.
        if (!/<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?\s*>/i.test(source)) {
            return source
                .replace(/\r\n?/g, "\n")
                .split(/\n{2,}/)
                .map(paragraph => paragraph.trim())
                .filter(Boolean)
                .map(paragraph => "<p>" + escapeAnswerHtml(paragraph).replace(/\n/g, "<br>") + "</p>")
                .join("\n");
        }

        const template = D.createElement("template");
        template.innerHTML = source;

        function sanitizeNode(node) {
            if (node.nodeType === 3) return escapeAnswerHtml(node.nodeValue || "");
            if (node.nodeType !== 1) return "";

            const tag = String(node.tagName || "").toUpperCase();
            if (ANSWER_HTML_DROP_TAGS.has(tag)) return "";

            const children = Array.from(node.childNodes).map(sanitizeNode).join("");
            // Unknown/non-semantic wrappers are unwrapped, preserving their
            // readable contents without passing unsupported markup to CKEditor.
            if (!ANSWER_HTML_ALLOWED_TAGS.has(tag)) return children;

            let attributes = "";
            const title = node.getAttribute("title");
            if (title) attributes += ' title="' + escapeAnswerHtml(title) + '"';

            if (tag === "A") {
                const href = (node.getAttribute("href") || "").trim();
                if (href) {
                    try {
                        const parsed = new W.URL(href, W.location.href);
                        if (["http:", "https:", "mailto:"].includes(parsed.protocol) || href.startsWith("#")) {
                            attributes += ' href="' + escapeAnswerHtml(href) + '"';
                            if (/^https?:/i.test(parsed.protocol)) {
                                attributes += ' target="_blank" rel="noopener noreferrer"';
                            }
                        }
                    } catch (_) { /* Invalid links are omitted. */ }
                }
            }

            if (tag === "TD" || tag === "TH") {
                for (const attr of ["colspan", "rowspan"]) {
                    const value = node.getAttribute(attr);
                    if (value && /^\d{1,2}$/.test(value)) attributes += " " + attr + '=\"' + value + '\"';
                }
                const align = (node.getAttribute("align") || "").toLowerCase();
                if (["left", "center", "right", "justify"].includes(align)) {
                    attributes += ' align="' + align + '"';
                }
                if (tag === "TH") {
                    const scope = (node.getAttribute("scope") || "").toLowerCase();
                    if (["row", "col", "rowgroup", "colgroup"].includes(scope)) {
                        attributes += ' scope="' + scope + '"';
                    }
                }
            }

            if (tag === "TABLE") {
                for (const attr of ["border", "cellpadding", "cellspacing"]) {
                    const value = node.getAttribute(attr);
                    if (value && /^\d{1,3}$/.test(value)) attributes += ' ' + attr + '=\"' + value + '\"';
                }
                const width = (node.getAttribute("width") || "").trim();
                if (/^\d{1,4}(?:%|px)?$/.test(width)) attributes += ' width="' + width + '"';
            }
            if (tag === "COL") {
                const span = node.getAttribute("span");
                if (span && /^\d{1,2}$/.test(span)) attributes += ' span="' + span + '"';
            }
            if (tag === "FONT") {
                const color = (node.getAttribute("color") || "").trim();
                if (/^(?:#[0-9a-f]{3,8}|[a-z]{3,20})$/i.test(color)) attributes += ' color="' + color + '"';
                const size = (node.getAttribute("size") || "").trim();
                if (/^[1-7]$/.test(size)) attributes += ' size="' + size + '"';
            }

            if (tag === "OL") {
                const start = node.getAttribute("start");
                if (start && /^-?\d{1,4}$/.test(start)) attributes += ' start="' + start + '"';
                const type = (node.getAttribute("type") || "").trim();
                if (["1", "a", "A", "i", "I"].includes(type)) attributes += ' type="' + type + '"';
            }
            if (tag === "LI") {
                const value = node.getAttribute("value");
                if (value && /^-?\d{1,4}$/.test(value)) attributes += ' value="' + value + '"';
            }

            const style = safeAnswerInlineStyle(node.getAttribute("style"));
            if (style) attributes += style;

            const name = tag.toLowerCase();
            if (ANSWER_HTML_VOID_TAGS.has(tag)) return "<" + name + attributes + ">";
            return "<" + name + attributes + ">" + children + "</" + name + ">";
        }

        return Array.from(template.content.childNodes).map(sanitizeNode).join("\n").trim();
    }

    function buildExpectedAnswerHtml(item) {
        const mainAnswer = String(item.answer ?? "");
        const rawAlternatives = Array.isArray(item.alternateAnswers)
            ? item.alternateAnswers
            : (item.alternateAnswers == null ? [] : [item.alternateAnswers]);

        const alternatives = rawAlternatives
            .map(value => sanitizeAlternateAnswerHtml(value))
            .filter(Boolean);

        if (!alternatives.length) return mainAnswer;

        const alternateItems = alternatives.map(value =>
            "<li><div>" + value + "</div></li>"
        ).join("\n");

        return mainAnswer +
            "\n<hr>\n" +
            "<h3>Alternative Acceptable Answers</h3>\n" +
            "<p>The following answers are also acceptable:</p>\n" +
            "<ol>\n" + alternateItems + "\n</ol>";
    }

    async function setEditorHtml(editorId, html, label) {
        const editor = await waitFor(
            () => W.CKEDITOR?.instances?.[editorId],
            label + " CKEditor",
            30000
        );

        await new Promise((resolve, reject) => {
            let finished = false;
            const timer = W.setTimeout(() => {
                if (finished) return;
                finished = true;
                reject(new Error(label + " CKEditor did not finish setting content within 45 seconds."));
            }, 45000);

            const finish = error => {
                if (finished) return;
                finished = true;
                W.clearTimeout(timer);
                if (error) reject(error);
                else resolve();
            };

            try {
                editor.setData(String(html), {
                    callback: function () {
                        try {
                            editor.updateElement();
                            finish();
                        } catch (error) {
                            finish(error);
                        }
                    }
                });
            } catch (error) {
                finish(error);
            }
        });
    }

    function getVisibleValidationMessages() {
        const selectors = [
            "#AddQuestion .validation-summary-errors",
            "#AddQuestion .field-validation-error",
            "#AddQuestion .alert-danger",
            "#AddQuestion [role='alert']"
        ];
        const messages = [];
        for (const selector of selectors) {
            D.querySelectorAll(selector).forEach(element => {
                if (!isVisible(element)) return;
                const message = String(element.textContent || "").replace(/\s+/g, " ").trim();
                if (message && !isQuestionPaperLockedMessage(message) && !messages.includes(message)) {
                    messages.push(message);
                }
            });
        }
        return messages;
    }

    async function waitForSuccessConfirmation(questionId) {
        await waitFor(() => {
            const state = readState();
            return state && (
                (state.stage === "advance" && state.successPopupHandled === true) ||
                (state.stage === "restricted_prepare" &&
                    String(state.restrictedModeQuestionId || "") === String(questionId))
            );
        }, "success confirmation or question-paper restriction notice for Question ID " + questionId,
        RECOVERY.successTimeoutMs);
    }

    async function clickUpdateAndWait(item, index, total, saveMode = "full") {
        const state = readState();
        if (!state?.running) throw new Error("Batch stopped before Update.");

        if (!modalIsVisible() || currentFormQuestionId() !== item.questionId) {
            throw new Error("Safety stop: refusing to click Update because the open form is not Question ID " +
                item.questionId + ".");
        }

        const saveButton = byId(IDS.saveButton);
        if (!saveButton || saveButton.disabled) {
            throw new Error("Update button is missing or disabled for Question ID " + item.questionId + ".");
        }

        state.stage = "saving";
        state.currentQuestionId = item.questionId;
        state.saveMode = saveMode;
        state.successPopupHandled = false;
        state.status = "Submitting Update for Question ID " + item.questionId + "...";
        writeState(state);

        setStatus("Question " + (index + 1) + "/" + total +
            " — automatically clicking Update for ID " + item.questionId + "...");

        if (currentFormQuestionId() !== item.questionId) {
            throw new Error("Last-second Question ID check failed; Update was not clicked.");
        }

        saveButton.click();
        await waitForSuccessConfirmation(item.questionId);
    }

    async function advanceAfterSave(item, total) {
        setStatus("Finishing Question ID " + item.questionId + "...");

        // Wait for the success popup's automatic OK click, then close the
        // blank Add New Question form. No post-save record/editor verification
        // is performed; the success confirmation advances the batch.
        await waitFor(() => !getSuccessPopup(),
            "success popup to close after automatic OK click", RECOVERY.popupCloseTimeoutMs);
        await closeBlankAddQuestionFormIfNeeded();

        const state = readState();
        if (!state || !state.running) return;

        if (!Array.isArray(state.completedIds)) state.completedIds = [];
        if (!state.completedIds.includes(item.questionId)) {
            state.completedIds.push(item.questionId);
        }
        if (String(state.restrictedModeQuestionId || "") === item.questionId ||
            state.saveMode === "answers_rubrics") {
            if (!Array.isArray(state.restrictedCompletedIds)) state.restrictedCompletedIds = [];
            if (!state.restrictedCompletedIds.includes(item.questionId)) {
                state.restrictedCompletedIds.push(item.questionId);
            }
        }

        state.index += 1;
        state.currentQuestionId = null;
        state.restrictedModeQuestionId = null;
        state.saveMode = null;
        state.successPopupHandled = false;
        state.successPopupAttempts = 0;
        state.successPopupRecoveryRefreshCount = 0;
        popupClickAttempts = 0;
        popupClickBusy = false;
        state.retryQuestionId = null;
        state.retryCount = 0;
        state.recoveryPending = false;
        state.lastPageAlert = null;
        state.stage = "prepare";
        state.status = "Success confirmation received: " + state.completedIds.length +
            "/" + total + " processed. Last ID: " + item.questionId + ".";
        writeState(state);

        setProgress(state.index, total);
        setStatus(state.status);
    }

    async function runEngine() {
        if (localBusy) return;
        localBusy = true;

        try {
            const batch = readBatch();
            const startingState = readState();
            if (startingState?.running) assertBatchMatchesState(startingState, batch);

            while (true) {
                const state = readState();
                if (!state || !state.running) break;

                if (state.index >= batch.length) {
                    state.running = false;
                    state.stage = "done";
                    state.currentQuestionId = null;
                    const updatedCount = (state.completedIds || []).length;
                    const skippedCount = (state.skippedIds || []).length;
                    if (!Array.isArray(state.skippedLog)) state.skippedLog = [];
                    const skippedReport = state.skippedLog.map(row =>
                        row.questionId + " (" + row.reason + "; attempts: " + row.attempts + ")"
                    );
                    state.status = "BATCH FINISHED" +
                        "\nSuccessfully updated: " + updatedCount +
                        "\nSkipped (NOT modified): " + skippedCount +
                        "\nUpdated IDs: " + (state.completedIds || []).join(", ") +
                        "\nSkipped IDs: " + (state.skippedIds || []).join(", ") +
                        "\nUpdated in answer/rubric-only mode: " + (state.restrictedCompletedIds || []).join(", ") +
                        (skippedReport.length ? "\nSKIPPED-QUESTION LOG:\n" + skippedReport.join("\n") : "\nNo skipped questions.") +
                        ((state.unsupportedFields || []).length
                            ? "\nPORTAL FIELDS NOT EXPOSED (kept in JSON, not submitted):\n" + state.unsupportedFields.join("\n")
                            : "");
                    writeState(state);
                    setProgress(batch.length, batch.length);
                    setStatus(state.status);
                    console.groupCollapsed("[MU QB] Final batch report");
                    console.log("Successfully updated:", updatedCount, "| Skipped:", skippedCount, "| Total:", batch.length);
                    console.log("Updated IDs:", state.completedIds || []);
                    console.table(state.skippedLog);
                    console.groupEnd();
                    break;
                }

                const item = batch[state.index];
                if (!state.currentQuestionId || String(state.currentQuestionId) !== item.questionId) {
                    state.currentQuestionId = item.questionId;
                    if (state.retryQuestionId !== item.questionId) {
                        state.retryQuestionId = item.questionId;
                        state.retryCount = 0;
                    }
                    writeState(state);
                }
                setProgress(state.index, batch.length);

                if (state.stage === "saving") {
                    setStatus("Waiting for the university success popup for Question ID " +
                        item.questionId + "...");
                    await waitForSuccessConfirmation(item.questionId);
                    continue;
                }

                if (state.stage === "advance") {
                    await advanceAfterSave(item, batch.length);
                    continue;
                }

                if (state.stage === "restricted_prepare" || isRestrictedQuestion(item, state)) {
                    setStatus("Question " + (state.index + 1) + "/" + batch.length +
                        " — Question ID " + item.questionId +
                        " is locked for prompt/metadata edits. Updating Expected Answer + Rubrics only...");

                    await reopenExistingQuestionForRestrictedRetry(item.questionId);
                    handleQuestionPaperLockNotice();
                    if (currentFormQuestionId() !== item.questionId) {
                        throw new Error("Restricted retry identity check failed for Question ID " + item.questionId + ".");
                    }

                    // This branch intentionally does NOT call applyQuestionMetadata()
                    // and does NOT write Question Prompt or any other field.
                    await ensureRubricRowCount(item.rubric.length, item.questionId);
                    populateRubrics(item.rubric, item.questionId);
                    await setEditorHtml(IDS.answerEditor, buildExpectedAnswerHtml(item), "Expected Answer");

                    if (currentFormQuestionId() !== item.questionId) {
                        throw new Error("Restricted retry final identity check failed for Question ID " + item.questionId + ".");
                    }
                    const restrictedValidation = getVisibleValidationMessages();
                    if (restrictedValidation.length) {
                        throw new Error("Validation message before restricted Update: " + restrictedValidation.join(" | "));
                    }

                    await clickUpdateAndWait(item, state.index, batch.length, "answers_rubrics");
                    continue;
                }

                if (state.stage !== "prepare") {
                    throw new Error("Unknown automation stage: " + state.stage);
                }

                setStatus("Question " + (state.index + 1) + "/" + batch.length +
                    " — preparing existing Question ID " + item.questionId + "...");

                await closeBlankAddQuestionFormIfNeeded();
                await openExistingQuestion(item.questionId);

                if (currentFormQuestionId() !== item.questionId) {
                    throw new Error("Safety check failed: expected Question ID " +
                        item.questionId + ", found " + (currentFormQuestionId() || "unknown") + ".");
                }

                handleQuestionPaperLockNotice();
                let latestState = readState();
                if (latestState?.stage === "restricted_prepare" || isRestrictedQuestion(item, latestState)) {
                    continue;
                }

                await applyQuestionMetadata(item);
                latestState = readState();
                if (latestState?.stage === "restricted_prepare" || isRestrictedQuestion(item, latestState)) {
                    continue;
                }

                await ensureRubricRowCount(item.rubric.length, item.questionId);
                latestState = readState();
                if (latestState?.stage === "restricted_prepare" || isRestrictedQuestion(item, latestState)) {
                    continue;
                }
                populateRubrics(item.rubric, item.questionId);

                await setEditorHtml(IDS.questionEditor, item.question, "Question Prompt");
                latestState = readState();
                if (latestState?.stage === "restricted_prepare" || isRestrictedQuestion(item, latestState)) {
                    continue;
                }
                await setEditorHtml(IDS.answerEditor, buildExpectedAnswerHtml(item), "Expected Answer");

                handleQuestionPaperLockNotice();
                latestState = readState();
                if (latestState?.stage === "restricted_prepare" || isRestrictedQuestion(item, latestState)) {
                    continue;
                }

                if (currentFormQuestionId() !== item.questionId) {
                    throw new Error("Final identity check failed before saving Question ID " +
                        item.questionId + ".");
                }

                const validation = getVisibleValidationMessages();
                if (validation.length) {
                    throw new Error("Validation message before Update: " + validation.join(" | "));
                }

                await clickUpdateAndWait(item, state.index, batch.length);
                // Next loop advances after the success confirmation. If the page
                // fully reloads, localStorage carries stage="advance" into the new document.
            }
        } catch (error) {
            console.error("[MU QB] Auto updater encountered an error:", error);
            const state = readState() || {};

            if (state.running && scheduleRecovery(error)) {
                // scheduleRecovery persisted the current question and will reload
                // the page. The same question is retried; completed IDs are kept.
            } else if (!state.running) {
                // A deliberate user stop must remain a stop, not become an error.
                if (state.status !== "Stopped by user.") {
                    state.status = state.status || "Paused.";
                    writeState(state);
                    setStatus(state.status);
                }
            } else {
                state.running = false;
                state.stage = "error";
                state.lastError = error?.stack || error?.message || String(error);
                state.status = "ERROR: " + (error?.message || String(error));
                writeState(state);
                setStatus(state.status);
            }
        } finally {
            localBusy = false;
            const latest = readState();
            setPanelRunning(!!latest?.running);
        }
    }

    function createPanel() {
        if (byId(HOST_ID)) return;

        const host = D.createElement("div");
        host.id = HOST_ID;
        host.style.cssText =
            "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(310px,calc(100vw - 24px));font-family:Arial,Helvetica,sans-serif;";
        const shadow = host.attachShadow({ mode: "open" });

        shadow.innerHTML = `
          <style>
            *{box-sizing:border-box}
            .panel{background:#fff;color:#1f2937;border:1px solid #cbd5e1;border-radius:9px;box-shadow:0 5px 18px rgba(0,0,0,.20);overflow:hidden}
            .head{display:flex;align-items:center;gap:8px;padding:7px 9px;background:#173b2b;color:#fff;font-size:12px;font-weight:700;cursor:move;user-select:none;touch-action:none}
            .brand{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}
            .title{font-size:12px;line-height:14px}
            .byline{font-size:9px;line-height:11px;font-weight:500;opacity:.82;white-space:nowrap}
            #count{font-size:11px;font-weight:600;opacity:.9}
            #collapse{background:transparent;color:#fff;padding:0 4px;font-size:16px;line-height:16px}
            .body{padding:8px}
            .status{padding:7px 8px;border-radius:6px;background:#f1f5f9;color:#334155;font-size:11px;line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;max-height:92px;overflow:auto}
            .status.error{background:#fff1f2;color:#9f1239;border:1px solid #fecdd3}
            .progress{height:5px;background:#e2e8f0;border-radius:10px;overflow:hidden;margin:7px 0}
            .bar{height:100%;width:0;background:#16a34a;transition:width .2s}
            .buttons{display:flex;gap:5px;flex-wrap:wrap}
            button{border:0;border-radius:5px;padding:6px 8px;cursor:pointer;font-size:10px;font-weight:700}
            #start{background:#17643b;color:#fff}
            #stop{background:#fee2e2;color:#991b1b}
            #reset{background:#e2e8f0;color:#334155}
            #copyError{background:#9f1239;color:#fff}
            #skip{background:#fef3c7;color:#92400e;border:1px solid #f59e0b}
            button:disabled{opacity:.45;cursor:not-allowed}
            #copyError[hidden],#skip[hidden]{display:none}
            .collapsed .body{display:none}
          </style>
          <div class="panel" id="panel">
            <div class="head" id="head">
              <span class="brand"><span class="title">MU QB Auto</span><span class="byline">Script by Niraj Bhagchandani</span></span>
              <span id="count">0 / 0</span>
              <button id="collapse" title="Minimize">−</button>
            </div>
            <div class="body">
              <div class="status" id="status">Checking question data...</div>
              <div class="progress"><div class="bar" id="bar"></div></div>
              <div class="buttons">
                <button id="start">Start / Resume</button>
                <button id="stop" disabled>Stop</button>
                <button id="reset">Reset</button>
                <button id="skip" hidden title="Leave the current failed question unchanged and continue to the next ID">Skip this ID and continue</button>
                <button id="copyError" hidden>Copy error</button>
              </div>
            </div>
          </div>
        `;

        D.body.appendChild(host);

        // Restore the last user-selected panel position after page refresh.
        try {
            const savedPosition = JSON.parse(W.localStorage.getItem(POSITION_KEY) || "null");
            if (savedPosition && Number.isFinite(savedPosition.left) && Number.isFinite(savedPosition.top)) {
                const left = Math.max(0, Math.min(savedPosition.left, W.innerWidth - host.offsetWidth));
                const top = Math.max(0, Math.min(savedPosition.top, W.innerHeight - host.offsetHeight));
                host.style.left = left + "px";
                host.style.top = top + "px";
                host.style.right = "auto";
                host.style.bottom = "auto";
            }
        } catch (_) {}

        const get = id => shadow.getElementById(id);

        ui = {
            start: get("start"),
            stop: get("stop"),
            reset: get("reset"),
            copyError: get("copyError"),
            skip: get("skip"),
            status: get("status"),
            bar: get("bar"),
            count: get("count"),
            panel: get("panel"),
            head: get("head"),
            collapse: get("collapse")
        };

        ui.collapse.addEventListener("click", () => {
            const collapsed = ui.panel.classList.toggle("collapsed");
            ui.collapse.textContent = collapsed ? "+" : "−";
            ui.collapse.title = collapsed ? "Expand" : "Minimize";
        });

        // Drag the floating panel by holding its green title bar.
        let dragState = null;
        ui.head.addEventListener("pointerdown", event => {
            if (event.button !== 0 || event.target?.closest?.("button")) return;
            const rect = host.getBoundingClientRect();
            dragState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                left: rect.left,
                top: rect.top
            };
            host.style.left = rect.left + "px";
            host.style.top = rect.top + "px";
            host.style.right = "auto";
            host.style.bottom = "auto";
            try { ui.head.setPointerCapture(event.pointerId); } catch (_) {}
            event.preventDefault();
        });

        ui.head.addEventListener("pointermove", event => {
            if (!dragState || event.pointerId !== dragState.pointerId) return;
            const maxLeft = Math.max(0, W.innerWidth - host.offsetWidth);
            const maxTop = Math.max(0, W.innerHeight - host.offsetHeight);
            const left = Math.max(0, Math.min(
                dragState.left + event.clientX - dragState.startX, maxLeft
            ));
            const top = Math.max(0, Math.min(
                dragState.top + event.clientY - dragState.startY, maxTop
            ));
            host.style.left = left + "px";
            host.style.top = top + "px";
        });

        const finishDrag = event => {
            if (!dragState || (event && event.pointerId !== dragState.pointerId)) return;
            dragState = null;
            const rect = host.getBoundingClientRect();
            try {
                W.localStorage.setItem(POSITION_KEY, JSON.stringify({
                    left: Math.round(rect.left),
                    top: Math.round(rect.top)
                }));
            } catch (_) {}
        };
        ui.head.addEventListener("pointerup", finishDrag);
        ui.head.addEventListener("pointercancel", finishDrag);
        W.addEventListener("resize", () => {
            const rect = host.getBoundingClientRect();
            const left = Math.max(0, Math.min(rect.left, W.innerWidth - host.offsetWidth));
            const top = Math.max(0, Math.min(rect.top, W.innerHeight - host.offsetHeight));
            host.style.left = left + "px";
            host.style.top = top + "px";
            host.style.right = "auto";
            host.style.bottom = "auto";
            try {
                W.localStorage.setItem(POSITION_KEY, JSON.stringify({
                    left: Math.round(left), top: Math.round(top)
                }));
            } catch (_) {}
        });

        ui.skip.addEventListener("click", async () => {
            try {
                const batch = readBatch();
                const state = readState();
                if (!state || state.running || state.stage !== "error" ||
                    !String(state.currentQuestionId || "").trim()) {
                    throw new Error("Skip is available only when the batch is paused on an error for a specific Question ID.");
                }

                assertBatchMatchesState(state, batch);
                const item = batch[state.index];
                if (!item || String(state.currentQuestionId) !== item.questionId) {
                    throw new Error("The current question ID does not match the saved batch position. Nothing was skipped.");
                }

                // Do not skip while an ASP.NET request is still changing the form.
                await waitForPagePostbackIdle("portal request to finish before skipping Question ID " + item.questionId, true);

                if (modalIsVisible()) {
                    if (isBlankAddQuestionForm()) {
                        await closeBlankAddQuestionFormIfNeeded(true);
                    } else {
                        const openId = currentFormQuestionId();
                        if (openId !== item.questionId) {
                            throw new Error("A different Question ID (" + (openId || "unknown") +
                                ") is open. Close it manually; the script will not close another record.");
                        }
                        // The user has explicitly chosen to skip this failed record.
                        // Hide its edit modal without clicking Update, discarding any
                        // unsaved edits so the next record can be opened safely.
                        await hideAddQuestionModal(true);
                    }
                }

                const diagnostic = String(state.lastError || state.status || "Unknown portal error");
                const markText = item.marks == null ? "" : "\nQuestion marks: " + item.marks;
                const restrictedText = String(state.restrictedModeQuestionId || "") === item.questionId
                    ? "\nThe question-paper restriction was detected; the answer/rubric-only attempt also failed."
                    : "";
                const confirmed = W.confirm(
                    "Skip Question ID " + item.questionId + "?" + markText + restrictedText +
                    "\n\nThis record will NOT be submitted again. It will be recorded as skipped, and the batch will continue with the next ID." +
                    "\n\nLast error: " + diagnostic.slice(0, 700) +
                    "\n\nIf the portal may have saved the record but failed to show confirmation, verify it manually later."
                );
                if (!confirmed) return;

                addSkippedLogEntry(state, {
                    questionId: item.questionId,
                    marks: item.marks,
                    reason: "Manually skipped by user after paused error",
                    attempts: Number(state.retryCount || 0),
                    error: [state.lastError, state.status, state.lastPageAlert].filter(Boolean).join("\n")
                });
                state.index += 1;
                state.currentQuestionId = null;
                state.restrictedModeQuestionId = null;
                state.saveMode = null;
                state.running = true;
                state.stage = "prepare";
                state.resumeStage = "prepare";
                state.retryQuestionId = null;
                state.retryCount = 0;
                state.recoveryPending = false;
                state.lastPageAlert = null;
                state.lastError = null;
                state.successPopupHandled = false;
                state.successPopupAttempts = 0;
                state.status = "Skipped Question ID " + item.questionId +
                    " (NOT resubmitted; recorded as skipped). Continuing with the next question. Successfully updated: " +
                    (state.completedIds || []).length + " | Skipped: " + state.skippedIds.length + ".";
                writeState(state);
                setPanelRunning(true);
                ui.copyError.hidden = true;
                setProgress(state.index, batch.length);
                setStatus(state.status);
                runEngine();
            } catch (error) {
                setStatus("ERROR: " + (error?.message || error));
            }
        });

        ui.copyError.addEventListener("click", async () => {
            const state = readState() || {};
            const details = [
                "Marwadi University Question Bank automation error",
                state.status || "",
                "",
                state.lastError || "No stack trace stored."
            ].join("\\n");
            try {
                await W.navigator.clipboard.writeText(details);
                ui.copyError.textContent = "Copied";
                W.setTimeout(() => { if (ui?.copyError) ui.copyError.textContent = "Copy error"; }, 1500);
            } catch (_) {
                const textarea = D.createElement("textarea");
                textarea.value = details;
                textarea.style.position = "fixed";
                textarea.style.opacity = "0";
                D.body.appendChild(textarea);
                textarea.select();
                try { D.execCommand("copy"); } catch (_) {}
                textarea.remove();
                ui.copyError.textContent = "Copy attempted";
                W.setTimeout(() => { if (ui?.copyError) ui.copyError.textContent = "Copy error"; }, 1500);
            }
        });

        ui.start.addEventListener("click", () => {
            try {
                const batch = readBatch();
                const batchSignature = getBatchSignature(batch);
                let state = readState();

                if (!state || state.stage === "done") {
                    state = {
                        running: true,
                        index: 0,
                        stage: "prepare",
                        completedIds: [],
                        skippedIds: [],
                        skippedLog: [],
                        unsupportedFields: [],
                        restrictedQuestionIds: [],
                        restrictedCompletedIds: [],
                        restrictedModeQuestionId: null,
                        saveMode: null,
                        currentQuestionId: null,
                        successPopupHandled: false,
                        successPopupAttempts: 0,
                        retryQuestionId: null,
                        retryCount: 0,
                        recoveryPending: false,
                        batchSignature,
                        lastPageAlert: null,
                        lastError: null
                    };
                } else {
                    assertBatchMatchesState(state, batch);
                    if (!Array.isArray(state.skippedIds)) state.skippedIds = [];
                    if (!Array.isArray(state.skippedLog)) state.skippedLog = [];
                    if (!Array.isArray(state.unsupportedFields)) state.unsupportedFields = [];
                    if (!Array.isArray(state.restrictedQuestionIds)) state.restrictedQuestionIds = [];
                    if (!Array.isArray(state.restrictedCompletedIds)) state.restrictedCompletedIds = [];
                    state.running = true;
                    if (state.stage === "error") state.stage = state.resumeStage || "prepare";
                    state.retryCount = 0;
                    state.retryQuestionId = state.currentQuestionId || null;
                    state.recoveryPending = false;
                    state.lastPageAlert = null;
                    state.lastError = null;
                }

                writeState(state);
                setPanelRunning(true);
                ui.copyError.hidden = true;
                setProgress(state.index, batch.length);
                setStatus("Starting " + batch.length + " question(s)...");
                runEngine();
            } catch (error) {
                setStatus("ERROR: " + (error?.message || error));
            }
        });

        ui.stop.addEventListener("click", () => {
            if (recoveryTimer) W.clearTimeout(recoveryTimer);
            recoveryTimer = null;
            const state = readState() || {};
            state.running = false;
            state.recoveryPending = false;
            state.status = "Stopped by user.";
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
        });

        ui.reset.addEventListener("click", () => {
            if (recoveryTimer) W.clearTimeout(recoveryTimer);
            recoveryTimer = null;
            try {
                const batch = readBatch();
                const state = readState() || {};
                state.running = false;
                state.index = 0;
                state.stage = "prepare";
                state.completedIds = [];
                state.skippedIds = [];
                state.skippedLog = [];
                state.unsupportedFields = [];
                state.restrictedQuestionIds = [];
                state.restrictedCompletedIds = [];
                state.restrictedModeQuestionId = null;
                state.saveMode = null;
                state.currentQuestionId = null;
                state.successPopupHandled = false;
                state.successPopupAttempts = 0;
                state.retryQuestionId = null;
                state.retryCount = 0;
                state.recoveryPending = false;
                state.lastPageAlert = null;
                state.batchSignature = getBatchSignature(batch);
                state.lastError = null;
                state.status = "Progress reset. Ready.";
                writeState(state);
                setProgress(0, batch.length);
                setStatus(state.status);
                setPanelRunning(false);
                ui.copyError.hidden = true;
            } catch (error) {
                setStatus("ERROR: " + (error?.message || error));
            }
        });

        try {
            const batch = readBatch();
            const state = readState();
            setProgress(state?.index || 0, batch.length);
            if (state?.status) setStatus(state.status);
            else setStatus(batch.length + " question(s) loaded. Ready.");
            if (state?.stage === "error" && state.lastError) ui.copyError.hidden = false;
            setPanelRunning(!!state?.running);
            updateSkipButton();
        } catch (error) {
            setStatus("No data. Run 01_QUESTION_DATA.js in Snippets.");
        }
    }

    // Catch rejected asynchronous operations that escape a local await/catch.
    // Only act while this updater is actively processing a question.
    W.addEventListener("unhandledrejection", event => {
        const state = readState();
        if (!state?.running || !localBusy) return;
        const reason = event?.reason;
        console.error("[MU QB] Unhandled rejection during batch:", reason);
        scheduleRecovery(reason instanceof Error ? reason : new Error(String(reason || "Unhandled page rejection")));
    });

    function onReady() {
        if (!D.body) {
            W.setTimeout(onReady, 100);
            return;
        }

        // Let the page's own jQuery/Bootstrap ready handlers finish hiding its
        // initial blank Add Question modal before inspecting the form.
        W.setTimeout(() => {
            installSuccessPopupObserver();
            createPanel();

            let state = readState();
            if (state?.running) {
                if (state.recoveryPending) {
                    state.recoveryPending = false;
                    state.status = state.resumeNotice || ("Page refreshed. Resuming Question ID " +
                        (state.currentQuestionId || "at the next pending record") +
                        " (automatic retry " + (state.retryCount || 0) + "/" +
                        RECOVERY.maxRetriesPerQuestion + ")...");
                    state.resumeNotice = null;
                    writeState(state);
                }

                // If the browser was refreshed while a save request was in flight,
                // the success popup may have been lost. Re-open and re-apply the same
                // existing record instead of waiting forever for a vanished popup.
                if (state.stage === "saving") {
                    const restrictedPending = String(state.restrictedModeQuestionId || "") ===
                        String(state.currentQuestionId || "");
                    state.stage = restrictedPending ? "restricted_prepare" : "prepare";
                    state.resumeStage = state.stage;
                    state.successPopupHandled = false;
                    state.status = "Recovering interrupted save for Question ID " +
                        (state.currentQuestionId || "current record") +
                        (restrictedPending
                            ? "; resuming in answer/rubric-only mode."
                            : "; the same record will be safely re-applied.");
                    writeState(state);
                }

                setPanelRunning(true);
                setStatus(state.status || "Resuming...");
                runEngine();
            } else {
                setPanelRunning(false);
            }
        }, 900);
    }

    function waitForDocumentRoot() {
        if (D.documentElement) {
            installSuccessPopupObserver();
            return;
        }
        W.setTimeout(waitForDocumentRoot, 50);
    }

    waitForDocumentRoot();

    if (D.readyState === "loading") {
        D.addEventListener("DOMContentLoaded", onReady, { once: true });
    } else {
        onReady();
    }

    console.info("[MU QB] Version 8.4.3 loaded (HTML-aware alternate answers appended in the same Expected Answer CKEditor; sanitized formatting; JSON-driven metadata; multi-topic; replace-all rubrics; question-paper answer/rubric-only mode; automatic success-popup recovery).");
})();
