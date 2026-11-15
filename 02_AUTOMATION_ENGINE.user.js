// ==UserScript==
// @name         Marwadi University Question Bank — Auto Resume Updater
// @namespace    MU-QuestionBank-Automation
// @version      7.4.0
// @description  Mark-aware question updater with three-attempt recovery for one-mark dropdown errors and automatic skip logging.
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
        rubricTable: "tblRubrics",
        addRubric: "ctl00_ContentPlaceHolder1_btnAddRubricRow",
        saveButton: "ctl00_ContentPlaceHolder1_btnSave"
    };

    const SUCCESS_TEXT = /record\s+update\s+successfully|record\s+updated\s+successfully|question\s+updated\s+successfully|update\s+successful|successfully\s+updated|saved\s+successfully/i;

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
        popupCloseTimeoutMs: 20000
    });

    const sleep = ms => new Promise(resolve => W.setTimeout(resolve, ms));
    const byId = id => D.getElementById(id);

    let ui = null;
    let localBusy = false;
    let successObserver = null;
    let recoveryTimer = null;
    let popupClickBusy = false;
    let popupClickAttempts = 0;

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
        const diagnostic = [state?.status, state?.lastError, state?.lastPageAlert].filter(Boolean).join("\n");
        const canSkip = !!state && !state.running && state.stage === "error" &&
            !!state.currentQuestionId && Number.isInteger(Number(state.index)) &&
            state.index >= 0 && isMarksDropdownMismatch(diagnostic);
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
            /currently has \d+ rubric rows but the data file has/i,
            /will not delete existing rubric rows/i,
            /unknown automation stage/i,
            /progress belongs to a different batch|question batch does not match|cannot safely match legacy progress/i,
            /unauthorized|access denied|permission denied/i
        ].some(pattern => pattern.test(text));
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
        const resumeStage = state.stage === "advance" ? "advance" : "prepare";
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
                state.stage = "prepare";
                state.resumeStage = "prepare";
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
                    "\nAutomatic retry was not attempted because this appears to be a data, validation, permission, or safety issue. Correct it and press Start / Resume.";
            }
            writeState(state);
            setStatus(state.status);
            setPanelRunning(false);
            console.error("[MU QB] Manual intervention required:", error);
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
                "\nThe batch is safely paused. Press Start / Resume to try this same question again.";
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

            // Question-level marks are metadata from the data file. A value of 1
            // is valid (for example, a one-mark MCQ) and is not a reason to reject
            // the record. This script does not force the portal's server dropdown.
            const marks = item.marks == null || item.marks === "" ? null : Number(item.marks);
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

            return {
                questionId,
                question,
                answer,
                rubric: normalizedRubric,
                marks
            };
        });
    }

    function getBatchSignature(batch) {
        // Keep the Version 7.2 signature shape for backward compatibility with
        // saved progress. Question-level marks are validated separately and are
        // not changed by this updater; the editable payload remains these fields.
        const signaturePayload = batch.map(item => ({
            questionId: item.questionId,
            question: item.question,
            answer: item.answer,
            rubric: item.rubric
        }));
        const serialized = JSON.stringify(signaturePayload);
        let hash = 2166136261;
        for (let index = 0; index < serialized.length; index++) {
            hash ^= serialized.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return batch.length + ":" + (hash >>> 0).toString(16);
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
            throw new Error("The loaded question-data file does not match the saved progress. Restore the original batch to resume, or press Reset to start this batch from the beginning.");
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
        successObserver = new W.MutationObserver(() => handleSuccessPopup());
        successObserver.observe(D.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "aria-hidden"]
        });
        // Also check in case the popup was added before the observer.
        handleSuccessPopup();
    }

    function waitFor(getter, label, timeout = RECOVERY.elementTimeoutMs) {
        return new Promise((resolve, reject) => {
            const started = Date.now();
            const poll = () => {
                let result;
                try { result = getter(); } catch (_) {}
                if (result) return resolve(result);

                const state = readState();
                if (!state?.running) {
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

    function hideAddQuestionModal() {
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
            "Add Question form to close", RECOVERY.popupCloseTimeoutMs).then(() => {
                try { if (typeof W.HideModal === "function") W.HideModal(); } catch (_) {}
            });
    }

    async function closeBlankAddQuestionFormIfNeeded() {
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
                "blank Add New Question form to close using Cancel", 15000);
        } catch (firstError) {
            if (W.jQuery && W.jQuery.fn && typeof W.jQuery.fn.modal === "function") {
                W.jQuery(modal).modal("hide");
                await waitFor(() => !modalIsVisible(),
                    "blank Add New Question form to close", 15000);
            } else {
                throw new Error(
                    "Could not close the blank Add New Question form. Cancel click did not hide it. " +
                    "Original detail: " + firstError.message
                );
            }
        }
        await sleep(250);
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
                    reject(new Error(label + " failed: " + (error.message || error)));
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

    function getRubricRows() {
        const table = byId(IDS.rubricTable);
        const tbody = table?.tBodies?.[0];
        return tbody ? Array.from(tbody.rows).filter(row => row.cells && row.cells.length >= 3) : [];
    }

    async function ensureRubricRowCount(requiredCount, questionId) {
        let count = getRubricRows().length;
        if (count > requiredCount) {
            throw new Error("Question ID " + questionId + " currently has " + count +
                " rubric rows but the data file has " + requiredCount +
                ". The script will not delete existing rubric rows automatically.");
        }

        while (count < requiredCount) {
            const before = count;
            setStatus("Question ID " + questionId + ": adding rubric row " +
                (count + 1) + " of " + requiredCount + "...");

            await runPartialPostback(() => {
                const button = byId(IDS.addRubric);
                if (!button) throw new Error("Rubric Add Row button was not found.");
                button.click();
            }, "Adding rubric row");

            await waitFor(() => getRubricRows().length > before,
                "new rubric row for Question ID " + questionId);
            count = getRubricRows().length;
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
                if (message && !messages.includes(message)) messages.push(message);
            });
        }
        return messages;
    }

    async function waitForSuccessConfirmation(questionId) {
        await waitFor(() => {
            const state = readState();
            return state && state.stage === "advance" && state.successPopupHandled === true;
        }, "success popup and automatic OK click for Question ID " + questionId, RECOVERY.successTimeoutMs);
    }

    async function clickUpdateAndWait(item, index, total) {
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

        state.index += 1;
        state.currentQuestionId = null;
        state.successPopupHandled = false;
        state.successPopupAttempts = 0;
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
                        (skippedReport.length ? "\nSKIPPED-QUESTION LOG:\n" + skippedReport.join("\n") : "\nNo skipped questions.");
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

                await ensureRubricRowCount(item.rubric.length, item.questionId);
                populateRubrics(item.rubric, item.questionId);

                await setEditorHtml(IDS.questionEditor, item.question, "Question Prompt");
                await setEditorHtml(IDS.answerEditor, item.answer, "Expected Answer");

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
                <button id="skip" hidden>Skip this ID and continue</button>
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
                    !isMarksDropdownMismatch([state.status, state.lastError, state.lastPageAlert].filter(Boolean).join("\n"))) {
                    throw new Error("Skip is available only when the batch is paused on the detected drpQuestionMarks SelectedValue configuration error.");
                }

                assertBatchMatchesState(state, batch);
                const item = batch[state.index];
                if (!item || String(state.currentQuestionId || item.questionId) !== item.questionId) {
                    throw new Error("The current question ID does not match the saved batch position. Nothing was skipped.");
                }

                if (modalIsVisible()) {
                    if (isBlankAddQuestionForm()) {
                        await closeBlankAddQuestionFormIfNeeded();
                    } else {
                        throw new Error("An edit form is still open. Close it manually before skipping this question.");
                    }
                }

                const markText = item.marks == null ? "" : "\nQuestion marks: " + item.marks;
                const confirmed = W.confirm(
                    "Skip Question ID " + item.questionId + "?" + markText +
                    "\n\nThis question will NOT be updated and will be recorded separately as skipped. The batch will continue with the next ID."
                );
                if (!confirmed) return;

                addSkippedLogEntry(state, {
                    questionId: item.questionId,
                    marks: item.marks,
                    reason: "Manually skipped by user",
                    attempts: Number(state.retryCount || 0),
                    error: String(state.lastError || state.status || "")
                });
                state.index += 1;
                state.currentQuestionId = null;
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
                state.status = "Skipped Question ID " + item.questionId + " (NOT updated). Continuing with the next question. Successfully updated: " +
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
                    state.stage = "prepare";
                    state.resumeStage = "prepare";
                    state.successPopupHandled = false;
                    state.status = "Recovering interrupted save for Question ID " +
                        (state.currentQuestionId || "current record") +
                        "; the same record will be safely re-applied.";
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

    console.info("[MU QB] Version 7.3 loaded (mark-aware validation; bounded recovery; explicit skip for permanent marks-dropdown configuration errors; skipped IDs are tracked separately).");
})();
