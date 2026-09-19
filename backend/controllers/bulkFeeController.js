const xlsx = require('xlsx');
const fs = require('fs');
const db = require('../config/sqlDb');
const StudentFee = require('../models/StudentFee');
const FeeHead = require('../models/FeeHead');
const Transaction = require('../models/Transaction');
const FeeStructure = require('../models/FeeStructure');

const normalizeId = (id) => {
    if (!id) return '';
    // Remove hyphens, slashes, commas, and spaces
    return String(id).replace(/[-/,\s]/g, '').toLowerCase().trim();
};

const calculateSimilarity = (s1, s2) => {
    const longer = s1.length < s2.length ? s2 : s1;
    const shorter = s1.length < s2.length ? s1 : s2;
    if (longer.length === 0) return 1.0;

    const editDistance = (s1, s2) => {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else {
                    if (j > 0) {
                        let newValue = costs[j - 1];
                        if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                        costs[j - 1] = lastValue;
                        lastValue = newValue;
                    }
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    };

    return (longer.length - editDistance(longer, shorter)) / parseFloat(longer.length);
};

// @desc Process Excel Upload (Demands & Payments)
// @route POST /api/bulk-fee/upload
const processBulkUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { uploadType, isPendingMode } = req.body; // 'DUE' or 'PAYMENT', isPendingMode boolean
        console.log(`Processing Bulk Upload. Mode: ${uploadType}, PendingMode: ${isPendingMode}`);

        // Fetch all Fee Heads
        const allFeeHeads = await FeeHead.find({});

        let miscHead = null;
        if (uploadType === 'DUE') {
            miscHead = allFeeHeads.find(h => h.name.toLowerCase().includes('miscellaneous') && h.name.toLowerCase().includes('due'));
            if (!miscHead) {
                miscHead = allFeeHeads.find(h => h.name.toLowerCase().includes('miscellaneous') || h.name.toLowerCase().includes('other fees'));
                if (!miscHead) {
                    try {
                        miscHead = await FeeHead.create({
                            name: 'Miscellaneous Due', alias: 'MISC', type: 'General', description: 'Auto-created for Bulk Dues'
                        });
                    } catch (err) {
                        miscHead = await FeeHead.findOne({ name: 'Miscellaneous Due' });
                    }
                }
            }
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });

        if (!rawData || rawData.length < 2) {
            return res.status(400).json({ message: 'File is empty or missing headers' });
        }

        const row0 = rawData[0];
        const colMap = {};
        row0.forEach((h, i) => {
            const originalHead = String(h).toUpperCase().trim();
            const head = originalHead.replace(/[^A-Z0-9]/g, '');
            const isIdWord = (originalHead.includes('NO') || originalHead.includes('NUM') || originalHead.includes('ID') || head.includes('ROLL'));
            const isStandaloneId = (head === 'PIN' || head === 'ADMISSION' || head === 'ADMN' || head === 'STUDENTNO' || head === 'HTNO');
            const isIdCol = isIdWord || isStandaloneId;
            const isFeeCol = (originalHead.includes('FEE') || originalHead.includes('AMT') || originalHead.includes('AMOUNT'));

            if ((head.includes('ADMN') || head.includes('ADMISSION')) && isIdCol && !isFeeCol) {
                if (colMap.ADMISSION === undefined) colMap.ADMISSION = i;
            }
            if ((head.includes('PIN') || head.includes('HTNO') || head.includes('HALLTICKET') || head.includes('ROLL')) && !isFeeCol) {
                if (colMap.PIN === undefined) colMap.PIN = i;
            }
            if ((head === 'ID' || head === 'STUDENTID') && colMap.ADMISSION === undefined && !isFeeCol) {
                colMap.ADMISSION = i;
            }
            if ((head.includes('AMOUNT') || head.includes('DUE') || head.includes('PENDING') || head.includes('BAL')) && isFeeCol) {
                if (colMap.AMOUNT === undefined) colMap.AMOUNT = i;
            }
            if (head.includes('YEAR')) colMap.YEAR = i;
            if (head.includes('SEM') || head.includes('SEC') || head.includes('SEMESTER')) colMap.SEM = i;
            if (head.includes('DATE') && head.includes('TRANS')) colMap.DATE = i;
            if (head.includes('MODE') && head.includes('PAY')) colMap.MODE = i;
            if (head.includes('NARRATION') || head.includes('REMARKS')) colMap.NARRATION = i;
            if (head.includes('REF') || (head.includes('TRANS') && head.includes('ID'))) colMap.REF = i;
            if (head.includes('NAME') && (head.includes('STUDENT') || originalHead.length < 15)) {
                if (colMap.NAME === undefined) colMap.NAME = i;
            }
            if (head === 'CATEGORY' || head === 'TYPE' || head === 'STUDENTTYPE' || head === 'STUDTYPE') {
                if (colMap.CATEGORY === undefined) colMap.CATEGORY = i;
            }
        });

        const feeHeadColMap = {};
        if (uploadType === 'DUE') {
            row0.forEach((h, i) => {
                if (!h) return;
                const headerText = String(h).toUpperCase().replace(/[^A-Z0-9]/g, '');

                // 1. Exact/Partial Match with Normalization
                let matchedHead = null;
                allFeeHeads.forEach(fh => {
                    const fhName = fh.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (headerText === fhName || headerText.includes(fhName)) {
                        const isMapped = Object.values(colMap).includes(i);
                        if (!isMapped) matchedHead = fh;
                    }
                });

                // 2. Fuzzy Match for spelling mistakes
                if (!matchedHead) {
                    let bestScore = 0;
                    allFeeHeads.forEach(fh => {
                        const score = calculateSimilarity(headerText, fh.name.toUpperCase().replace(/[^A-Z0-9]/g, ''));
                        if (score > 0.8 && score > bestScore) {
                            bestScore = score;
                            matchedHead = fh;
                        }
                    });
                }

                if (matchedHead) {
                    feeHeadColMap[matchedHead.name] = i;
                }
            });
        }

        if (colMap.ADMISSION === undefined && colMap.PIN === undefined && Object.keys(feeHeadColMap).length === 0 && colMap.AMOUNT === undefined) {
            return res.status(400).json({ message: 'File missing critical columns: Admission No or Pin No. Please check your headers.' });
        }

        // --- PHASE 1: COLLECT ALL RAW IDs ---
        const rawIds = new Set();
        for (let r = 1; r < rawData.length; r++) {
            const row = rawData[r];
            let rawId = null;
            if (colMap.ADMISSION !== undefined && row[colMap.ADMISSION]) rawId = row[colMap.ADMISSION];
            if (!rawId && colMap.PIN !== undefined && row[colMap.PIN]) rawId = row[colMap.PIN];
            if (!rawId && colMap.ID !== undefined && row[colMap.ID]) rawId = row[colMap.ID];
            if (rawId) {
                const normalized = normalizeId(rawId);
                if (normalized) rawIds.add(normalized);
            }
        }

        // --- PHASE 2: RESOLVE IDs FROM SQL ---
        const dbMap = {}; // normalizedId -> canonical student data
        if (rawIds.size > 0) {
            const uniqueIds = Array.from(rawIds);
            // Use REPLACE to strip punctuation in SQL for matching
            const [students] = await db.query(`
                SELECT admission_number, pin_no, student_name, batch, college, course, branch, current_year, stud_type
                FROM students 
                WHERE 
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(pin_no, '-', ''), '/', ''), ',', ''), ' ', '')) IN (?) OR 
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(admission_number, '-', ''), '/', ''), ',', ''), ' ', '')) IN (?)
            `, [uniqueIds, uniqueIds]);

            students.forEach(s => {
                const normAdm = normalizeId(s.admission_number);
                const normPin = s.pin_no ? normalizeId(s.pin_no) : null;

                if (normAdm) dbMap[normAdm] = s;
                if (normPin) dbMap[normPin] = s;

                // Also map direct matches just in case
                dbMap[s.admission_number.toLowerCase()] = s;
                if (s.pin_no) dbMap[s.pin_no.toLowerCase()] = s;
            });
        }

        const parseYear = (val) => {
            if (!val) return 1;
            const s = String(val).trim();
            if (s.match(/I$|1/i) && s.length < 3) return 1;
            if (s.match(/II$|2/i) && s.length < 3) return 2;
            if (s.match(/III$|3/i) && s.length < 4) return 3;
            if (s.match(/IV$|4/i) && s.length < 3) return 4;
            const n = parseInt(s);
            return !isNaN(n) ? n : 1;
        };
        const parseDate = (xlsDate) => {
            if (!xlsDate) return new Date();
            if (typeof xlsDate === 'number') return new Date((xlsDate - 25569) * 86400 * 1000);
            const attempt = new Date(String(xlsDate).trim());
            return isNaN(attempt.getTime()) ? new Date() : attempt;
        };
        const parseSecId = (val) => {
            if (!val) return { year: null, semester: null };
            const s = String(val).trim().toUpperCase();
            if (s.includes('-') || s.includes('/')) {
                const parts = s.split(/[-/]/);
                return { year: parseInt(parts[0]) || null, semester: parseInt(parts[1]) || null };
            }
            const m = s.match(/^(\d)(\d)/);
            if (m) return { year: parseInt(m[1]), semester: parseInt(m[2]) };
            if (s === 'I') return { year: 1, semester: 1 };
            if (s === 'II') return { year: 2, semester: 1 };
            if (s === 'III') return { year: 3, semester: 1 };
            if (s === 'IV') return { year: 4, semester: 1 };
            return { year: null, semester: null };
        };

        const previewDataMap = new Map();
        let processedCount = 0;
        let skippedRows = 0;

        // --- PHASE 3: PROCESSING & GROUPING ---
        for (let r = 1; r < rawData.length; r++) {
            const row = rawData[r];
            let rawId = null;
            if (colMap.ADMISSION !== undefined && row[colMap.ADMISSION]) rawId = row[colMap.ADMISSION];
            if (!rawId && colMap.PIN !== undefined && row[colMap.PIN]) rawId = row[colMap.PIN];
            if (!rawId && colMap.ID !== undefined && row[colMap.ID]) rawId = row[colMap.ID];

            if (!rawId || String(rawId).trim() === '') {
                skippedRows++;
                continue;
            }

            const lookupKey = normalizeId(rawId);
            const sInfo = dbMap[lookupKey];
            const canonId = sInfo ? sInfo.admission_number : lookupKey.toUpperCase();
            const name = sInfo ? sInfo.student_name : (colMap.NAME !== undefined ? row[colMap.NAME] : 'Unknown');

            // Excel Category Overrides SQL stud_type
            let category = colMap.CATEGORY !== undefined ? String(row[colMap.CATEGORY]).trim() : (sInfo ? sInfo.stud_type : 'Regular');
            if (!category || category === 'undefined') category = (sInfo ? sInfo.stud_type : 'Regular');

            let year = colMap.YEAR !== undefined ? parseYear(row[colMap.YEAR]) : 1;
            let semester = 1;
            if (colMap.SEM !== undefined) {
                const secParsed = parseSecId(row[colMap.SEM]);
                if (secParsed.semester) semester = secParsed.semester;
                if (secParsed.year) year = secParsed.year;
            }

            if (!previewDataMap.has(canonId)) {
                previewDataMap.set(canonId, {
                    id: r, displayId: canonId, studentName: name, totalDemand: 0, totalPaid: 0, demands: [], payments: [],
                    year: year, semester: semester, admissionNumber: sInfo ? sInfo.admission_number : null,
                    pinNumber: sInfo ? sInfo.pin_no : null, college: sInfo ? sInfo.college : 'Unknown',
                    course: sInfo ? sInfo.course : 'Unknown', branch: sInfo ? sInfo.branch : 'Unknown',
                    batch: sInfo ? sInfo.batch : '2024-2025', category: category
                });
            }
            const entry = previewDataMap.get(canonId);

            const defaultAmount = colMap.AMOUNT !== undefined ? (parseFloat(row[colMap.AMOUNT]) || 0) : 0;
            if (uploadType === 'DUE') {
                let matrixFound = false;
                Object.keys(feeHeadColMap).forEach(headName => {
                    const idx = feeHeadColMap[headName];
                    const val = parseFloat(row[idx]);
                    if (val > 0) {
                        matrixFound = true;
                        const headObj = allFeeHeads.find(h => h.name === headName);
                        entry.demands.push({
                            headId: headObj ? headObj._id.toString() : 'UNKNOWN',
                            headName: headName, year: year, semester: semester, amount: val
                        });
                        entry.totalDemand += val;
                    }
                });
                if (!matrixFound && defaultAmount > 0) {
                    entry.demands.push({
                        headId: miscHead ? miscHead._id.toString() : 'UNKNOWN',
                        headName: miscHead ? miscHead.name : 'Miscellaneous Due',
                        year: year, semester: semester, amount: defaultAmount
                    });
                    entry.totalDemand += defaultAmount;
                }
            } else {
                const amount = defaultAmount;
                if (amount > 0) {
                    const payMode = colMap.MODE !== undefined ? row[colMap.MODE] : 'Cash';
                    const transDate = colMap.DATE !== undefined ? parseDate(row[colMap.DATE]) : new Date();
                    const ref = colMap.REF !== undefined ? row[colMap.REF] : '';
                    const narration = colMap.NARRATION !== undefined ? row[colMap.NARRATION] : '';
                    entry.payments.push({
                        headId: allFeeHeads[0] ? allFeeHeads[0]._id.toString() : 'UNKNOWN',
                        headName: allFeeHeads[0] ? allFeeHeads[0].name : 'Unknown Fee',
                        year: year, semester: semester, amount: amount, mode: payMode, date: transDate, ref: ref, remarks: narration
                    });
                    entry.totalPaid += amount;
                }
            }
            processedCount++;
        }

        const previewData = Array.from(previewDataMap.values());

        // --- PHASE 4: COMPARISON DATA ---
        // --- PHASE 4: COMPARISON DATA (FETCH CONTEXT FROM SYSTEM) ---
        const allAdmNos = previewData.map(d => d.admissionNumber).filter(Boolean);
        if (allAdmNos.length > 0) {
            // Build an inclusive list of ID variations for MongoDB lookup
            const queryIds = allAdmNos.reduce((acc, id) => {
                const norm = normalizeId(id);
                acc.push(id, id.toLowerCase(), id.toUpperCase(), norm);
                return acc;
            }, []);
            const uniqueQueryIds = [...new Set(queryIds)];

            // Fetch both Demands and Payments for context
            const [existingDemands, existingPayments] = await Promise.all([
                StudentFee.find({ studentId: { $in: uniqueQueryIds } }).select('studentId feeHead amount studentYear'),
                Transaction.find({ studentId: { $in: uniqueQueryIds }, status: { $ne: 'cancelled' } }).select('studentId feeHead amount studentYear')
            ]);

            const sysDemandMap = {}; // Key: normalizedId-feeHead-studentYear
            const sysPaidMap = {};   // Key: normalizedId-feeHead-studentYear

            existingDemands.forEach(d => {
                const normId = normalizeId(d.studentId);
                const key = `${normId}-${d.feeHead}-${d.studentYear}`;
                sysDemandMap[key] = (sysDemandMap[key] || 0) + (Number(d.amount) || 0);
            });

            existingPayments.forEach(t => {
                const normId = normalizeId(t.studentId);
                const key = `${normId}-${t.feeHead}-${t.studentYear}`;
                sysPaidMap[key] = (sysPaidMap[key] || 0) + (Number(t.amount) || 0);
            });

            // Fetch base FeeStructure as fallback
            const contexts = previewData.map(e => ({
                college: e.college, course: e.course, branch: e.branch, batch: e.batch, category: e.category, studentYear: e.year
            }));
            const uniqueContexts = contexts.filter((v, i, a) => a.findIndex(t => t.college === v.college && t.course === v.course && t.branch === v.branch && t.batch === v.batch && t.category === v.category && t.studentYear === v.studentYear) === i);

            const baseFeeStructures = await FeeStructure.find({
                $or: uniqueContexts.map(c => ({
                    college: c.college, course: c.course, branch: c.branch, batch: c.batch, category: c.category, studentYear: c.studentYear
                }))
            });

            const baseFeeMap = {}; // Key: college-course-branch-batch-category-studentYear-feeHead
            baseFeeStructures.forEach(fs => {
                const key = `${fs.college}-${fs.course}-${fs.branch}-${fs.batch}-${fs.category}-${fs.studentYear}-${fs.feeHead}`;
                baseFeeMap[key] = fs.amount;
            });

            previewData.forEach(entry => {
                if (!entry.admissionNumber) return;
                const normEntryId = normalizeId(entry.admissionNumber);
                const isPendingActive = isPendingMode === 'true';

                // If in Payment mode, we don't have entry.demands yet (from Excel). 
                // We add System Demands as context so UI can show "Total Fee".
                if (uploadType === 'PAYMENT') {
                    // Find all system demands for this student
                    existingDemands.forEach(ed => {
                        if (normalizeId(ed.studentId) === normEntryId) {
                            const headObj = allFeeHeads.find(h => String(h._id) === String(ed.feeHead));
                            const alreadyIn = entry.demands.find(d => d.headId === String(ed.feeHead) && d.year === ed.studentYear);
                            if (!alreadyIn) {
                                entry.demands.push({
                                    headId: String(ed.feeHead),
                                    headName: headObj ? headObj.name : 'Unknown Fee',
                                    year: ed.studentYear,
                                    semester: 1, // Default context
                                    amount: 0 // Not uploading a demand
                                });
                            }
                        }
                    });

                    // If NO system demands found, try fallback to base FeeStructure
                    if (entry.demands.length === 0) {
                        baseFeeStructures.forEach(fs => {
                            if (fs.college === entry.college && fs.course === entry.course && fs.branch === entry.branch && fs.batch === entry.batch && fs.category === entry.category && fs.studentYear === entry.year) {
                                const headObj = allFeeHeads.find(h => String(h._id) === String(fs.feeHead));
                                entry.demands.push({
                                    headId: String(fs.feeHead),
                                    headName: headObj ? headObj.name : 'Base Fee Head',
                                    year: entry.year,
                                    semester: 1,
                                    amount: 0
                                });
                            }
                        });
                    }
                }

                entry.demands.forEach(d => {
                    const key = `${normEntryId}-${d.headId}-${d.year}`;
                    let totalFee = sysDemandMap[key] || 0;

                    // Fallback to base FeeStructure if no allotted demand in SQL
                    if (totalFee === 0) {
                        const baseKey = `${entry.college}-${entry.course}-${entry.branch}-${entry.batch}-${entry.category}-${d.year}-${d.headId}`;
                        totalFee = baseFeeMap[baseKey] || 0;
                    }

                    const paidInSys = sysPaidMap[key] || 0;
                    const sysDue = totalFee - paidInSys;

                    d.allotted = totalFee;

                    // Populate meta for UI
                    d.meta = {
                        totalDemand: totalFee,
                        totalPaid: paidInSys,
                        systemDue: sysDue,
                        pendingAmount: d.amount
                    };

                    // Auto-calc payment logic (only for DUE uploads)
                    if (uploadType === 'DUE' && isPendingActive && sysDue > d.amount) {
                        const additionalPayment = sysDue - d.amount;
                        if (additionalPayment > 0) {
                            entry.payments.push({
                                headId: d.headId, headName: d.headName, year: d.year, semester: d.semester,
                                amount: additionalPayment, mode: 'Cash', date: new Date(), remarks: 'Auto-generated payment',
                                meta: d.meta
                            });
                            entry.totalPaid += additionalPayment;
                        }
                    }
                });
            });
        }

        const activeFeeHeads = new Set();
        previewData.forEach(entry => {
            if (entry.demands) entry.demands.forEach(d => { if (d.amount > 0) activeFeeHeads.add(d.headName); });
        });

        res.json({
            message: `Parsed ${processedCount} records (${skippedRows} skipped).`,
            count: previewData.length, totalRows: rawData.length - 1, skippedRows: skippedRows,
            data: previewData, feeHeads: Array.from(activeFeeHeads)
        });

    } catch (error) {
        console.error('Error processing bulk upload:', error);
        res.status(500).json({ message: 'Processing Failed', error: error.message });
    }
};

