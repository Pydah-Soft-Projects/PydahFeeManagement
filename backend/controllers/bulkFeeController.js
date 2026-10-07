const mongoose = require('mongoose');
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
            if (!h) return;
            const originalHead = String(h).toUpperCase().trim();
            const head = originalHead.replace(/[^A-Z0-9]/g, '');

            const isFeeKeyword = (originalHead.includes('FEE') || originalHead.includes('AMT') || originalHead.includes('AMOUNT') || originalHead.includes('DUE') || originalHead.includes('BAL') || originalHead.includes('PENDING'));

            const isIdHeader = (
                head.includes('ADMN') || head.includes('ADM') || head.includes('ADMISSION') || 
                head.includes('PIN') || head.includes('HTNO') || head.includes('HALLTICKET') || 
                head.includes('ROLL') || head.includes('REG') || head.includes('STUDENTNO') || 
                head.includes('STUDENTID') || head === 'PINNO' || head === 'ADMNNO' || head === 'ADMNO'
            );

            if (isIdHeader && !isFeeKeyword) {
                if (colMap.ADMISSION === undefined) {
                    colMap.ADMISSION = i;
                } else if (colMap.PIN === undefined && (head.includes('PIN') || head.includes('HTNO') || head.includes('ROLL'))) {
                    colMap.PIN = i;
                }
            }

            if (head.includes('NAME') && (head.includes('STUDENT') || originalHead.length < 20) && !isFeeKeyword) {
                if (colMap.NAME === undefined) colMap.NAME = i;
            }
            if (head.includes('YEAR') && !isFeeKeyword) colMap.YEAR = i;
            if ((head.includes('SEM') || head.includes('SEC') || head.includes('SEMESTER')) && !isFeeKeyword) colMap.SEM = i;
            if ((head === 'CATEGORY' || head === 'TYPE' || head === 'STUDENTTYPE' || head === 'STUDTYPE') && !isFeeKeyword) {
                if (colMap.CATEGORY === undefined) colMap.CATEGORY = i;
            }
            if ((head.includes('DATE') || head.includes('PAYDATE') || head.includes('TRANSDATE') || head.includes('RCPTDATE') || head.includes('PAYMENTDATE')) && colMap.DATE === undefined) {
                colMap.DATE = i;
            }
            if ((head.includes('MODE') || head.includes('PAYMODE') || head.includes('PAYMENTMODE')) && colMap.MODE === undefined) {
                colMap.MODE = i;
            }
            if ((head.includes('REF') || head.includes('RCPT') || head.includes('RECEIPT') || head.includes('TRANSACTION') || head.includes('TXN') || head.includes('CHQ') || head.includes('DD') || head.includes('CHEQUE')) && colMap.REF === undefined) {
                colMap.REF = i;
            }
            if ((head.includes('REMARK') || head.includes('NARRATION') || head.includes('NOTE') || head.includes('PARTICULAR')) && colMap.NARRATION === undefined) {
                colMap.NARRATION = i;
            }
            if ((head === 'AMOUNT' || head === 'PAIDAMOUNT' || head === 'TOTALAMOUNT' || head === 'NETAMOUNT' || head === 'AMT' || head === 'PAID' || head === 'PAIDAMT') && colMap.AMOUNT === undefined) {
                colMap.AMOUNT = i;
            }
            if ((head.includes('FEEHEAD') || head.includes('HEADNAME') || head === 'HEAD' || head === 'PARTICULARS' || head === 'FEEHEADNAME' || (head.includes('FEE') && head.includes('HEAD'))) && colMap.FEE_HEAD === undefined) {
                colMap.FEE_HEAD = i;
            }
        });

        // Fallback: If no ID column was identified by header text, default to Column 0
        if (colMap.ADMISSION === undefined && colMap.PIN === undefined) {
            colMap.ADMISSION = 0;
        }

        const feeHeadColMap = {};
        const mappedFeeHeads = [];
        const unmappedColumns = [];
        const allFeeColumns = [];

        const ABBREVIATIONS = {
            'ADM': 'ADMISSION',
            'ADMN': 'ADMISSION',
            'TRANFEE': 'TRANSPORT',
            'TRANSFEE': 'TRANSPORT',
            'TRANS': 'TRANSPORT',
            'VAN': 'TRANSPORT',
            'BUS': 'TRANSPORT',
            'TUTFEE': 'TUITION',
            'TUT': 'TUITION',
            'TUTION': 'TUITION',
            'CONFEE': 'CONDONATION',
            'CON': 'CONDONATION',
            'COND': 'CONDONATION',
            'PWBILL': 'HOSTELPOWERBILL',
            'PWB': 'HOSTELPOWERBILL',
            'POWERBILL': 'HOSTELPOWERBILL',
            'LABBREAKAGE': 'LABORATORY',
            'BREAKAGE': 'LABORATORY',
            'LABFEE': 'LABORATORY',
            'EXAMFEE': 'EXAM',
            'EXMNFEE': 'EXAM',
            'SCHFEE': 'SCH',
            'ADM': 'ADMISSION',
            'ADMN': 'ADMISSION',
            'ADMISS': 'ADMISSION',
            'APPL': 'APPLICATION',
            'APPLN': 'APPLICATION',
            'BOYSCATA': 'HOSTEL',
            'BOYSCATB': 'HOSTEL',
            'BOYSCATC': 'HOSTEL',
            'GIRLSCATA': 'HOSTEL',
            'GIRLSCATB': 'HOSTEL',
            'GIRLSCATC': 'HOSTEL',
            'MESSCATA': 'HOSTEL',
            'MESSCATB': 'HOSTEL',
            'HOSTEL': 'HOSTEL',
            'HSTL': 'HOSTEL',
            'OTHER': 'OTHER',
            'OTR': 'OTHER',
            'OTHERS': 'OTHER',
            'SPL': 'SPECIAL',
            'SPLFEE': 'SPECIAL',
            'CONVO': 'CONVOCATION',
            'FINES': 'FINE',
            'FINE': 'FINE',
            'GAMES': 'SPORTS',
            'PRACT': 'PRACTICAL',
            'PRACTFEE': 'PRACTICAL',
            'RATIFI': 'RATIFICATION',
            'RECORDS': 'RECORD',
            'RECORD': 'RECORD',
            'REFUND': 'REFUND',
            'UNIFM': 'UNIFORM',
            'UNIFFE': 'UNIFORM',
            'UNIF': 'UNIFORM',
            'UDF': 'DEVELOPMENT',
            'HACKREG': 'WORKSHOP',
            'WSREG': 'WORKSHOP',
            'PROJPANLFE': 'PROJECTPANEL',
            'PROJPANL': 'PROJECTPANEL',
            'REG': 'REGISTRATION',
            'REGN': 'REGISTRATION',
            'LIB': 'LIBRARY',
            'CERT': 'CERTIFICATE',
            'CERTFEE': 'CERTIFICATE',
            'CAUT': 'CAUTION',
            'CAUTION': 'CAUTION',
            'MISC': 'MISCELLANEOUS',
            'MISCEE': 'MISCELLANEOUS'
        };

        const matchFeeHeadByText = (rawText) => {
            if (!rawText) return { originalColName: '', cleanCol: '', normCol: '', matchedHead: null };
            const originalColName = String(rawText).trim();

            // Extract candidate sub-phrases by splitting on delimiters like -, /, :, _
            const parts = originalColName.split(/[-/:_]/).map(p => p.trim()).filter(Boolean);
            const candidates = [originalColName, ...parts];

            let matchedHead = null;

            for (const cand of candidates) {
                if (matchedHead) break;

                let cleanCol = cand
                    .replace(/[\s_\-]*DUE(S)?$/i, '')
                    .replace(/[\s_\-]*PAID$/i, '')
                    .replace(/[\s_\-]*RECEIPT(S)?$/i, '')
                    .replace(/[\s_\-]*FEE(S)?$/i, '')
                    .trim();

                let normCol = cleanCol.toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (!normCol) continue;

                let expandedNorm = ABBREVIATIONS[normCol] || normCol;

                // 1. Direct / Alias Match
                allFeeHeads.forEach(fh => {
                    if (matchedHead) return;
                    const fhNameNorm = fh.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    const fhAliasNorm = fh.alias ? fh.alias.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

                    if (
                        normCol === fhNameNorm || 
                        expandedNorm === fhNameNorm || 
                        (fhAliasNorm && (normCol === fhAliasNorm || expandedNorm === fhAliasNorm))
                    ) {
                        matchedHead = fh;
                    }
                });

                // 2. Substring Inclusions
                if (!matchedHead) {
                    allFeeHeads.forEach(fh => {
                        if (matchedHead) return;
                        const fhNameNorm = fh.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        const fhAliasNorm = fh.alias ? fh.alias.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

                        if (normCol.length >= 3 && expandedNorm.length >= 3) {
                            if (
                                (fhNameNorm.length >= 3 && (fhNameNorm.includes(normCol) || normCol.includes(fhNameNorm) || fhNameNorm.includes(expandedNorm) || expandedNorm.includes(fhNameNorm))) ||
                                (fhAliasNorm && fhAliasNorm.length >= 3 && (normCol.includes(fhAliasNorm) || fhAliasNorm.includes(normCol) || expandedNorm.includes(fhAliasNorm)))
                            ) {
                                matchedHead = fh;
                            }
                        }
                    });
                }

                // 3. Similarity Score
                if (!matchedHead) {
                    let bestScore = 0;
                    allFeeHeads.forEach(fh => {
                        const fhNameNorm = fh.name.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        const fhAliasNorm = fh.alias ? fh.alias.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';

                        const scoreName = Math.max(calculateSimilarity(normCol, fhNameNorm), calculateSimilarity(expandedNorm, fhNameNorm));
                        const scoreAlias = fhAliasNorm ? Math.max(calculateSimilarity(normCol, fhAliasNorm), calculateSimilarity(expandedNorm, fhAliasNorm)) : 0;
                        const maxScore = Math.max(scoreName, scoreAlias);

                        if (maxScore > 0.65 && maxScore > bestScore) {
                            bestScore = maxScore;
                            matchedHead = fh;
                        }
                    });
                }
            }

            const cleanCol = originalColName;
            const normCol = originalColName.toUpperCase().replace(/[^A-Z0-9]/g, '');
            return { originalColName, cleanCol, normCol, matchedHead };
        };

        for (let i = 0; i < row0.length; i++) {
            const h = row0[i];
            if (!h) continue;

            const isMappedSystemCol = Object.values(colMap).includes(i);
            if (isMappedSystemCol) continue;

            const originalHead = String(h).toUpperCase().trim();
            const head = originalHead.replace(/[^A-Z0-9]/g, '');

            const isKnownIgnoredHeader = (
                head.includes('SLNO') || head.includes('SNO') || head === 'NO' || head === 'SERIAL' ||
                head.includes('CLASS') || head.includes('CLASSID') || head.includes('BRANCH') || 
                head.includes('COURSE') || head.includes('DEPT') || head.includes('DEPARTMENT') ||
                head.includes('SECTION') || head.includes('SECID') || head.includes('NAMES') || head.includes('NAME') ||
                head.includes('DATE') || head.includes('REF') || head.includes('MODE') || head.includes('AMOUNT') || head.includes('AMT')
            );
            if (isKnownIgnoredHeader) continue;

            const { originalColName, cleanCol, matchedHead } = matchFeeHeadByText(h);
            if (!cleanCol) continue;

            if (matchedHead) {
                if (!feeHeadColMap[matchedHead.name]) feeHeadColMap[matchedHead.name] = [];
                feeHeadColMap[matchedHead.name].push(i);
                mappedFeeHeads.push({
                    excelColumn: originalColName,
                    feeHeadId: matchedHead._id.toString(),
                    feeHeadName: matchedHead.name
                });
            } else {
                unmappedColumns.push({
                    excelColumn: originalColName,
                    cleanedHeader: cleanCol,
                    reason: `No system Fee Head in database matches '${cleanCol}'`
                });
            }

            allFeeColumns.push({
                excelColumn: originalColName,
                cleanedHeader: cleanCol,
                status: matchedHead ? 'MAPPED' : 'UNMAPPED',
                mappedTo: matchedHead ? matchedHead.name : null
            });
        }

        if (colMap.FEE_HEAD !== undefined) {
            const uniqueRowFeeHeads = new Set();
            for (let r = 1; r < rawData.length; r++) {
                const row = rawData[r];
                if (row && row[colMap.FEE_HEAD] !== undefined && row[colMap.FEE_HEAD] !== null) {
                    const text = String(row[colMap.FEE_HEAD]).trim();
                    if (text) uniqueRowFeeHeads.add(text);
                }
            }

            uniqueRowFeeHeads.forEach(rawText => {
                const { originalColName, cleanCol, matchedHead } = matchFeeHeadByText(rawText);
                if (!cleanCol) return;

                if (matchedHead) {
                    mappedFeeHeads.push({
                        excelColumn: `Fee Head: ${originalColName}`,
                        feeHeadId: matchedHead._id.toString(),
                        feeHeadName: matchedHead.name
                    });
                } else {
                    unmappedColumns.push({
                        excelColumn: `Fee Head: ${originalColName}`,
                        cleanedHeader: cleanCol,
                        reason: `No system Fee Head in database matches '${cleanCol}'`
                    });
                }

                allFeeColumns.push({
                    excelColumn: `Fee Head: ${originalColName}`,
                    cleanedHeader: cleanCol,
                    status: matchedHead ? 'MAPPED' : 'UNMAPPED',
                    mappedTo: matchedHead ? matchedHead.name : null
                });
            });
        }

        // Scan rows for Section Header Titles (e.g. BOYSCATB / HOSTEL FEE BOYS CAT B)
        const uniqueSectionTitles = new Set();
        for (let r = 0; r < rawData.length; r++) {
            const row = rawData[r];
            if (!row || row.length === 0) continue;
            const rowStr = row.map(c => c ? String(c).toLowerCase().trim() : '').join(' ');
            if (rowStr.includes('total') || rowStr.includes('subtotal') || (rowStr.includes('transdate') && rowStr.includes('admnno'))) continue;

            const admVal = (colMap.ADMISSION !== undefined && row[colMap.ADMISSION]) ? String(row[colMap.ADMISSION]).trim() : '';
            const pinVal = (colMap.PIN !== undefined && row[colMap.PIN]) ? String(row[colMap.PIN]).trim() : '';

            const hasValidId = (admVal && admVal.length >= 4 && normalizeId(admVal) !== 'admnno' && normalizeId(admVal) !== 'slno') ||
                               (pinVal && pinVal.length >= 4 && normalizeId(pinVal) !== 'pinno' && normalizeId(pinVal) !== 'slno');

            if (!hasValidId) {
                for (let c = 0; c < Math.min(row.length, 5); c++) {
                    const text = row[c] ? String(row[c]).trim() : '';
                    if (text && text.length >= 3 && !text.match(/^\d+$/) && !text.toLowerCase().includes('total') && !text.toLowerCase().includes('transdate') && !text.toLowerCase().includes('admnno') && !text.toLowerCase().includes('slno')) {
                        uniqueSectionTitles.add(text);
                        break;
                    }
                }
            }
        }

        uniqueSectionTitles.forEach(rawText => {
            const { originalColName, cleanCol, matchedHead } = matchFeeHeadByText(rawText);
            if (!cleanCol) return;

            const exists = allFeeColumns.some(c => c.excelColumn === `Section: ${originalColName}`);
            if (!exists) {
                if (matchedHead) {
                    mappedFeeHeads.push({
                        excelColumn: `Section: ${originalColName}`,
                        feeHeadId: matchedHead._id.toString(),
                        feeHeadName: matchedHead.name
                    });
                } else {
                    unmappedColumns.push({
                        excelColumn: `Section: ${originalColName}`,
                        cleanedHeader: cleanCol,
                        reason: `No system Fee Head in database matches '${cleanCol}'`
                    });
                }

                allFeeColumns.push({
                    excelColumn: `Section: ${originalColName}`,
                    cleanedHeader: cleanCol,
                    status: matchedHead ? 'MAPPED' : 'UNMAPPED',
                    mappedTo: matchedHead ? matchedHead.name : null
                });
            }
        });

        if (colMap.ADMISSION === undefined && colMap.PIN === undefined && Object.keys(feeHeadColMap).length === 0 && colMap.FEE_HEAD === undefined) {
            return res.status(400).json({ message: 'File missing critical student identification column (Admission No or Pin No). Please check your headers.' });
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
                SELECT admission_number, pin_no, student_name, batch, college, course, branch, current_year, stud_type, student_status
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
            // Extract the first digit (e.g. 31 -> 3, 21 -> 2, 11 -> 1, 41 -> 4, 3 -> 3)
            const m = s.match(/^(\d)/);
            if (m) {
                const y = parseInt(m[1]);
                if (y >= 1 && y <= 4) return y;
            }
            if (s.match(/I$|1/i) && s.length < 3) return 1;
            if (s.match(/II$|2/i) && s.length < 3) return 2;
            if (s.match(/III$|3/i) && s.length < 4) return 3;
            if (s.match(/IV$|4/i) && s.length < 4) return 4;
            const n = parseInt(s);
            return (!isNaN(n) && n >= 1 && n <= 4) ? n : 1;
        };
        const parseDate = (xlsDate) => {
            if (!xlsDate) return new Date();
            if (typeof xlsDate === 'number') return new Date((xlsDate - 25569) * 86400 * 1000);
            const s = String(xlsDate).trim();

            // Slashes (/) -> DD/MM/YYYY (or DD/MM/YY)
            if (s.includes('/')) {
                const parts = s.split('/');
                if (parts.length >= 3) {
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10) - 1; // 0-indexed month
                    let year = parseInt(parts[2], 10);
                    if (year < 100) year += 2000;
                    const d = new Date(year, month, day);
                    if (!isNaN(d.getTime())) return d;
                }
            }

            // Hyphens (-) -> MM-DD-YYYY (or MM-DD-YY)
            if (s.includes('-')) {
                const parts = s.split('-');
                if (parts.length >= 3) {
                    const month = parseInt(parts[0], 10) - 1; // 0-indexed month
                    const day = parseInt(parts[1], 10);
                    let year = parseInt(parts[2], 10);
                    if (year < 100) year += 2000;
                    const d = new Date(year, month, day);
                    if (!isNaN(d.getTime())) return d;
                }
            }

            const attempt = new Date(s);
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
        let activeSectionHead = null;

        // --- PHASE 3: PROCESSING & GROUPING ---
        for (let r = 1; r < rawData.length; r++) {
            const row = rawData[r];
            if (!row || row.length === 0) continue;

            const rowStr = row.map(cell => cell ? String(cell).toLowerCase().trim() : '').join(' ');
            if (rowStr.includes('total') || rowStr.includes('subtotal') || rowStr.includes('grand total')) {
                skippedRows++;
                continue;
            }

            // Skip header repeats
            if (rowStr.includes('transdate') && (rowStr.includes('admnno') || rowStr.includes('slno'))) {
                skippedRows++;
                continue;
            }

            let rawId = null;
            if (colMap.ADMISSION !== undefined && row[colMap.ADMISSION]) rawId = row[colMap.ADMISSION];
            if (!rawId && colMap.PIN !== undefined && row[colMap.PIN]) rawId = row[colMap.PIN];
            if (!rawId && colMap.ID !== undefined && row[colMap.ID]) rawId = row[colMap.ID];

            const normRawId = rawId ? normalizeId(rawId) : '';
            const isHeaderTitleRow = !rawId || normRawId === 'admnno' || normRawId === 'admissionno' || normRawId === 'pinno' || normRawId.includes('total') || normRawId === 'slno' || normRawId === 'sno';

            if (isHeaderTitleRow) {
                // Check if this row represents a Section Title (e.g. BOYSCATB / HOSTEL FEE BOYS CAT B)
                for (let c = 0; c < Math.min(row.length, 5); c++) {
                    const cellVal = row[c] ? String(row[c]).trim() : '';
                    if (cellVal && cellVal.length >= 3 && !cellVal.match(/^\d+$/) && !cellVal.toLowerCase().includes('total')) {
                        const matchRes = matchFeeHeadByText(cellVal);
                        if (matchRes.matchedHead) {
                            activeSectionHead = matchRes.matchedHead;
                        }
                        break;
                    }
                }
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
                const dbCurrYr = sInfo && sInfo.current_year ? parseYear(sInfo.current_year) : null;
                previewDataMap.set(canonId, {
                    id: r, displayId: canonId, studentName: name, totalDemand: 0, totalPaid: 0, demands: [], payments: [],
                    year: year, semester: semester, admissionNumber: sInfo ? sInfo.admission_number : null,
                    pinNumber: sInfo ? sInfo.pin_no : null, college: sInfo ? sInfo.college : 'Unknown',
                    course: sInfo ? sInfo.course : 'Unknown', branch: sInfo ? sInfo.branch : 'Unknown',
                    batch: sInfo ? sInfo.batch : '2024-2025', category: category,
                    dbCurrentYear: dbCurrYr
                });
            }
            const entry = previewDataMap.get(canonId);

            // Check DB Student Current Year & Detained / Regular status
            const dbCurrentYear = sInfo && sInfo.current_year ? parseYear(sInfo.current_year) : null;
            const dbStatusText = sInfo ? (String(sInfo.student_status || '') + ' ' + String(sInfo.stud_type || '')) : '';
            const excelCategoryText = colMap.CATEGORY !== undefined && row[colMap.CATEGORY] ? String(row[colMap.CATEGORY]) : '';
            const fullStatusText = (dbStatusText + ' ' + String(category || '') + ' ' + excelCategoryText).toLowerCase();
            const isDetained = fullStatusText.includes('detain') || fullStatusText.includes('det') || fullStatusText.includes('dt') || fullStatusText.includes('d-');

            const defaultAmount = colMap.AMOUNT !== undefined ? (parseFloat(row[colMap.AMOUNT]) || 0) : 0;
            if (uploadType === 'DUE') {
                // Year Skip Rules:
                // 1. Regular students (!isDetained): Skip rows where year >= dbCurrentYear (current and future years).
                // 2. Detained students (isDetained): Allow current year (year <= dbCurrentYear), but Skip rows where year > dbCurrentYear (greater/future years).
                const shouldSkipRow = dbCurrentYear ? (isDetained ? (year > dbCurrentYear) : (year >= dbCurrentYear)) : false;

                if (shouldSkipRow) {
                    console.log(`[SKIP] ${isDetained ? 'Detained' : 'Regular'} student ${canonId}: Skipped year ${year} demand row (DB Current Year: ${dbCurrentYear})`);
                } else {
                    let matrixFound = false;
                Object.keys(feeHeadColMap).forEach(headName => {
                    const isTransportHead = headName.toLowerCase().includes('transport');
                    const colIndices = feeHeadColMap[headName];
                    let totalHeadVal = 0;
                    let hasExplicitZero = false;

                    if (Array.isArray(colIndices)) {
                        colIndices.forEach(idx => {
                            const val = parseFloat(row[idx]);
                            if (!isNaN(val)) {
                                if (val > 0) totalHeadVal += val;
                                else if (val === 0) hasExplicitZero = true;
                            }
                        });
                    } else {
                        const val = parseFloat(row[colIndices]);
                        if (!isNaN(val)) {
                            if (val > 0) totalHeadVal = val;
                            else if (val === 0) hasExplicitZero = true;
                        }
                    }

                    if (totalHeadVal > 0) {
                        matrixFound = true;
                        const headObj = allFeeHeads.find(h => h.name === headName);
                        const targetHeadId = headObj ? headObj._id.toString() : 'UNKNOWN';

                        const existingDemand = entry.demands.find(d => d.headId === targetHeadId && d.year === year && d.semester === semester);
                        if (existingDemand) {
                            existingDemand.amount += totalHeadVal;
                        } else {
                            entry.demands.push({
                                headId: targetHeadId,
                                headName: headName, year: year, semester: semester, amount: totalHeadVal
                            });
                        }
                        entry.totalDemand += totalHeadVal;
                    } else if (totalHeadVal === 0 && hasExplicitZero && isTransportHead && dbCurrentYear && year < dbCurrentYear) {
                        // Transport Fee explicitly set to 0 in Excel for a previous academic year
                        matrixFound = true;
                        const headObj = allFeeHeads.find(h => h.name === headName);
                        const targetHeadId = headObj ? headObj._id.toString() : 'UNKNOWN';

                        const existingDemand = entry.demands.find(d => d.headId === targetHeadId && d.year === year && d.semester === semester);
                        if (!existingDemand) {
                            entry.demands.push({
                                headId: targetHeadId,
                                headName: headName, year: year, semester: semester, amount: 0,
                                isTransportZeroUpdate: true
                            });
                        }
                    }
                });
                if (!matrixFound && defaultAmount > 0) {
                    let matchedHead = null;
                    if (colMap.FEE_HEAD !== undefined && row[colMap.FEE_HEAD]) {
                        const feeHeadText = String(row[colMap.FEE_HEAD]).trim();
                        const matchRes = matchFeeHeadByText(feeHeadText);
                        matchedHead = matchRes.matchedHead;
                    }
                    const headObj = matchedHead || miscHead;
                    entry.demands.push({
                        headId: headObj ? headObj._id.toString() : 'UNKNOWN',
                        headName: headObj ? headObj.name : 'Miscellaneous Due',
                        year: year, semester: semester, amount: defaultAmount
                    });
                    entry.totalDemand += defaultAmount;
                }
                }
            } else {
                let paymentMatrixFound = false;
                Object.keys(feeHeadColMap).forEach(headName => {
                    const colIndices = feeHeadColMap[headName];
                    let totalHeadVal = 0;

                    if (Array.isArray(colIndices)) {
                        colIndices.forEach(idx => {
                            const val = parseFloat(row[idx]);
                            if (!isNaN(val) && val > 0) totalHeadVal += val;
                        });
                    } else {
                        const val = parseFloat(row[colIndices]);
                        if (!isNaN(val) && val > 0) totalHeadVal = val;
                    }

                    if (totalHeadVal > 0) {
                        paymentMatrixFound = true;
                        const headObj = allFeeHeads.find(h => h.name === headName);
                        const targetHeadId = headObj ? headObj._id.toString() : 'UNKNOWN';

                        const rawMode = colMap.MODE !== undefined ? String(row[colMap.MODE] || '').trim().toLowerCase() : '';
                        const payMode = rawMode.includes('bank') ? 'Bank' : 'Cash';
                        const transDate = colMap.DATE !== undefined ? parseDate(row[colMap.DATE]) : new Date();
                        const ref = colMap.REF !== undefined ? String(row[colMap.REF] || '').trim() : '';
                        const narration = colMap.NARRATION !== undefined ? String(row[colMap.NARRATION] || '').trim() : '';

                        entry.payments.push({
                            headId: targetHeadId,
                            headName: headName,
                            year: year,
                            semester: semester,
                            amount: totalHeadVal,
                            mode: payMode,
                            date: transDate,
                            ref: ref,
                            remarks: narration || `Bulk Payment - Yr ${year}`
                        });
                        entry.totalPaid += totalHeadVal;
                    }
                });

                if (!paymentMatrixFound) {
                    const defaultAmount = colMap.AMOUNT !== undefined ? (parseFloat(row[colMap.AMOUNT]) || 0) : 0;
                    if (defaultAmount > 0) {
                        let matchedHead = null;
                        if (colMap.FEE_HEAD !== undefined && row[colMap.FEE_HEAD]) {
                            const feeHeadText = String(row[colMap.FEE_HEAD]).trim();
                            const matchRes = matchFeeHeadByText(feeHeadText);
                            matchedHead = matchRes.matchedHead;
                        }

                        // Use row matched head || active section header || fallback head
                        const headObj = matchedHead || activeSectionHead || (allFeeHeads.find(h => h.name.toLowerCase().includes('tuition')) || allFeeHeads[0]);

                        // Mode & Ref No Rule:
                        // If RefNo column has a value -> Bank mode, ref = RefNo. Else -> Cash mode, ref = ''.
                        let refVal = colMap.REF !== undefined && row[colMap.REF] !== undefined && row[colMap.REF] !== null ? String(row[colMap.REF]).trim() : '';
                        let payMode = 'Cash';
                        if (refVal && refVal !== '' && refVal.toLowerCase() !== 'undefined' && refVal.toLowerCase() !== 'null') {
                            payMode = 'Bank';
                        } else {
                            refVal = '';
                            payMode = 'Cash';
                        }

                        const transDate = colMap.DATE !== undefined ? parseDate(row[colMap.DATE]) : new Date();
                        const narration = colMap.NARRATION !== undefined ? String(row[colMap.NARRATION] || '').trim() : '';

                        entry.payments.push({
                            headId: headObj ? headObj._id.toString() : 'UNKNOWN',
                            headName: headObj ? headObj.name : 'General Fee',
                            year: year,
                            semester: semester,
                            amount: defaultAmount,
                            mode: payMode,
                            date: transDate,
                            ref: refVal,
                            remarks: narration || `Bulk Payment - Yr ${year}`
                        });
                        entry.totalPaid += defaultAmount;
                    }
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
                Transaction.find({ studentId: { $in: uniqueQueryIds }, status: { $ne: 'cancelled' } }).select('studentId feeHead amount studentYear transactionType')
            ]);

            const sysDemandMap = {}; // Key: normalizedId-feeHead-studentYear
            const sysPaidMap = {};   // Key: normalizedId-feeHead-studentYear

            existingDemands.forEach(d => {
                const normId = normalizeId(d.studentId);
                const key = `${normId}-${d.feeHead}-${d.studentYear}`;
                sysDemandMap[key] = (sysDemandMap[key] || 0) + (Number(d.amount) || 0);
            });

            existingPayments.forEach(t => {
                if (t.transactionType !== 'CREDIT') {
                    const normId = normalizeId(t.studentId);
                    const key = `${normId}-${t.feeHead}-${t.studentYear}`;
                    sysPaidMap[key] = (sysPaidMap[key] || 0) + (Number(t.amount) || 0);
                }
            });

            // Fetch base FeeStructure as fallback
            const contexts = previewData.map(e => ({
                college: e.college, course: e.course, branch: e.branch, batch: e.batch, category: e.category, studentYear: e.year
            }));
            const uniqueContexts = contexts.filter((v, i, a) => a.findIndex(t => t.college === v.college && t.course === v.course && t.branch === v.branch && t.batch === v.batch && t.category === v.category && t.studentYear === v.studentYear) === i);

            const baseFeeStructures = uniqueContexts.length > 0 ? await FeeStructure.find({
                $or: uniqueContexts.map(c => ({
                    college: c.college, course: c.course, branch: c.branch, batch: c.batch, category: c.category, studentYear: c.studentYear
                }))
            }) : [];

            const baseFeeMap = {}; // Key: college-course-branch-batch-category-studentYear-feeHead
            baseFeeStructures.forEach(fs => {
                const key = `${fs.college}-${fs.course}-${fs.branch}-${fs.batch}-${fs.category}-${fs.studentYear}-${fs.feeHead}`;
                baseFeeMap[key] = fs.amount;
            });

            previewData.forEach(entry => {
                if (!entry.admissionNumber) return;
                const normEntryId = normalizeId(entry.admissionNumber);
                const isPendingActive = isPendingMode === 'true';

                if (uploadType === 'PAYMENT') {
                    // For PAYMENT upload, preview displays uploaded transactions in entry.payments.
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
                });
            });

            // Check missing previous years for Transport Fee zeroing if StudentFee demand exists in DB
            if (uploadType === 'DUE') {
                const transportHead = allFeeHeads.find(h => 
                    h.name.toLowerCase() === 'transport fee' || 
                    h.name.toLowerCase().includes('transport')
                );

                if (transportHead) {
                    previewData.forEach(entry => {
                        if (!entry.admissionNumber && !entry.displayId) return;
                        const normEntryId = normalizeId(entry.admissionNumber || entry.displayId);
                        const dbCurrYr = entry.dbCurrentYear;

                        if (dbCurrYr && dbCurrYr > 1) {
                            for (let y = 1; y < dbCurrYr; y++) {
                                // Check if Excel already provided a demand for Transport Fee in year y
                                const alreadyProvided = entry.demands && entry.demands.some(d => 
                                    String(d.headId) === String(transportHead._id) && Number(d.year) === y
                                );

                                if (!alreadyProvided) {
                                    // Check if a StudentFee demand exists in DB for this student + Transport Fee + year y
                                    const hasExistingDbDemand = existingDemands.some(ed => 
                                        normalizeId(ed.studentId) === normEntryId &&
                                        String(ed.feeHead) === String(transportHead._id) &&
                                        Number(ed.studentYear) === y
                                    );

                                    if (hasExistingDbDemand) {
                                        if (!entry.demands) entry.demands = [];
                                        const key = `${normEntryId}-${transportHead._id}-${y}`;
                                        const totalFee = sysDemandMap[key] || 0;
                                        const paidInSys = sysPaidMap[key] || 0;

                                        entry.demands.push({
                                            headId: String(transportHead._id),
                                            headName: transportHead.name,
                                            year: y,
                                            semester: 1,
                                            amount: 0,
                                            isTransportZeroUpdate: true,
                                            allotted: totalFee,
                                            meta: {
                                                totalDemand: totalFee,
                                                totalPaid: paidInSys,
                                                systemDue: totalFee - paidInSys,
                                                pendingAmount: 0
                                            }
                                        });
                                    }
                                }
                            }
                        }
                    });
                }
            }
        }

        const activeFeeHeads = new Set();
        previewData.forEach(entry => {
            if (uploadType === 'PAYMENT') {
                if (entry.payments) entry.payments.forEach(p => { if (p.amount > 0) activeFeeHeads.add(p.headName); });
            } else {
                if (entry.demands) entry.demands.forEach(d => { if (d.amount > 0 || d.isTransportZeroUpdate) activeFeeHeads.add(d.headName); });
            }
        });

        res.json({
            message: `Parsed ${processedCount} records (${skippedRows} skipped).`,
            count: previewData.length, totalRows: rawData.length - 1, skippedRows: skippedRows,
            data: previewData, feeHeads: Array.from(activeFeeHeads),
            mappingSummary: {
                mapped: mappedFeeHeads,
                unmapped: unmappedColumns,
                allFeeColumns: allFeeColumns,
                systemFeeHeads: allFeeHeads.map(fh => fh.name)
            }
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
        const allFeeHeads = await FeeHead.find({});
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

        const demandBulkOps = [];
        const transactionDocs = [];
        const targetsToDelete = [];
        const unresolvedStudents = [];

        // Step 1: Fetch Existing Transactions for "Sync Check"
        // Note: The existingTx check is not strictly necessary for the "Purge and Replace" consistency logic
        // as we are deleting anyway. It would be useful if we wanted to implement a "delta" update.
        // For now, we'll remove the aggregation and map, as they are not used in the current logic.

        const parseDate = (val) => {
            if (!val) return new Date();
            if (typeof val === 'number') return new Date((val - 25569) * 86400 * 1000);
            const s = String(val).trim();

            if (s.includes('/')) {
                const parts = s.split('/');
                if (parts.length >= 3) {
                    const day = parseInt(parts[0], 10);
                    const month = parseInt(parts[1], 10) - 1;
                    let year = parseInt(parts[2], 10);
                    if (year < 100) year += 2000;
                    const d = new Date(year, month, day);
                    if (!isNaN(d.getTime())) return d;
                }
            }

            if (s.includes('-')) {
                const parts = s.split('-');
                if (parts.length >= 3) {
                    const month = parseInt(parts[0], 10) - 1;
                    const day = parseInt(parts[1], 10);
                    let year = parseInt(parts[2], 10);
                    if (year < 100) year += 2000;
                    const d = new Date(year, month, day);
                    if (!isNaN(d.getTime())) return d;
                }
            }

            const attempt = new Date(s);
            return isNaN(attempt.getTime()) ? new Date() : attempt;
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

            // 1. Student Fees (Demands) - UPDATE / UPSERT Logic
            // If a demand for this feeHead + year already exists in MongoDB, UPDATE it with new amount.
            // If it does not exist, INSERT it as a new demand.
            if (stud.demands && !pendingActive) {
                stud.demands.forEach(d => {
                    const dYear = Number(d.year);
                    const headObjId = mongoose.Types.ObjectId.isValid(d.headId) ? new mongoose.Types.ObjectId(d.headId) : d.headId;
                    const isTransportHead = d.headName ? d.headName.toLowerCase().includes('transport') : false;

                    if (d.amount > 0) {
                        demandBulkOps.push({
                            updateOne: {
                                filter: {
                                    studentId: { $in: idsToPurge },
                                    feeHead: headObjId,
                                    studentYear: { $in: [dYear, String(dYear)] }
                                },
                                update: {
                                    $set: {
                                        studentId: finalStudentId,
                                        studentName: stud.studentName,
                                        feeHead: headObjId,
                                        academicYear: stud.batch,
                                        studentYear: dYear,
                                        semester: d.semester || 1,
                                        amount: d.amount,
                                        college: stud.college,
                                        course: stud.course,
                                        branch: stud.branch,
                                        batch: stud.batch,
                                        stud_type: stud.category || 'Regular'
                                    }
                                },
                                upsert: true
                            }
                        });
                    } else if (d.amount === 0 && (d.isTransportZeroUpdate || isTransportHead)) {
                        // Update existing Transport Fee demand in MongoDB to 0 if it already exists
                        demandBulkOps.push({
                            updateOne: {
                                filter: {
                                    studentId: { $in: idsToPurge },
                                    feeHead: headObjId,
                                    studentYear: { $in: [dYear, String(dYear)] }
                                },
                                update: {
                                    $set: {
                                        amount: 0,
                                        remarks: 'Transport Fee updated to 0 via Bulk Upload'
                                    }
                                },
                                upsert: false // DO NOT create new demand if it didn't exist before!
                            }
                        });
                    }
                });
            }

            // Fallback: For missing previous years of matched students, ensure existing Transport Fee demands in DB are updated to 0
            const transportHead = allFeeHeads.find(h => 
                h.name.toLowerCase() === 'transport fee' || 
                h.name.toLowerCase().includes('transport')
            );
            const sInfo = studentMap[finalStudentId.toLowerCase()] ? studentMap[finalStudentId.toLowerCase()] : null;
            const dbCurrYr = sInfo && sInfo.current_year ? parseYear(sInfo.current_year) : (stud.dbCurrentYear ? Number(stud.dbCurrentYear) : null);

            if (transportHead && dbCurrYr && dbCurrYr > 1 && !pendingActive) {
                for (let y = 1; y < dbCurrYr; y++) {
                    const existsInDemands = stud.demands && stud.demands.some(d => 
                        String(d.headId) === String(transportHead._id) && Number(d.year) === y
                    );
                    if (!existsInDemands) {
                        demandBulkOps.push({
                            updateOne: {
                                filter: {
                                    studentId: { $in: idsToPurge },
                                    feeHead: transportHead._id,
                                    studentYear: { $in: [y, String(y)] }
                                },
                                update: {
                                    $set: {
                                        amount: 0,
                                        remarks: 'Transport Fee updated to 0 via Bulk Upload (Missing previous year in Excel)'
                                    }
                                },
                                upsert: false
                            }
                        });
                    }
                }
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
                    // CRITICAL FIX: Only delete previous payment receipts (DEBIT).
                    // NEVER delete or touch Concession / Scholarship / Proceeding transactions (CREDIT)!
                    targetsToDelete.push({
                        studentId: { $in: idsToPurge },
                        feeHead: p.headId,
                        transactionType: 'DEBIT',
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

        if (demandBulkOps.length > 0) {
            console.log(`Upserting (updating existing / creating new) ${demandBulkOps.length} fee demands in MongoDB...`);
            try {
                await StudentFee.bulkWrite(demandBulkOps);
            } catch (err) {
                console.error('Error updating fee demands:', err);
                throw new Error(`Failed to update fee demands: ${err.message}`);
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