// @desc Save Bulk Data (Demands and Transactions)
// @route POST /api/bulk-fee/save
const saveBulkData = async (req, res) => {
    console.log('API: saveBulkData called');
    const { students, isPendingMode } = req.body;
    const user = req.user ? req.user.username : 'system';

    const pendingActive = isPendingMode === true || isPendingMode === 'true';

    if (!students || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ message: 'No student data provided' });
    }

    try {
        console.log(`Processing ${students.length} students...`);
        // Step 0: Resolve Student IDs (Map Pin/Admission -> Canonical Admission Number)
        // Use s.displayId which we resolved in the parsing stage (covers Pin or Admission)
        const potentialIds = [...new Set(students.map(s => s.displayId && String(s.displayId).trim()).filter(Boolean))];
        const studentMap = {};
        const allLinkedIdsMap = {}; // admissionNo -> Set of IDs (Pin, Adm)

        if (potentialIds.length > 0) {
            // Fetch matching students from SQL using normalized comparison
            const normalizedPotentialIds = potentialIds.map(id => normalizeId(id)).filter(Boolean);
            console.log(`Resolving ${normalizedPotentialIds.length} IDs from SQL...`);
            const [rows] = await db.query(`
                SELECT admission_number, pin_no
                FROM students
                WHERE 
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(pin_no, '-', ''), '/', ''), ',', ''), ' ', '')) IN (?) OR 
                    LOWER(REPLACE(REPLACE(REPLACE(REPLACE(admission_number, '-', ''), '/', ''), ',', ''), ' ', '')) IN (?)
            `, [normalizedPotentialIds, normalizedPotentialIds]);

            rows.forEach(r => {
                const normAdm = normalizeId(r.admission_number);
                const normPin = r.pin_no ? normalizeId(r.pin_no) : null;

                // Map both Pin and Admission normalized forms to Canonical Admission Number
                if (normAdm) studentMap[normAdm] = r.admission_number;
                if (normPin) studentMap[normPin] = r.admission_number;

                // Map the original displayId if it was already resolved
                potentialIds.forEach(id => {
                    if (normalizeId(id) === normAdm || (normPin && normalizeId(id) === normPin)) {
                        studentMap[id.toLowerCase()] = r.admission_number;
                    }
                });

                // Track all linked IDs for thorough purging
                const adm = r.admission_number.toLowerCase();
                const pin = r.pin_no ? r.pin_no.toLowerCase() : null;

                if (!allLinkedIdsMap[adm]) allLinkedIdsMap[adm] = new Set();
                allLinkedIdsMap[adm].add(adm);
                allLinkedIdsMap[adm].add(normAdm);

                if (pin) {
                    allLinkedIdsMap[adm].add(pin);
                    allLinkedIdsMap[adm].add(normPin);
                    // Also allow lookup by pin's lower case version
                    allLinkedIdsMap[pin] = allLinkedIdsMap[adm];
                }

                // Also link normalized version
                allLinkedIdsMap[normAdm] = allLinkedIdsMap[adm];
                if (normPin) allLinkedIdsMap[normPin] = allLinkedIdsMap[adm];
            });
            console.log(`Resolved internal map size: ${Object.keys(studentMap).length}`);
        }

        const newDemands = [];
        const demandsToDelete = [];
        const transactionDocs = [];
        const targetsToDelete = [];
        const unresolvedStudents = [];

        // Step 1: Fetch Existing Transactions for "Sync Check"
        // Note: The existingTx check is not strictly necessary for the "Purge and Replace" consistency logic
        // as we are deleting anyway. It would be useful if we wanted to implement a "delta" update.
        // For now, we'll remove the aggregation and map, as they are not used in the current logic.

        const parseDate = (val) => {
            if (!val) return new Date();
            return new Date(val);
        };

        students.forEach(stud => {
            const rawId = stud.displayId ? String(stud.displayId).trim() : null;
            if (!rawId) return;

            const normId = normalizeId(rawId);
            const lookupKey = rawId.toLowerCase();
            const finalStudentId = studentMap[normId] || studentMap[lookupKey] || rawId;

            if (finalStudentId === rawId && !studentMap[lookupKey]) {
                unresolvedStudents.push(`${stud.studentName} (${rawId})`);
            }

            // Comprehensive IDs to Clean (Both Resolved, Raw, and all linked IDs from SQL)
            const linkedIds = allLinkedIdsMap[finalStudentId.toLowerCase()] || new Set();
            linkedIds.add(finalStudentId.toLowerCase());
            linkedIds.add(rawId.toLowerCase());
            const idsToPurge = Array.from(linkedIds);

            // 1. Student Fees (Demands) - PURGE & REPLACE Logic
            // We skip demand updates if in Pending Mode (as we only want to record the payment)
            if (stud.demands && !pendingActive) {
                stud.demands.forEach(d => {
                    const dYear = Number(d.year);

                    demandsToDelete.push({
                        studentId: { $in: idsToPurge },
                        feeHead: d.headId,
                        studentYear: { $in: [dYear, String(dYear)] }
                        // We intentionally OMIT academicYear here. 
                        // If there's an old "Year 1" record from a wrong batch, we want it GONE.
                    });

                    // Only insert new demand if amount > 0
                    if (d.amount > 0) {
                        newDemands.push({
                            studentId: finalStudentId,
                            studentName: stud.studentName,
                            feeHead: d.headId,
                            academicYear: stud.batch,
                            studentYear: dYear,
                            semester: d.semester || 1, // Include Semester!
                            amount: d.amount,
                            college: stud.college,
                            course: stud.course,
                            branch: stud.branch,
                            batch: stud.batch,
                            stud_type: stud.category || 'Regular'
                        });
                    }
                });
            }

            // 2. Transactions (Payments) - SYNC & REPLACE Logic
            if (stud.payments) {
                stud.payments.forEach(p => {
                    const sYear = String(p.year);
                    const nYear = Number(p.year);

                    // "Fully Reupdate": Delete old, Insert New
                    // We do this UNCONDITIONALLY for every payment row in the Excel.
                    // If the amount is same but Date/Ref changed, this ensures update.
                    // If everything is same, it just re-writes it (Idempotent).

                    // DEBUG: One-time check for first student to see what we are trying to delete vs what exists
                    if (transactionDocs.length === 0) {
                        // Only for the very first transaction we process in this batch
                        console.log(`DEBUG CHECK: Preparing purge for Student ${finalStudentId} (Raw: ${rawId}), Head ${p.headId}, Year ${sYear}`);
                        console.log(`Purge Criteria IDs:`, idsToPurge);
                    }

                    // 1. Mark for Deletion (Batched)
                    // We handle both String and Number types for Year to catch any legacy data mismatch
                    targetsToDelete.push({
                        studentId: { $in: idsToPurge },
                        feeHead: p.headId,
                        // Broaden the delete scope: if `studentYear` is numeric 1 or string "1", or even "I" (roman)?
                        // Just stick to strict type match for now but ensure we cover both.
                        studentYear: { $in: [sYear, nYear, String(nYear), Number(sYear)] }
                    });

                    // 2. Insert New Record with Target Amount
                    // FIX: Only insert transaction if amount > 0.
                    if (p.amount > 0) {
                        transactionDocs.push({
                            studentId: finalStudentId,
                            studentName: stud.studentName,
                            feeHead: p.headId,
                            amount: p.amount,
                            transactionType: 'DEBIT',
                            paymentMode: p.mode || 'Cash',
                            paymentDate: parseDate(p.date),
                            referenceNo: p.ref || '',
                            receiptNumber: p.receipt || '',
                            remarks: p.remarks || `Bulk Upload - Yr ${sYear}`,
                            studentYear: sYear,
                            semester: p.semester || 1, // Include Semester!
                            collectedBy: user,
                            collectedByName: 'System Bulk Upload'
                        });
                    }
                });
            }
        });

        if (unresolvedStudents.length > 0) {
            console.warn(`Warning: ${unresolvedStudents.length} students used Raw IDs (could not map to SQL Admission No):`, unresolvedStudents.slice(0, 5));
        }

        if (demandsToDelete.length > 0) {
            console.log(`Deleting ${demandsToDelete.length} existing fee demands...`);
            try {
                await StudentFee.deleteMany({ $or: demandsToDelete });
            } catch (err) {
                console.error('Error deleting old demands:', err);
                throw new Error(`Failed to delete old demands: ${err.message}`);
            }
        }

        if (newDemands.length > 0) {
            console.log(`Inserting ${newDemands.length} new fee demands...`);
            // Dedup newDemands just in case of ID collision
            const uniqueDemands = [];
            const demandKeys = new Set();
            newDemands.forEach(d => {
                // Key: StudentID-FeeHead-Year-Batch-Semester
                const key = `${d.studentId}-${d.feeHead}-${d.studentYear}-${d.academicYear}-${d.semester}`;
                if (!demandKeys.has(key)) {
                    demandKeys.add(key);
                    uniqueDemands.push(d);
                } else {
                    console.warn(`Duplicate Demand Detected and Skipped: ${key}`);
                }
            });

            try {
                // Ordered: false allows continuing even if one fails (though we prefer all success)
                // But specifically for Duplicates, false is safer to at least save partial.
                await StudentFee.insertMany(uniqueDemands, { ordered: false });
            } catch (err) {
                // Ignore duplicate key errors if they somehow persist
                if (err.code === 11000) {
                    console.warn('Duplicate Key Error during Demand Insert (Ignored subset):', err.message);
                } else {
                    console.error('Error inserting new demands:', err);
                    throw new Error(`Failed to insert demands: ${err.message}`);
                }
            }
        }

        if (targetsToDelete.length > 0) {
            console.log(`Deleting existing payments matching ${targetsToDelete.length} criteria points...`);
            try {
                await Transaction.deleteMany({ $or: targetsToDelete });
            } catch (err) {
                console.error('Error deleting old transactions:', err);
                throw new Error(`Failed to delete old transactions: ${err.message}`);
            }
        }

        if (transactionDocs.length > 0) {
            console.log(`Inserting ${transactionDocs.length} new transactions...`);
            try {
                await Transaction.insertMany(transactionDocs, { ordered: false });
            } catch (err) {
                if (err.code === 11000) {
                    console.warn('Duplicate Key Error during Transaction Insert (Ignored subset):', err.message);
                } else {
                    console.error('Error inserting new transactions:', err);
                    throw new Error(`Failed to insert transactions: ${err.message}`);
                }
            }
        }

        console.log('Bulk save completed successfully.');
        res.json({
            message: `Processed ${students.length} students. Saved Demands & Payments.`,
            unresolvedCount: unresolvedStudents.length,
            unresolvedSample: unresolvedStudents.slice(0, 5)
        });

    } catch (error) {
        console.error('CRITICAL ERROR saving bulk data:', error);
        // Return explicit error message to frontend
        res.status(500).json({ message: `Error saving data: ${error.message}`, error: error.toString() });
    }
};

// @desc    Generate and Download Bulk Upload Template
// @route   GET /api/bulk-fee/template
const downloadTemplate = async (req, res) => {
    try {
        const { type } = req.query; // 'DUE' or 'PAYMENT'
        const feeHeads = await FeeHead.find({});

        // Define Headers
        const mainHeaders = ['Admission No', 'Pin No', 'Student Name', 'Course', 'Branch', 'Year'];

        if (type === 'DUE') {
            // DUES TEMPLATE: Simple Matrix (One column per Fee Head)
            feeHeads.forEach(head => {
                // Sanitize head name for header (remove special chars if needed, but keeping it simple is best)
                mainHeaders.push(head.name);
            });
            // No sub-headers needed for Dues in this simple matrix format
            const ws = xlsx.utils.aoa_to_sheet([mainHeaders]);

            // Set widths
            const wscols = [
                { wch: 15 }, { wch: 12 }, { wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 8 }
            ];
            feeHeads.forEach(() => wscols.push({ wch: 15 }));
            ws['!cols'] = wscols;

            const wb = xlsx.utils.book_new();
            xlsx.utils.book_append_sheet(wb, ws, 'Dues Template');
            const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Disposition', 'attachment; filename="BulkDuesTemplate.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);

        } else {
            // PAYMENTS TEMPLATE (Legacy/Detailed)
            const subHeaders = ['', '', '', '', '', ''];

            // Fee Heads Columns (6 per head)
            feeHeads.forEach(head => {
                mainHeaders.push(head.name, '', '', '', '', '');
                subHeaders.push('Paid', 'Mode', 'Date', 'Ref', 'Receipt', 'Remarks');
            });

            // Add Global columns
            mainHeaders.push('Global Default Mode', 'Global Default Date', 'Global Default Ref No', 'Global Default Receipt No', 'Global Default Remarks');
            subHeaders.push('', '', '', '', '');

            const wb = xlsx.utils.book_new();
            const wsData = [mainHeaders, subHeaders];
            const ws = xlsx.utils.aoa_to_sheet(wsData);

            // ... (Existing Merge Logic for Payment Template) ...
            const merges = [];
            merges.push({ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } });
            merges.push({ s: { r: 0, c: 1 }, e: { r: 1, c: 1 } });
            merges.push({ s: { r: 0, c: 2 }, e: { r: 1, c: 2 } });
            merges.push({ s: { r: 0, c: 3 }, e: { r: 1, c: 3 } });
            merges.push({ s: { r: 0, c: 4 }, e: { r: 1, c: 4 } });
            merges.push({ s: { r: 0, c: 5 }, e: { r: 1, c: 5 } });

            let colIdx = 6;
            feeHeads.forEach(() => {
                merges.push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + 5 } });
                colIdx += 6;
            });
            merges.push({ s: { r: 0, c: colIdx }, e: { r: 1, c: colIdx } });
            merges.push({ s: { r: 0, c: colIdx + 1 }, e: { r: 1, c: colIdx + 1 } });
            merges.push({ s: { r: 0, c: colIdx + 2 }, e: { r: 1, c: colIdx + 2 } });
            merges.push({ s: { r: 0, c: colIdx + 3 }, e: { r: 1, c: colIdx + 3 } });
            merges.push({ s: { r: 0, c: colIdx + 4 }, e: { r: 1, c: colIdx + 4 } });

            ws['!merges'] = merges;

            // Set column widths
            const wscols = [
                { wch: 15 }, { wch: 12 }, { wch: 25 }, { wch: 10 }, { wch: 10 }, { wch: 8 }
            ];
            feeHeads.forEach(() => {
                wscols.push({ wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 15 });
            });
            wscols.push({ wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 15 }, { wch: 20 });
            ws['!cols'] = wscols;

            xlsx.utils.book_append_sheet(wb, ws, 'Payment Template');
            const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

            res.setHeader('Content-Disposition', 'attachment; filename="BulkPaymentTemplate.xlsx"');
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            return res.send(buffer);
        }

    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ message: 'Error generating template' });
    }
};

module.exports = {
    processBulkUpload,
    saveBulkData,
    downloadTemplate
};
