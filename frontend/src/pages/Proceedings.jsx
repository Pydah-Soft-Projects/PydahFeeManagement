import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';
import Swal from 'sweetalert2';
import Sidebar from './Sidebar';
import { FileText, Search, Trash2, Edit2, Calendar, DollarSign, GraduationCap, Users, ChevronDown, User, CheckCircle, ShieldCheck, Printer, Loader2, Eye, X, BarChart3, ChevronRight, ChevronLeft, Upload, AlertTriangle, ArrowUp, ArrowDown, Paperclip } from 'lucide-react';
import * as XLSX from 'xlsx';
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { printHtmlDocument } from '../utils/printService';

// Polyfills for older browsers (Chrome < 128 on Win7/older OS, Safari < 17.4, Firefox < 121)
if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
}
if (typeof Promise.try !== 'function') {
    Promise.try = function (fn, ...args) {
        return new Promise((resolve) => resolve(fn(...args)));
    };
}
if (typeof Number.prototype.toHex !== 'function') {
    Number.prototype.toHex = function (minDigits = 1) {
        let hex = Math.floor(Math.abs(this)).toString(16);
        while (hex.length < minDigits) {
            hex = '0' + hex;
        }
        return hex;
    };
}

/**
 * Production hosts (e.g. nginx without .mjs types) often serve .mjs as
 * application/octet-stream. Browsers then refuse module workers.
 * Fetch the worker bytes and expose them via a blob URL with a JS MIME type.
 * Note: In Vite dev mode, fetching pdfWorkerSrc returns code transformed by Vite containing "/@vite/client",
 * which fails inside a Blob worker. In dev mode, we fallback to jsDelivr CDN worker URL.
 */
let pdfWorkerReady = null;
const ensurePdfWorker = () => {
    if (GlobalWorkerOptions.workerSrc) {
        return Promise.resolve();
    }
    if (!pdfWorkerReady) {
        pdfWorkerReady = (async () => {
            if (import.meta.env.DEV) {
                GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion || '4.10.38'}/build/pdf.worker.min.mjs`;
                return;
            }
            try {
                const res = await fetch(pdfWorkerSrc);
                if (!res.ok) throw new Error(`Failed to load PDF worker (${res.status})`);
                const code = await res.text();
                const blob = new Blob([code], { type: 'application/javascript' });
                GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
            } catch (err) {
                GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsVersion || '4.10.38'}/build/pdf.worker.min.mjs`;
            }
        })().catch((err) => {
            pdfWorkerReady = null;
            // Return resolved so caller can attempt fallback if worker fails
            return null;
        });
    }
    return pdfWorkerReady;
};

const STATUS_BADGE = {
    Pending: 'bg-amber-50 text-amber-700 border-amber-200',
    Verified: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Completed: 'bg-slate-100 text-slate-600 border-slate-200',
    Cancelled: 'bg-red-50 text-red-600 border-red-200'
};

const ModalHeader = ({ title, subtitle, onClose, children }) => (
    <div className="px-6 pt-6 pb-4 flex justify-between items-start gap-4 shrink-0 border-b border-slate-100">
        <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800 tracking-tight">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
            {children}
        </div>
        <button type="button" onClick={onClose} className="bg-slate-100 hover:bg-slate-200 p-2 rounded-full transition shrink-0" aria-label="Close">
            <X size={18} className="text-slate-600" />
        </button>
    </div>
);

const TAB_META = {
    list: { title: 'All Proceedings', desc: 'Active and completed proceedings' },
    pending: { title: 'Pending Queue', desc: 'Verify and approve pending proceeding requests' },
    create: { title: 'Create Proceeding', desc: 'Create a new proceeding and map students' },
    analytics: { title: 'Analytics', desc: 'Eligible vs released overview and scholarship student list by filters' },
    guide: { title: 'Guide', desc: 'Step-by-step process for creating, verifying, and approving proceedings' }
};

const getAcademicYears = () => {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = -4; i <= 4; i++) {
        const start = currentYear + i;
        years.push(`${start}-${start + 1}`);
    }
    return years;
};

/** batch 2024 + academicYear 2025-2026 => 2 */
const computeProceedingYear = (batch, academicYear) => {
    const batchStart = parseInt(String(batch || '').split('-')[0], 10);
    const ayStart = parseInt(String(academicYear || '').split('-')[0], 10);
    if (!Number.isFinite(batchStart) || !Number.isFinite(ayStart)) return null;
    const yearNum = ayStart - batchStart + 1;
    return yearNum >= 1 && yearNum <= 10 ? yearNum : null;
};

const formatYearLabel = (year) => {
    const n = Number(year);
    if (!Number.isFinite(n) || n < 1) return '-';
    const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
    return `${n}${suffix} Year`;
};

const getStudentApplicationId = (student, academicYear) => {
    const apps = student?.scholarshipApplications || [];
    if (!apps.length) return '—';
    if (academicYear && student?.batch) {
        const procYear = computeProceedingYear(student.batch, academicYear);
        if (procYear) {
            const match = apps.find(a => Number(a.studentYear) === procYear);
            if (match?.applicationId) return match.applicationId;
        }
    }
    const unique = [...new Set(apps.map(a => a.applicationId).filter(Boolean))];
    if (unique.length === 0) return '—';
    return unique.length === 1 ? unique[0] : unique.join(', ');
};

const normalizeExcelHeader = (cell) => String(cell ?? '')
    .trim()
    .toLowerCase()
    .replace(/[₹$()./\\#@:;,[\]*]+/g, ' ')
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

const headerTokens = (header) => normalizeExcelHeader(header).split('_').filter(Boolean);

const scoreApplicationIdHeader = (header) => {
    const h = normalizeExcelHeader(header);
    if (!h) return 0;
    const tokens = headerTokens(header);
    let score = 0;

    // Exact / common scholarship ID labels (incl. "Student ID" used in Excel exports)
    if (/^(application_id|application_no|application_number|app_id|app_no|app_number|applicationid|appid|student_id|studentid|stud_id)$/.test(h)) score += 22;
    if (/student.*(id|no|number|code)/.test(h) && !/admission|name|year|type/.test(h)) score += 18;
    if (/application.*(id|no|number|code)/.test(h)) score += 14;
    if (/app.*(id|no|number|code)/.test(h)) score += 12;
    if (tokens.includes('application') && tokens.some(t => ['id', 'no', 'number', 'code', 'num'].includes(t))) score += 11;
    if (tokens.includes('app') && tokens.some(t => ['id', 'no', 'number', 'code', 'num'].includes(t))) score += 10;
    if (tokens.includes('scholarship') && tokens.some(t => ['id', 'application', 'app', 'no', 'number'].includes(t))) score += 9;
    if (h === 'application' || h === 'app') score += 6;
    if (tokens.includes('application') && !tokens.some(t => ['amount', 'share', 'date', 'name'].includes(t))) score += 5;

    if (tokens.some(t => ['name', 'admission', 'pin', 'roll', 'batch', 'caste', 'college', 'course'].includes(t))) score -= 8;
    // "student" alone is fine for Student ID; penalize only when paired with name/type/year
    if (tokens.includes('student') && tokens.some(t => ['name', 'type', 'year', 'status'].includes(t))) score -= 10;
    if (tokens.some(t => ['amount', 'share', 'amt', 'sanctioned', 'released', 'paid'].includes(t))) score -= 6;
    if (tokens.includes('date')) score -= 4;

    return Math.max(0, score);
};

const scoreShareAmountHeader = (header) => {
    const h = normalizeExcelHeader(header);
    if (!h) return 0;
    const tokens = headerTokens(header);
    let score = 0;

    // Exact / common labels used in scholarship exports
    if (/^(share_amount|share_amt|shareamount|proceeding_share|proceeding_amount|scholarship_amount|sanctioned_amount|released_amount|released_amt|releasedamount|amount_released|release_amount|release_amt)$/.test(h)) {
        score += 28;
    }
    // "Released Amount", "Released Amt", "Amount Released", "Release Amount", etc.
    if (
        (tokens.includes('released') || tokens.includes('release'))
        && tokens.some(t => ['amount', 'amt', 'rs', 'rupee', 'value'].includes(t))
    ) {
        score += 26;
    }
    if (/released.*(amount|amt|rs|rupee|value)?/.test(h) || /amount.*released/.test(h) || h === 'released') {
        score += 22;
    }
    if (/share.*(amount|amt|rs|rupee|value)/.test(h)) score += 16;
    if (/proceeding.*(amount|share|amt)/.test(h)) score += 14;
    if (/scholarship.*(amount|share|amt)/.test(h)) score += 13;
    if (/sanctioned.*(amount|amt)/.test(h)) score += 12;
    if (tokens.includes('share') && tokens.some(t => ['amount', 'amt', 'rs', 'rupee', 'value'].includes(t))) score += 12;
    if (tokens.includes('share') && tokens.length === 1) score += 8;
    if (h === 'amount' || h === 'amt' || h.endsWith('_amount') || h.endsWith('_amt')) score += 7;
    if (tokens.includes('amount') && !tokens.includes('application') && !tokens.includes('student')) score += 5;
    if (tokens.includes('amt') && !tokens.includes('application') && !tokens.includes('student')) score += 5;

    if (tokens.some(t => ['application', 'app', 'id', 'no', 'number', 'name', 'student', 'admission', 'pin'].includes(t))
        && !tokens.some(t => ['amount', 'amt', 'released', 'release', 'share', 'sanctioned'].includes(t))) {
        score -= 10;
    }
    if (tokens.includes('total') && tokens.includes('count')) score -= 6;
    if (tokens.includes('date')) score -= 5;

    return Math.max(0, score);
};

const rankExcelColumns = (headers) => {
    const appScores = headers.map(h => scoreApplicationIdHeader(h));
    const shareScores = headers.map(h => scoreShareAmountHeader(h));

    let appCol = -1;
    let shareCol = -1;
    let appScore = 0;
    let shareScore = 0;

    appScores.forEach((s, i) => { if (s > appScore) { appScore = s; appCol = i; } });
    shareScores.forEach((s, i) => { if (s > shareScore) { shareScore = s; shareCol = i; } });

    const MIN_SCORE = 5;
    if (appScore < MIN_SCORE) appCol = -1;
    if (shareScore < MIN_SCORE) shareCol = -1;

    if (appCol >= 0 && appCol === shareCol) {
        if (appScore > shareScore) shareCol = -1;
        else if (shareScore > appScore) appCol = -1;
        else {
            const altShare = shareScores
                .map((s, i) => ({ s, i }))
                .filter(({ s, i }) => i !== appCol && s >= MIN_SCORE)
                .sort((a, b) => b.s - a.s)[0];
            shareCol = altShare?.i ?? -1;
        }
    }

    return {
        appCol,
        shareCol,
        score: (appCol >= 0 ? appScore : 0) + (shareCol >= 0 ? shareScore : 0),
        hasHeader: appCol >= 0,
    };
};

const detectExcelHeaderRow = (rows, maxScan = 10) => {
    let best = { rowIdx: -1, appCol: 0, shareCol: -1, score: 0, hasHeader: false };
    const limit = Math.min(maxScan, rows.length);

    for (let r = 0; r < limit; r++) {
        const headers = (rows[r] || []).map(normalizeExcelHeader);
        if (!headers.some(Boolean)) continue;
        const ranked = rankExcelColumns(headers);
        if (ranked.score > best.score) {
            best = { rowIdx: r, ...ranked };
        }
    }

    return best;
};

const parseExcelShareAmount = (val) => {
    if (val == null || val === '') return null;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
        return Math.round(val * 100) / 100;
    }
    const cleaned = String(val).replace(/[,₹\s]/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const looksLikeStudentIdToken = (text) => {
    const clean = String(text || '').trim();
    // Scholarship App IDs start with year pattern (e.g. 2024... or 2023...) or JNTUK PIN patterns (10-12 chars)
    if (!/^\d{10,14}$/.test(clean)) return false;
    // JNTUK Application IDs for JVD/RTF typically start with 20 (e.g., 2024xxxxxxxx) or 202xxxxx
    // Bank account numbers usually don't match application ID format prefixes or are positioned under "Account No" headers
    return true;
};

/** True for values that look like course year / S.No, not fee amounts. */
const looksLikeYearOrSerial = (text, amt) => {
    const t = String(text || '').trim();
    if (/^\d{4}\s*[-–]\s*\d{2,4}$/.test(t)) return true; // 2024-25
    if (/^null$/i.test(t)) return true;
    if (amt != null && amt > 0 && amt <= 20 && Number.isInteger(amt) && !/[.,]/.test(t.replace(/\s/g, ''))) {
        return true; // Course Year / S.No typically 1–20
    }
    return false;
};

/**
 * From cells to the right of Student ID, pick Released Amount.
 * RTF PDFs put Course Year (small int) before Released Amount — never take the first number blindly.
 */
const pickReleasedShareFromCells = (cells, idIndex, amountColX = null) => {
    const candidates = [];
    for (let j = idIndex + 1; j < cells.length; j++) {
        const text = cells[j].text;
        if (/^\d{4}\s*[-–]\s*\d{2,4}$/.test(String(text).trim())) continue;
        if (/^null$/i.test(String(text).trim())) continue;
        if (looksLikeStudentIdToken(String(text).replace(/\s+/g, ''))) continue;
        const amt = parseExcelShareAmount(text);
        if (amt == null) continue;
        candidates.push({ amt, x: cells[j].x, text });
    }
    if (!candidates.length) return null;

    // If header gave us Released Amount X, take nearest cell to that column
    if (amountColX != null && Number.isFinite(amountColX)) {
        const byCol = [...candidates].sort((a, b) => Math.abs(a.x - amountColX) - Math.abs(b.x - amountColX));
        const near = byCol[0];
        if (near && Math.abs(near.x - amountColX) <= 80) return near.amt;
    }

    // Prefer real fee amounts (>= 100) over course-year / serial leftovers
    const feeLike = candidates.filter((c) => c.amt >= 100 || !looksLikeYearOrSerial(c.text, c.amt));
    const pool = feeLike.length ? feeLike : candidates;
    // Released Amount is the rightmost numeric column — O(n) pick, no sort
    let best = pool[0];
    for (let i = 1; i < pool.length; i++) {
        const c = pool[i];
        if (c.x > best.x || (c.x === best.x && c.amt > best.amt)) best = c;
    }
    return best.amt;
};

const resolveShareForStudent = (student, shareByAppId, academicYear) => {
    if (!shareByAppId?.size) return null;
    const apps = student?.scholarshipApplications || [];
    if (academicYear && student?.batch) {
        const procYear = computeProceedingYear(student.batch, academicYear);
        if (procYear) {
            const match = apps.find(a => Number(a.studentYear) === procYear);
            if (match?.applicationId) {
                const amt = shareByAppId.get(String(match.applicationId).toLowerCase());
                if (amt != null) return amt;
            }
        }
    }
    for (const id of (student.applicationIds || [])) {
        const amt = shareByAppId.get(String(id).toLowerCase());
        if (amt != null) return amt;
    }
    for (const a of apps) {
        if (a.applicationId) {
            const amt = shareByAppId.get(String(a.applicationId).toLowerCase());
            if (amt != null) return amt;
        }
    }
    return null;
};

const formatNormalizedAcademicYear = (raw) => {
    if (!raw) return null;
    const clean = String(raw).trim().replace(/\s+/g, '').replace(/[/–]/g, '-');
    const parts = clean.split('-');
    if (parts.length === 2) {
        let start = parts[0];
        let end = parts[1];
        if (start.length === 4 && /^\d{4}$/.test(start)) {
            if (end.length === 2 && /^\d{2}$/.test(end)) {
                const century = start.substring(0, 2);
                end = century + end;
            }
            if (end.length === 4 && /^\d{4}$/.test(end)) {
                return `${start}-${end}`;
            }
        }
    }
    return clean;
};

const extractAcademicYearFromRows = (rows) => {
    const frequencyMap = new Map();
    const yearRegex = /(?:20\d{2}\s*[-–/]\s*(?:20)?\d{2})/gi;

    for (let r = 0; r < Math.min(rows.length, 100); r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
            const cellVal = String(row[c] ?? '').trim();
            if (!cellVal || /^\d{8,}$/.test(cellVal)) continue;
            let match;
            yearRegex.lastIndex = 0;
            while ((match = yearRegex.exec(cellVal)) !== null) {
                const normalized = formatNormalizedAcademicYear(match[0]);
                if (normalized) {
                    frequencyMap.set(normalized, (frequencyMap.get(normalized) || 0) + 1);
                }
            }
        }
    }

    let bestYear = null;
    let maxCount = 0;
    for (const [year, count] of frequencyMap.entries()) {
        if (count > maxCount) {
            maxCount = count;
            bestYear = year;
        }
    }
    return bestYear;
};

const extractAcademicYearFromText = (text) => {
    if (!text) return null;
    // 1. Label match supporting "Academic Year", "Acedemic Year", "AY", "Acad Year"
    const labelMatch = text.match(/(?:academic|acedemic|acad)\s*year\s*[:\-–]?\s*(20\d{2}\s*[-–/]\s*(?:20)?\d{2})/i);
    if (labelMatch) {
        return formatNormalizedAcademicYear(labelMatch[1]);
    }
    // 2. Global pattern frequency counting across all rows/header
    const matches = text.match(/(?:20\d{2}\s*[-–/]\s*(?:20)?\d{2})/gi);
    if (matches && matches.length > 0) {
        const frequencyMap = new Map();
        for (const raw of matches) {
            const normalized = formatNormalizedAcademicYear(raw);
            if (normalized) {
                frequencyMap.set(normalized, (frequencyMap.get(normalized) || 0) + 1);
            }
        }
        let bestYear = null;
        let maxCount = 0;
        for (const [year, count] of frequencyMap.entries()) {
            if (count > maxCount) {
                maxCount = count;
                bestYear = year;
            }
        }
        if (bestYear) return bestYear;
    }
    return null;
};

/** Parse proceeding Excel: application IDs + optional share amounts (single pass, deduped by app id). */
const parseProceedingExcelFile = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const wb = XLSX.read(evt.target.result, {
                type: 'array',
                cellDates: false,
                cellNF: false,
                cellStyles: false,
                bookVBA: false,
                bookDeps: false,
                bookFiles: false,
            });
            const sheetName = wb.SheetNames[0];
            const sheet = sheetName ? wb.Sheets[sheetName] : null;
            if (!sheet) {
                resolve({ entries: [], applicationIds: [], hasShareColumn: false, totalShareAmount: 0, academicYear: null });
                return;
            }
            // Dense array-of-arrays is faster than object rows for ~500+ student sheets
            const rows = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                defval: '',
                blankrows: false,
                raw: true,
            });
            if (!rows.length) {
                resolve({ entries: [], applicationIds: [], hasShareColumn: false, totalShareAmount: 0, academicYear: null });
                return;
            }

            const academicYear = extractAcademicYearFromRows(rows);

            const detected = detectExcelHeaderRow(rows);
            const hasHeader = detected.hasHeader && detected.rowIdx >= 0;
            const idCol = hasHeader ? detected.appCol : 0;
            const amountCol = hasHeader
                ? detected.shareCol
                : (rows[0]?.length > 1 ? 1 : -1);
            const startRow = hasHeader ? detected.rowIdx + 1 : 0;
            const hasShareColumn = amountCol >= 0;

            const entryMap = new Map();
            for (let i = startRow; i < rows.length; i++) {
                const row = rows[i];
                if (!row?.length) continue;
                const applicationId = String(row[idCol] ?? '').trim();
                if (!applicationId) continue;
                const shareAmount = hasShareColumn ? parseExcelShareAmount(row[amountCol]) : null;
                entryMap.set(applicationId.toLowerCase(), { applicationId, shareAmount });
            }

            const entries = [...entryMap.values()];
            let totalShareAmount = 0;
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].shareAmount != null) totalShareAmount += entries[i].shareAmount;
            }

            resolve({
                entries,
                applicationIds: entries.map(e => e.applicationId),
                hasShareColumn,
                totalShareAmount: Math.round(totalShareAmount * 100) / 100,
                academicYear,
            });
        } catch (err) {
            reject(err);
        }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
});

const parseProceedingArrayBufferFallback = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const buffer = evt.target.result;
            const decoder = new TextDecoder('latin1');
            const rawText = decoder.decode(buffer);

            // Clean up PDF stream operators to extract text lines
            const text = rawText
                .replace(/\(([^)]+)\)\s*Tj/g, '$1 ')
                .replace(/\[((?:[^\]]+)*)\]\s*TJ/g, (m, g1) => g1.replace(/\(([^)]+)\)/g, '$1 '))
                .replace(/\\(\d{3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)))
                .replace(/\\([()])/g, '$1');

            const entryMap = new Map();
            let hasShareColumn = false;

            const amountRe = /(?:₹|Rs\.?\s*)?([\d,]+\.?\d{0,2})/gi;
            const idChunkRe = /(\d{10,14})([\s\S]{0,250}?)(?=\d{10,14}|$)/g;

            let m;
            while ((m = idChunkRe.exec(text)) !== null) {
                const applicationId = m[1];
                if (!looksLikeStudentIdToken(applicationId)) continue;

                const chunk = m[2] || '';

                // If chunk contains bank account keywords nearby, check if this ID looks like a bank account number
                if (/account|bank|a\/c|acc\s*no/i.test(chunk.substring(0, 30))) {
                    continue;
                }

                amountRe.lastIndex = 0;
                let shareAmount = null;
                const nums = [];
                let am;
                while ((am = amountRe.exec(chunk)) !== null) {
                    const amt = parseExcelShareAmount(am[1]);
                    if (amt != null && !looksLikeYearOrSerial(am[1], amt)) {
                        // Skip values that look like bank account numbers or 10-14 digit IDs
                        if (!/^\d{10,14}$/.test(am[1].replace(/[,.\s]/g, ''))) {
                            nums.push(amt);
                        }
                    }
                }
                const feeNums = nums.filter((amt) => amt >= 100);
                const pool = feeNums.length ? feeNums : nums;
                if (pool.length) shareAmount = pool[pool.length - 1];

                if (shareAmount != null) hasShareColumn = true;
                const key = applicationId.toLowerCase();
                const prev = entryMap.get(key);
                if (!prev || (shareAmount != null && prev.shareAmount == null)) {
                    entryMap.set(key, { applicationId, shareAmount });
                }
            }

            const entries = [...entryMap.values()];
            let totalShareAmount = 0;
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].shareAmount != null) totalShareAmount += entries[i].shareAmount;
            }

            const academicYear = extractAcademicYearFromText(text);

            resolve({
                entries,
                applicationIds: entries.map(e => e.applicationId),
                hasShareColumn,
                totalShareAmount: Math.round(totalShareAmount * 100) / 100,
                academicYear,
            });
        } catch (err) {
            reject(err);
        }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
});

/** Extract Student ID + Released Amount from text-based PDF tables (same mapping as Excel). */
const parseProceedingPdfFile = async (file, onProgress) => {
    let data;
    try {
        data = new Uint8Array(await file.arrayBuffer());
    } catch {
        return parseProceedingArrayBufferFallback(file);
    }

    let pdf = null;
    try {
        await ensurePdfWorker();
        pdf = await getDocument({
            data,
            // Text-only extraction: skip font loading / face work for speed
            useSystemFonts: false,
            disableFontFace: true,
            isEvalSupported: false,
            useWorkerFetch: false,
            verbosity: 0,
        }).promise;
    } catch (err) {
        console.warn('Primary PDF worker parsing failed, trying workerless fallback:', err);
        try {
            // Workerless fallback for older browsers that don't support ES module workers
            pdf = await getDocument({
                data,
                useSystemFonts: false,
                disableFontFace: true,
                isEvalSupported: false,
                useWorkerFetch: false,
                disableWorker: true,
                verbosity: 0,
            }).promise;
        } catch (fallbackErr) {
            console.warn('Workerless PDF parsing failed, using array buffer text extraction fallback:', fallbackErr);
            return parseProceedingArrayBufferFallback(file);
        }
    }

    const entryMap = new Map();
    let hasShareColumn = false;
    const pagePlainTexts = new Array(pdf.numPages).fill('');

    const extractFromPageItems = (rawItems) => {
        const localEntries = [];
        let localHasShare = false;
        let amountColX = null;
        let appIdColX = null;
        let bankAccColX = null;
        const items = [];
        let plainParts = '';

        for (let i = 0; i < (rawItems?.length || 0); i++) {
            const it = rawItems[i];
            if (!it || typeof it.str !== 'string') continue;
            const text = it.str.trim();
            plainParts += `${it.str || ''} `;
            if (!text) continue;
            items.push({
                text,
                x: Number(it.transform?.[4]) || 0,
                yBucket: Math.round((Number(it.transform?.[5]) || 0) / 2.5),
                y: Number(it.transform?.[5]) || 0,
            });
        }

        // O(n) row grouping via Y buckets (tolerance ~2.5)
        const rowMap = new Map();
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let row = rowMap.get(item.yBucket);
            if (!row) {
                row = { y: item.y, cells: [] };
                rowMap.set(item.yBucket, row);
            }
            row.cells.push(item);
        }

        const rows = [...rowMap.values()].sort((a, b) => b.y - a.y);
        for (let r = 0; r < rows.length; r++) {
            const cells = rows[r].cells.sort((a, b) => a.x - b.x);
            const joined = cells.map((c) => c.text).join(' ');

            // Header row: lock Released Amount, App ID, and Bank Account column X
            if (/released\s*amount/i.test(joined) || (/released/i.test(joined) && /amount/i.test(joined))) {
                localHasShare = true;
                const releasedCell = cells.find((c) => /released/i.test(c.text))
                    || cells.find((c) => /^amount$/i.test(c.text.trim()));
                if (releasedCell) amountColX = releasedCell.x;
            }
            if (/student\s*id|application|app\s*id|registration/i.test(joined)) {
                const appCell = cells.find((c) => /application|app|student|id|reg/i.test(c.text));
                if (appCell) appIdColX = appCell.x;
            }
            if (/account|bank|a\/c|acc\s*no/i.test(joined)) {
                const bankCell = cells.find((c) => /account|bank|a\/c|acc/i.test(c.text));
                if (bankCell) bankAccColX = bankCell.x;
            }

            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                const idText = cell.text.replace(/\s+/g, '');
                if (!looksLikeStudentIdToken(idText)) continue;

                // Skip if this cell column X is under the Bank Account / A/C header column (tolerance +/- 60px)
                if (bankAccColX != null && Math.abs(cell.x - bankAccColX) < 60) {
                    continue;
                }
                // If App ID header column was identified, prefer cells aligned near App ID header (tolerance +/- 80px)
                if (appIdColX != null && Math.abs(cell.x - appIdColX) > 100 && bankAccColX != null && Math.abs(cell.x - bankAccColX) < Math.abs(cell.x - appIdColX)) {
                    continue;
                }

                const shareAmount = pickReleasedShareFromCells(cells, i, amountColX);
                if (shareAmount != null) localHasShare = true;

                localEntries.push({ applicationId: idText, shareAmount });
            }
        }

        return { localEntries, localHasShare, plainText: plainParts };
    };

    const parsePage = async (pageNum) => {
        const page = await pdf.getPage(pageNum);
        try {
            const content = await page.getTextContent({
                includeMarkedContent: false,
                disableCombineTextItems: false,
            });
            return extractFromPageItems(content.items);
        } finally {
            page.cleanup?.();
        }
    };

    // Parallel page parse — higher concurrency for multi-page ~500-student PDFs
    const CONCURRENCY = Math.min(8, Math.max(3, navigator?.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 8) : 4));
    onProgress?.(0, pdf.numPages);

    for (let start = 1; start <= pdf.numPages; start += CONCURRENCY) {
        const batchNums = [];
        for (let p = start; p < start + CONCURRENCY && p <= pdf.numPages; p++) batchNums.push(p);
        const batchResults = await Promise.all(batchNums.map((pageNum) => parsePage(pageNum)));

        for (let i = 0; i < batchResults.length; i++) {
            const pageNum = batchNums[i];
            const { localEntries, localHasShare, plainText } = batchResults[i];
            pagePlainTexts[pageNum - 1] = plainText || '';
            if (localHasShare) hasShareColumn = true;
            for (let e = 0; e < localEntries.length; e++) {
                const entry = localEntries[e];
                // Prefer entries that already have a real share when merging duplicates
                const key = entry.applicationId.toLowerCase();
                const prev = entryMap.get(key);
                if (!prev || (entry.shareAmount != null && prev.shareAmount == null)) {
                    entryMap.set(key, entry);
                } else if (
                    entry.shareAmount != null
                    && prev.shareAmount != null
                    && entry.shareAmount >= 100
                    && prev.shareAmount < 100
                ) {
                    entryMap.set(key, entry);
                }
            }
        }

        onProgress?.(Math.min(pdf.numPages, start + CONCURRENCY - 1), pdf.numPages);
    }

    // Fix / fill shares only when needed (Course Year mistaken for Released Amount)
    let nullShares = 0;
    let smallShares = 0;
    let feeShares = 0;
    entryMap.forEach((e) => {
        if (e.shareAmount == null) nullShares += 1;
        else if (e.shareAmount <= 20) smallShares += 1;
        else if (e.shareAmount >= 100) feeShares += 1;
    });
    const needsShareFix = entryMap.size === 0
        || feeShares === 0
        || smallShares > Math.max(5, Math.floor(entryMap.size * 0.05));

    if (needsShareFix) {
        // Per-page regex (avoids one giant string + backtracking on 500-row PDFs)
        const amountRe = /(?:₹|Rs\.?\s*)?([\d,]+\.?\d{0,2})/gi;
        const idChunkRe = /(\d{10,14})([\s\S]{0,180}?)(?=\d{10,14}|$)/g;
        for (let p = 0; p < pagePlainTexts.length; p++) {
            const pageText = pagePlainTexts[p];
            if (!pageText) continue;
            idChunkRe.lastIndex = 0;
            let m;
            while ((m = idChunkRe.exec(pageText)) !== null) {
                const applicationId = m[1];
                const chunk = m[2] || '';
                amountRe.lastIndex = 0;
                let shareAmount = null;
                const nums = [];
                let am;
                while ((am = amountRe.exec(chunk)) !== null) {
                    const amt = parseExcelShareAmount(am[1]);
                    if (amt != null && !looksLikeYearOrSerial(am[1], amt)) {
                        nums.push(amt);
                    }
                }
                const feeNums = nums.filter((amt) => amt >= 100);
                const pool = feeNums.length ? feeNums : nums;
                if (pool.length) shareAmount = pool[pool.length - 1];

                if (shareAmount != null) hasShareColumn = true;
                const key = applicationId.toLowerCase();
                const prev = entryMap.get(key);
                if (!prev) {
                    entryMap.set(key, { applicationId, shareAmount });
                } else if (
                    shareAmount != null
                    && (prev.shareAmount == null || prev.shareAmount <= 20 || (prev.shareAmount < 100 && shareAmount >= 100))
                ) {
                    entryMap.set(key, { applicationId, shareAmount });
                }
            }
        }
    }

    try {
        await pdf.destroy();
    } catch {
        /* ignore */
    }

    const entries = [...entryMap.values()];
    const totalShareAmount = Math.round(
        entries.reduce((sum, e) => sum + (e.shareAmount || 0), 0) * 100
    ) / 100;
    const academicYear = extractAcademicYearFromText(pagePlainTexts.join(' '));

    return {
        entries,
        applicationIds: entries.map((e) => e.applicationId),
        hasShareColumn: hasShareColumn || entries.some((e) => e.shareAmount != null),
        totalShareAmount,
        sourceType: 'pdf',
        academicYear,
    };
};

const parseProceedingImportFile = async (file, onProgress) => {
    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.pdf')) return parseProceedingPdfFile(file, onProgress);
    return parseProceedingExcelFile(file);
};

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildExcelImportSummary = (parsed, students, shares, backendSummary, autoLocked, academicYear) => {
    if (!parsed?.applicationIds?.length) return null;

    const matchedAppIdLower = new Set();
    students.forEach(s => {
        (s.applicationIds || []).forEach(id => matchedAppIdLower.add(String(id).toLowerCase()));
    });

    const missingShareInExcel = parsed.hasShareColumn
        ? parsed.entries.filter(e => e.shareAmount == null).map(e => e.applicationId)
        : [];

    const studentsMissingShare = students
        .filter(s => !(Number(shares?.[s.studentId]) > 0))
        .map(s => ({
            studentId: s.studentId,
            studentName: s.studentName,
            applicationId: getStudentApplicationId(s, academicYear),
        }));

    const notFound = backendSummary?.notFound?.length
        ? backendSummary.notFound
        : parsed.applicationIds
            .filter(id => !matchedAppIdLower.has(String(id).toLowerCase()))
            .map(applicationId => ({
                applicationId,
                status: 'not_in_filter',
                message: 'No matching student for current filters',
            }));

    const courses = backendSummary?.courses
        || [...new Set(students.map(s => s.course).filter(Boolean))];
    const batches = backendSummary?.batches
        || [...new Set(students.map(s => s.batch).filter(Boolean))];
    const colleges = backendSummary?.colleges
        || [...new Set(students.map(s => s.college).filter(Boolean))];

    const hasIssues = notFound.length > 0 || missingShareInExcel.length > 0 || studentsMissingShare.length > 0;

    return {
        requested: parsed.applicationIds.length,
        matchedStudents: students.length,
        matchedApplicationIds: backendSummary?.matchedApplicationIds ?? matchedAppIdLower.size,
        notFound,
        missingShareInExcel,
        studentsMissingShare,
        hasShareColumn: parsed.hasShareColumn,
        autoLocked,
        hasIssues,
        courses,
        batches,
        colleges,
        multiCourse: courses.length > 1,
        multiBatch: batches.length > 1,
    };
};

const showExcelImportResultDialog = (summary, hasStudents, autoLocked) => {
    if (!summary) return;

    const issueLines = [];
    if (summary.notFound.length > 0) issueLines.push(`${summary.notFound.length} application ID(s) could not be loaded`);
    if (summary.missingShareInExcel.length > 0) issueLines.push(`${summary.missingShareInExcel.length} Excel row(s) have no share amount`);
    if (summary.studentsMissingShare.length > 0) issueLines.push(`${summary.studentsMissingShare.length} loaded student(s) need share amounts`);

    if (!hasStudents) {
        let html = `<div style="text-align:left;font-size:13px;line-height:1.5">`;
        html += `<p>No students matched the Excel Student ID / Application ID values.</p>`;
        if (summary.notFound.length > 0) {
            html += `<p style="margin-top:10px;font-weight:600;color:#b45309">Application IDs not loaded:</p><ul style="max-height:160px;overflow:auto;margin:6px 0 0;padding-left:18px;font-size:12px">`;
            summary.notFound.slice(0, 40).forEach(n => {
                html += `<li style="margin-bottom:4px"><code>${escapeHtml(n.applicationId)}</code>${n.message ? `<br><span style="color:#64748b">${escapeHtml(n.message)}</span>` : ''}</li>`;
            });
            if (summary.notFound.length > 40) html += `<li>…and ${summary.notFound.length - 40} more</li>`;
            html += `</ul>`;
        }
        html += `<p style="margin-top:10px;color:#64748b;font-size:12px">Verify Student ID / Application ID values in the Excel file.</p></div>`;
        Swal.fire({ icon: 'warning', title: 'No students loaded', html, width: 620, confirmButtonText: 'OK' });
        return;
    }

    const scopeParts = [];
    if (summary.multiCourse) scopeParts.push(`${summary.courses.length} courses`);
    else if (summary.courses?.length === 1) scopeParts.push(`Course ${summary.courses[0]}`);
    if (summary.multiBatch) scopeParts.push(`${summary.batches.length} batches`);
    else if (summary.batches?.length === 1) scopeParts.push(`Batch ${summary.batches[0]}`);
    const scopeText = scopeParts.length ? ` · ${scopeParts.join(' · ')}` : '';

    if (!summary.hasIssues) {
        Swal.fire({
            icon: 'success',
            title: 'Excel loaded',
            text: autoLocked
                ? `All ${summary.matchedStudents} student(s) loaded with share amounts${scopeText}. Selection locked — review and submit.`
                : `All ${summary.matchedStudents} student(s) loaded and selected${scopeText}.`,
            timer: autoLocked ? 3500 : 2500,
            showConfirmButton: !autoLocked,
        });
        return;
    }

    let html = `<div style="text-align:left;font-size:13px;line-height:1.5">`;
    html += `<p><b>${summary.matchedStudents}</b> of <b>${summary.requested}</b> Student ID(s) loaded as students${scopeText ? ` (${escapeHtml(scopeParts.join(', '))})` : ''}.</p>`;
    html += `<p style="color:#b45309;margin-top:6px">${issueLines.join(' · ')}</p>`;

    if (summary.notFound.length > 0) {
        html += `<p style="margin-top:10px;font-weight:600">Not loaded:</p><ul style="max-height:100px;overflow:auto;margin:4px 0 0;padding-left:18px;font-size:12px">`;
        summary.notFound.slice(0, 25).forEach(n => {
            html += `<li style="margin-bottom:4px"><code>${escapeHtml(n.applicationId)}</code>${n.message ? ` — ${escapeHtml(n.message)}` : ''}</li>`;
        });
        if (summary.notFound.length > 25) html += `<li>…and ${summary.notFound.length - 25} more</li>`;
        html += `</ul>`;
    }

    if (summary.missingShareInExcel.length > 0) {
        html += `<p style="margin-top:10px;font-weight:600">Excel rows missing share amount:</p><p style="font-size:12px;color:#64748b">${summary.missingShareInExcel.slice(0, 15).map(escapeHtml).join(', ')}${summary.missingShareInExcel.length > 15 ? ` …+${summary.missingShareInExcel.length - 15} more` : ''}</p>`;
    }

    if (summary.studentsMissingShare.length > 0) {
        html += `<p style="margin-top:10px;font-weight:600">Students needing share amounts:</p><ul style="max-height:80px;overflow:auto;margin:4px 0 0;padding-left:18px;font-size:12px">`;
        summary.studentsMissingShare.slice(0, 15).forEach(s => {
            html += `<li>${escapeHtml(s.studentName || s.studentId)} (${escapeHtml(s.applicationId)})</li>`;
        });
        if (summary.studentsMissingShare.length > 15) html += `<li>…and ${summary.studentsMissingShare.length - 15} more</li>`;
        html += `</ul>`;
    }

    html += `<p style="margin-top:10px;color:#64748b;font-size:12px">Review the summary panel below the filters for full details.</p></div>`;

    Swal.fire({
        icon: 'warning',
        title: 'Loaded with issues',
        html,
        width: 620,
        confirmButtonText: 'OK',
    });
};

/** Group student_scholarship rows by student_year; only records with application_id */
const groupScholarshipsByYear = (scholarships = []) => {
    const withAppId = scholarships.filter(r => String(r.applicationId || '').trim());
    const yearMap = new Map();

    withAppId.forEach(rec => {
        const yr = String(rec.studentYear ?? '—');
        if (!yearMap.has(yr)) yearMap.set(yr, { appMap: new Map(), yearSanctioned: 0 });
        const yearEntry = yearMap.get(yr);
        const appMap = yearEntry.appMap;
        const appKey = rec.applicationId;

        const san = Number(rec.sanctionedAmount);
        if (Number.isFinite(san) && san > yearEntry.yearSanctioned) {
            yearEntry.yearSanctioned = san;
        }

        if (!appMap.has(appKey)) {
            appMap.set(appKey, {
                applicationId: rec.applicationId || '—',
                eligible: rec.eligible || '',
                releasedAmount: 0,
                paidAmount: 0,
                fromDate: rec.fromDate || null,
                toDate: rec.toDate || null,
                proceeding: rec.proceeding || '',
                semesters: [],
            });
        }

        const app = appMap.get(appKey);
        app.releasedAmount += Number(rec.releasedAmount) || 0;
        app.paidAmount += Number(rec.paidAmount) || 0;
        if (rec.fromDate && (!app.fromDate || rec.fromDate < app.fromDate)) app.fromDate = rec.fromDate;
        if (rec.toDate && (!app.toDate || rec.toDate > app.toDate)) app.toDate = rec.toDate;
        if (rec.proceeding && !app.proceeding) app.proceeding = rec.proceeding;
        if (rec.studentSemester != null && !app.semesters.includes(rec.studentSemester)) {
            app.semesters.push(rec.studentSemester);
        }
        const elig = String(rec.eligible || '').toLowerCase();
        const cur = String(app.eligible || '').toLowerCase();
        if (elig === 'eligible' || (elig === 'pending' && cur !== 'eligible')) {
            app.eligible = rec.eligible;
        }
    });

    return [...yearMap.entries()]
        .sort(([a], [b]) => {
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return String(a).localeCompare(String(b));
        })
        .map(([studentYear, { appMap, yearSanctioned }]) => {
            const applications = [...appMap.values()].sort((a, b) =>
                String(a.applicationId).localeCompare(String(b.applicationId))
            );
            const applicationIds = [...new Set(
                applications.map(a => a.applicationId).filter(id => id && id !== '—')
            )];
            return {
                studentYear,
                yearLabel: Number.isFinite(Number(studentYear)) ? formatYearLabel(studentYear) : studentYear,
                applicationId: applicationIds.length === 1
                    ? applicationIds[0]
                    : (applicationIds.length > 1 ? applicationIds.join(', ') : '—'),
                applicationIds,
                applications,
                eligible: applications.some(a => String(a.eligible).toLowerCase() === 'eligible')
                    ? 'eligible'
                    : (applications[0]?.eligible || ''),
                sanctionedAmount: yearSanctioned,
                releasedAmount: applications.reduce((s, a) => s + (a.releasedAmount || 0), 0),
                paidAmount: applications.reduce((s, a) => s + (a.paidAmount || 0), 0),
            };
        });
};

const emptyForm = () => ({
    proceedingNumber: '',
    proceedingDate: '',
    amount: '',
    bankCreditedAmount: '',
    bankAccount: '',
    bankCreditedDate: '',
    colleges: [],
    courses: [],
    batches: [],
    caste: '',
    academicYear: '',
    proceedingNature: 'College Account',
});

/** Normalize legacy string college/course/batch into arrays for the form */
const normalizeScopeArrays = (data = {}) => {
    const toArr = (v) => {
        if (Array.isArray(v)) return v.filter(Boolean);
        if (v == null || v === '' || v === 'Multiple') return [];
        return [String(v)];
    };
    return {
        ...data,
        colleges: toArr(data.colleges ?? data.college),
        courses: toArr(data.courses ?? data.course),
        batches: toArr(data.batches ?? data.batch),
    };
};

const headerFromList = (list) => {
    if (!list?.length) return '';
    return list.length === 1 ? list[0] : 'Multiple';
};

/** Display real college/course/batch labels (never show raw "Multiple" when arrays or students are available). */
const formatProceedingScope = (proc = {}, mappedStudents = []) => {
    const fromStudents = (key) => [...new Set(
        (mappedStudents || []).map((s) => s[key]).filter((v) => v && v !== 'Multiple')
    )];

    const colleges = (proc.colleges?.length
        ? proc.colleges
        : fromStudents('college').length
            ? fromStudents('college')
            : (proc.college && proc.college !== 'Multiple' ? [proc.college] : [])
    ).filter((v) => v && v !== 'Multiple');

    const courses = (proc.courses?.length
        ? proc.courses
        : fromStudents('course').length
            ? fromStudents('course')
            : (proc.course && proc.course !== 'Multiple' ? [proc.course] : [])
    ).filter((v) => v && v !== 'Multiple');

    const batches = (proc.batches?.length
        ? proc.batches
        : fromStudents('batch').length
            ? fromStudents('batch')
            : (proc.batch && proc.batch !== 'Multiple' ? [proc.batch] : [])
    ).filter((v) => v && v !== 'Multiple');

    const joinLabel = (arr, fallbackMulti, fallbackEmpty = '-') => {
        if (!arr.length) {
            if (fallbackMulti) return fallbackMulti;
            return fallbackEmpty;
        }
        if (arr.length <= 2) return arr.join(', ');
        return `${arr.slice(0, 2).join(', ')} +${arr.length - 2} more`;
    };

    return {
        colleges,
        courses,
        batches,
        collegeLabel: joinLabel(colleges, proc.college === 'Multiple' ? 'Multiple colleges' : (proc.college || '-')),
        courseLabel: joinLabel(courses, proc.course === 'Multiple' ? 'Multiple courses' : (proc.course || '-')),
        batchLabel: joinLabel(batches, proc.batch === 'Multiple' ? 'Multiple batches' : (proc.batch || '')),
    };
};

/** Checkbox multi-select dropdown for College / Course / Batch */
const MultiCheckDropdown = ({
    label,
    options = [],
    selected = [],
    onChange,
    placeholder = 'Select',
    disabled = false,
    readOnly = false,
    required = false,
}) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const onDoc = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, []);

    const mergedOptions = useMemo(() => {
        const set = new Set([...(options || []), ...(selected || [])]);
        return [...set].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b)));
    }, [options, selected]);

    const toggle = (value) => {
        if (disabled || readOnly) return;
        if (selected.includes(value)) onChange(selected.filter(v => v !== value));
        else onChange([...selected, value]);
    };

    const summary = selected.length === 0
        ? placeholder
        : selected.length === 1
            ? selected[0]
            : selected.length <= 3
                ? selected.join(', ')
                : `${selected.length} selected`;

    const canOpen = !disabled;

    return (
        <div className="space-y-1" ref={ref}>
            <label className="text-xs font-bold text-slate-600">
                {label}{required ? ' *' : ''}
                {readOnly && selected.length > 0 && (
                    <span className="ml-1 font-semibold text-slate-400 normal-case">(locked)</span>
                )}
            </label>
            <div className="relative">
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => canOpen && setOpen(o => !o)}
                    className={`w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl text-left text-sm font-medium focus:ring-2 focus:ring-blue-100 ${
                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-slate-300'
                    } ${selected.length ? 'text-slate-800' : 'text-slate-400'}`}
                    title={selected.length ? selected.join(', ') : placeholder}
                >
                    <span className="block truncate">{summary}</span>
                </button>
                <ChevronDown size={14} className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none transition ${open ? 'rotate-180' : ''}`} />
                {open && canOpen && (
                    <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg py-1">
                        {readOnly && (
                            <div className="px-3 py-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 border-b border-amber-100">
                                View only — click Change Selection to edit
                            </div>
                        )}
                        {mergedOptions.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-slate-400">No options</div>
                        ) : (
                            mergedOptions.map(opt => {
                                const checked = selected.includes(opt);
                                return (
                                    <label
                                        key={opt}
                                        className={`flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 ${
                                            readOnly ? 'cursor-default' : 'hover:bg-slate-50 cursor-pointer'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={readOnly}
                                            onChange={() => toggle(opt)}
                                            className="rounded text-blue-600 focus:ring-blue-500 disabled:opacity-70"
                                        />
                                        <span className={`font-medium ${checked ? 'text-indigo-700' : ''}`}>{opt}</span>
                                    </label>
                                );
                            })
                        )}
                        {!readOnly && selected.length > 0 && (
                            <button
                                type="button"
                                onClick={() => onChange([])}
                                className="w-full text-left px-3 py-1.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50 border-t border-slate-100"
                            >
                                Clear all
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const getProceedingDraftKey = (username) => `proceeding_create_draft_${username || 'anon'}`;

const readProceedingDraft = (username) => {
    try {
        const raw = localStorage.getItem(getProceedingDraftKey(username));
        if (!raw) return null;
        const draft = JSON.parse(raw);
        if (!draft || typeof draft !== 'object') return null;
        return draft;
    } catch {
        return null;
    }
};

const Proceedings = () => {
    const location = useLocation();
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const permissions = user?.permissions || [];
    const canApprove = user?.role === 'superadmin' || permissions.includes('proceedings_approve');
    const canVerify = user?.role === 'superadmin' || permissions.includes('proceedings_verify');
    const canEdit = user?.role === 'superadmin' || user?.role === 'admin' || permissions.includes('proceedings_edit');
    const canCreate = user?.role === 'superadmin' || user?.role === 'admin' || permissions.includes('proceedings_view') || permissions.includes('proceedings_edit') || permissions.includes('/proceedings');
    const canList = user?.role === 'superadmin' || user?.role === 'admin' || permissions.includes('proceedings_edit') || permissions.includes('proceedings_verify') || permissions.includes('proceedings_approve');
    const canView = user?.role === 'superadmin' || user?.role === 'admin' || permissions.includes('proceedings_view') || permissions.includes('proceedings_edit') || permissions.includes('proceedings_verify') || permissions.includes('proceedings_approve') || permissions.includes('/proceedings');

    const getTabFromHash = (hash) => {
        const cleaned = (hash || '').replace('#', '');
        if (cleaned === 'create' && canCreate) return 'create';
        if (cleaned === 'list' && canList) return 'list';
        if (cleaned === 'pending' && canView) return 'pending';
        if (cleaned === 'analytics' && canView) return 'analytics';
        if (cleaned === 'guide') return 'guide';
        return canList ? 'list' : (canCreate ? 'create' : 'pending');
    };

    const [activeTab, setActiveTab] = useState(() => getTabFromHash(location.hash));
    const [proceedings, setProceedings] = useState([]);
    const [loading, setLoading] = useState(false);
    const [metadata, setMetadata] = useState({ hierarchy: {}, batches: [], categories: [], castes: [] });
    const [paymentConfigs, setPaymentConfigs] = useState([]);
    const [feeHeads, setFeeHeads] = useState([]);
    const [showApproveModal, setShowApproveModal] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showPrintModal, setShowPrintModal] = useState(false);
    const [printOptions, setPrintOptions] = useState({ abstract: true, detailed: false });
    const [isEditing, setIsEditing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [collegeFilter, setCollegeFilter] = useState('All');
    const [courseFilter, setCourseFilter] = useState('All');
    const [academicYearFilter, setAcademicYearFilter] = useState('All');
    const [activeStatusFilter, setActiveStatusFilter] = useState('Active'); // Active | Inactive | All
    const [detailModal, setDetailModal] = useState(null);
    const academicYearDefaultSet = useRef(false);
    const [pendingSearch, setPendingSearch] = useState('');
    const [pendingCollegeFilter, setPendingCollegeFilter] = useState('All');
    const [pendingCourseFilter, setPendingCourseFilter] = useState('All');
    const [pendingAcademicYearFilter, setPendingAcademicYearFilter] = useState('All');
    const [pendingStatusFilter, setPendingStatusFilter] = useState('Pending');

    const [formData, setFormData] = useState(emptyForm());
    const [loadedStudents, setLoadedStudents] = useState([]);
    const [studentChecks, setStudentChecks] = useState({});
    const [studentShareAmounts, setStudentShareAmounts] = useState({});
    const [studentsLocked, setStudentsLocked] = useState(false);
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [studentSearch, setStudentSearch] = useState('');
    const [studentSort, setStudentSort] = useState({ key: 'studentName', dir: 'asc' });
    const [studentQuotaFilter, setStudentQuotaFilter] = useState('All');

    const [approveData, setApproveData] = useState({ bankAccount: '', bankCreditedDate: '', amount: '', feeHead: '' });
    const [approvingProc, setApprovingProc] = useState(null);
    const [approveStudents, setApproveStudents] = useState([]);
    const [approveSkipTransactions, setApproveSkipTransactions] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [draftAvailable, setDraftAvailable] = useState(() => !!readProceedingDraft(user?.username));
    const [draftSavedAt, setDraftSavedAt] = useState(null);
    const skipNextDraftSave = useRef(false);
    const applicationExcelRef = useRef(null);
    const attachmentInputRef = useRef(null);
    const detailAttachmentInputRef = useRef(null);
    const [attachmentFile, setAttachmentFile] = useState(null);
    const [detailAttachmentUploading, setDetailAttachmentUploading] = useState(false);
    const [excelImportSummary, setExcelImportSummary] = useState(null);
    const [excelSummaryExpanded, setExcelSummaryExpanded] = useState(true);

    // ── Analytics tab state ───────────────────────────────────────────────
    const defaultAnalyticsAy = (() => {
        const y = new Date().getFullYear();
        const month = new Date().getMonth(); // 0-based; AY often starts mid-year
        const start = month >= 5 ? y : y - 1; // Jun+ → current year start
        return `${start}-${start + 1}`;
    })();
    const [analyticsFilters, setAnalyticsFilters] = useState({
        college: '',
        course: '',
        branch: '',
        batch: '',
        academicYear: defaultAnalyticsAy,
    });
    const [analyticsCourses, setAnalyticsCourses] = useState([]);
    const [analyticsBranches, setAnalyticsBranches] = useState([]);
    const [analyticsData, setAnalyticsData] = useState(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsSearch, setAnalyticsSearch] = useState('');
    const [analyticsExpanded, setAnalyticsExpanded] = useState({});
    const [analyticsStatusFilter, setAnalyticsStatusFilter] = useState('all'); // all | sanctioned | partial | pending
    const [analyticsYearFilter, setAnalyticsYearFilter] = useState('all'); // all | 1 | 2 | ...
    const [analyticsSort, setAnalyticsSort] = useState({ key: 'studentName', dir: 'asc' });
    const [analyticsPage, setAnalyticsPage] = useState(1);
    const [analyticsLimit, setAnalyticsLimit] = useState(20);

    useEffect(() => { fetchInitialData(); }, []);

    const listAcademicYears = useMemo(() => (
        [...new Set(proceedings
            .filter(p => p.status === 'Active' || p.status === 'Completed')
            .map(p => p.academicYear)
            .filter(Boolean))]
            .sort()
            .reverse()
    ), [proceedings]);

    useEffect(() => {
        if (academicYearDefaultSet.current || listAcademicYears.length === 0) return;
        setAcademicYearFilter(listAcademicYears[0]);
        academicYearDefaultSet.current = true;
    }, [listAcademicYears]);

    useEffect(() => {
        const tab = getTabFromHash(location.hash);
        setActiveTab(tab);
        if (tab === 'create') {
            setShowEditModal(false);
            setIsEditing(false);
            const draft = readProceedingDraft(user?.username);
            setDraftAvailable(!!draft);
            setDraftSavedAt(draft?.savedAt || null);
        }
    }, [location.hash, canCreate, canList, canEdit, user?.username]);

    // Auto-save create draft (survives refresh)
    useEffect(() => {
        if (activeTab !== 'create' || isEditing) return;
        if (skipNextDraftSave.current) {
            skipNextDraftSave.current = false;
            return;
        }
        const hasContent = !!(
            formData.proceedingNumber
            || formData.amount
            || (formData.colleges || []).length
            || (formData.courses || []).length
            || formData.academicYear
            || loadedStudents.length > 0
            || Object.keys(studentShareAmounts).length > 0
        );
        if (!hasContent) return;

        const timer = setTimeout(() => {
            try {
                const payload = {
                    formData,
                    loadedStudents,
                    studentChecks,
                    studentShareAmounts,
                    studentsLocked,
                    studentSearch,
                    studentQuotaFilter,
                    savedAt: Date.now()
                };
                localStorage.setItem(getProceedingDraftKey(user?.username), JSON.stringify(payload));
                setDraftAvailable(true);
                setDraftSavedAt(payload.savedAt);
            } catch (e) {
                console.warn('Failed to save proceeding draft', e);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [
        activeTab, isEditing, formData, loadedStudents, studentChecks,
        studentShareAmounts, studentsLocked, studentSearch, studentQuotaFilter, user?.username
    ]);

    const clearCreateDraft = () => {
        try {
            localStorage.removeItem(getProceedingDraftKey(user?.username));
        } catch { /* ignore */ }
        setDraftAvailable(false);
        setDraftSavedAt(null);
    };

    const restoreCreateDraft = () => {
        const draft = readProceedingDraft(user?.username);
        if (!draft) {
            Swal.fire('Info', 'No saved draft found', 'info');
            setDraftAvailable(false);
            return;
        }
        skipNextDraftSave.current = true;
        setFormData(normalizeScopeArrays({ ...emptyForm(), ...(draft.formData || {}) }));
        setLoadedStudents(Array.isArray(draft.loadedStudents) ? draft.loadedStudents : []);
        setStudentChecks(draft.studentChecks || {});
        setStudentShareAmounts(draft.studentShareAmounts || {});
        setStudentsLocked(!!draft.studentsLocked);
        setStudentSearch(draft.studentSearch || '');
        setStudentQuotaFilter(draft.studentQuotaFilter || 'All');
        setDraftAvailable(true);
        setDraftSavedAt(draft.savedAt || null);
        Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: 'Draft restored — continue where you left off',
            showConfirmButton: false,
            timer: 2200
        });
    };

    const discardCreateDraft = async () => {
        const confirm = await Swal.fire({
            title: 'Discard draft?',
            text: 'Saved create progress will be cleared.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Discard',
            confirmButtonColor: '#dc2626'
        });
        if (!confirm.isConfirmed) return;
        clearCreateDraft();
        skipNextDraftSave.current = true;
        resetForm();
    };

    // After create, navigate via hash so sidebar stays in sync
    const goToTab = (tab) => {
        window.location.hash = tab;
        setActiveTab(tab);
    };

    const handleAnalyticsCollegeChange = (e) => {
        const college = e.target.value;
        setAnalyticsFilters(f => ({ ...f, college, course: '', branch: '' }));
        setAnalyticsCourses(college ? Object.keys(metadata.hierarchy?.[college] || {}) : []);
        setAnalyticsBranches([]);
        setAnalyticsData(null);
    };

    const handleAnalyticsCourseChange = (e) => {
        const course = e.target.value;
        const college = analyticsFilters.college;
        setAnalyticsFilters(f => ({ ...f, course, branch: '' }));
        setAnalyticsBranches(
            college && course
                ? (metadata.hierarchy?.[college]?.[course]?.branches || [])
                : []
        );
        setAnalyticsData(null);
    };

    const fetchScholarshipAnalytics = async (overridePage = 1, options = {}) => {
        if (!analyticsFilters.college || !analyticsFilters.course) {
            Swal.fire('Warning', 'Please select College and Course', 'warning');
            return;
        }
        if (!analyticsFilters.academicYear) {
            Swal.fire('Warning', 'Please select Academic Year', 'warning');
            return;
        }
        setAnalyticsLoading(true);
        setAnalyticsExpanded({});

        const pageToFetch = overridePage ?? 1;
        const limitToFetch = options.limit ?? analyticsLimit;
        const statusToFetch = options.status !== undefined ? options.status : analyticsStatusFilter;
        const yearToFetch = options.year !== undefined ? options.year : analyticsYearFilter;
        const searchToFetch = options.search !== undefined ? options.search : analyticsSearch;
        const sortToFetch = options.sort || analyticsSort;

        try {
            const params = {
                college: analyticsFilters.college,
                course: analyticsFilters.course,
                academicYear: analyticsFilters.academicYear,
                branch: analyticsFilters.branch || undefined,
                batch: analyticsFilters.batch || undefined,
                page: pageToFetch,
                limit: limitToFetch,
                status: statusToFetch,
                year: yearToFetch,
                search: searchToFetch.trim() || undefined,
                sortBy: sortToFetch.key,
                sortDir: sortToFetch.dir,
            };
            const res = await api.get('/proceedings/scholarship-analytics', { params });
            setAnalyticsData(res.data);
            setAnalyticsPage(res.data.pagination?.page || pageToFetch);
        } catch (err) {
            console.error('Analytics fetch error', err);
            Swal.fire('Error', err.response?.data?.message || 'Failed to load scholarship analytics', 'error');
            setAnalyticsData(null);
        } finally {
            setAnalyticsLoading(false);
        }
    };

    const handleStatusFilterChange = (val) => {
        setAnalyticsStatusFilter(val);
        if (analyticsData) {
            fetchScholarshipAnalytics(1, { status: val });
        }
    };

    const handleYearFilterChange = (val) => {
        setAnalyticsYearFilter(val);
        if (analyticsData) {
            fetchScholarshipAnalytics(1, { year: val });
        }
    };

    const handleLimitChange = (val) => {
        const newLimit = Number(val);
        setAnalyticsLimit(newLimit);
        if (analyticsData) {
            fetchScholarshipAnalytics(1, { limit: newLimit });
        }
    };

    const toggleAnalyticsSort = (key) => {
        const nextSort = analyticsSort.key === key
            ? { key, dir: analyticsSort.dir === 'asc' ? 'desc' : 'asc' }
            : { key, dir: 'asc' };
        setAnalyticsSort(nextSort);
        if (analyticsData) {
            fetchScholarshipAnalytics(1, { sort: nextSort });
        }
    };

    const renderAnalyticsSortTh = (label, sortKey, className = '') => {
        const active = analyticsSort.key === sortKey;
        return (
            <th
                className={`px-3 py-2.5 cursor-pointer select-none hover:text-slate-800 ${className}`}
                onClick={() => toggleAnalyticsSort(sortKey)}
                title={`Sort by ${label}`}
            >
                <span className="inline-flex items-center gap-1">
                    {label}
                    {active ? (
                        analyticsSort.dir === 'asc'
                            ? <ArrowUp size={11} className="text-blue-600 shrink-0" />
                            : <ArrowDown size={11} className="text-blue-600 shrink-0" />
                    ) : (
                        <span className="w-[11px] h-[11px] shrink-0 opacity-20 text-[9px] leading-none">↕</span>
                    )}
                </span>
            </th>
        );
    };

    const filteredAnalyticsStudents = useMemo(() => {
        if (!analyticsData?.students) return [];
        return analyticsData.students.filter(s =>
            groupScholarshipsByYear(s.scholarships).length > 0
        );
    }, [analyticsData]);

    const analyticsYearOptions = useMemo(() => {
        const fromOverview = (analyticsData?.overview?.byYear || []).map(y => Number(y.year)).filter(Boolean);
        if (fromOverview.length) return fromOverview;
        const years = new Set();
        (analyticsData?.students || []).forEach(s => {
            if (Number(s.targetYear) > 0) years.add(Number(s.targetYear));
        });
        return [...years].sort((a, b) => a - b);
    }, [analyticsData]);

    const toggleAnalyticsExpand = (key) => {
        setAnalyticsExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const renderEligibleBadge = (eligible) => (
        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
            String(eligible).toLowerCase() === 'eligible'
                ? 'bg-emerald-50 text-emerald-700'
                : String(eligible).toLowerCase() === 'pending'
                    ? 'bg-amber-50 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
        }`}>
            {eligible || '—'}
        </span>
    );

    const renderScholarshipFeeCell = (feeInfo) => {
        if (!feeInfo) {
            return <span className="text-[10px] text-slate-400 italic">No fee structure found</span>;
        }
        if (feeInfo.amount != null && Number(feeInfo.amount) > 0) {
            return (
                <div>
                    <span className="font-semibold text-violet-700 whitespace-nowrap">{formatAnalyticsAmount(feeInfo.amount)}</span>
                    {feeInfo.heads?.length > 0 && (
                        <div className="text-[9px] text-slate-400 mt-0.5 leading-snug">
                            {feeInfo.heads.map(h => `${h.feeHeadCode || h.feeHeadName}: ${formatAnalyticsAmount(h.amount)}`).join(' · ')}
                        </div>
                    )}
                </div>
            );
        }
        return (
            <span className="text-[10px] text-amber-700 italic" title={feeInfo.note || ''}>
                {feeInfo.note || 'No scholarship applicable fee head'}
            </span>
        );
    };

    const formatAnalyticsDate = (val) => {
        if (!val) return '—';
        const d = new Date(val);
        return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleDateString('en-IN');
    };

    const formatAnalyticsAmount = (val) => {
        if (val == null || val === '') return '—';
        const n = Number(val);
        return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : String(val);
    };

    const fetchInitialData = async () => {
        setLoading(true);
        try {
            const [procRes, metaRes, configRes, fhRes] = await Promise.all([
                api.get('/proceedings'),
                api.get('/students/metadata'),
                api.get('/payment-config').catch(() => ({ data: [] })),
                api.get('/fee-heads?all=true').catch(() => ({ data: [] }))
            ]);
            setProceedings(procRes.data);

            let finalHierarchy = metaRes.data.hierarchy || {};
            const userColleges = (user?.colleges || []).map(c => c.toUpperCase().trim());
            const userCourses = (user?.courses || []).map(c => c.toUpperCase().trim());
            if (user?.role !== 'superadmin' && (userColleges.length > 0 || userCourses.length > 0)) {
                const fh = {};
                Object.entries(finalHierarchy).forEach(([cn, cm]) => {
                    if (userColleges.length > 0 && !userColleges.includes(cn.toUpperCase().trim())) return;
                    const fc = {};
                    Object.entries(cm).forEach(([courseName, branchObj]) => {
                        const ms = `${cn}|${courseName}`.toUpperCase().trim();
                        if (userCourses.length === 0 || userCourses.includes(ms)) fc[courseName] = branchObj;
                    });
                    if (Object.keys(fc).length > 0) fh[cn] = fc;
                });
                finalHierarchy = fh;
            }
            setMetadata({ ...metaRes.data, hierarchy: finalHierarchy });
            setPaymentConfigs(Array.isArray(configRes.data) ? configRes.data.filter(c => c.is_active) : []);
            setFeeHeads(Array.isArray(fhRes.data) ? fhRes.data : []);
        } catch (error) {
            console.error('Error fetching data:', error);
            Swal.fire('Error', 'Failed to load data', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const availableCollegeOptions = useMemo(
        () => Object.keys(metadata.hierarchy || {}),
        [metadata.hierarchy]
    );

    const availableCourseOptions = useMemo(() => {
        const colleges = formData.colleges || [];
        if (!colleges.length) return [];
        const set = new Set();
        colleges.forEach(college => {
            Object.keys(metadata.hierarchy?.[college] || {}).forEach(c => set.add(c));
        });
        return [...set].sort();
    }, [formData.colleges, metadata.hierarchy]);

    const availableBatchOptions = useMemo(() => {
        const fromMeta = metadata.batches || [];
        const fromStudents = loadedStudents.map(s => s.batch).filter(Boolean);
        return [...new Set([...fromMeta, ...fromStudents])].sort();
    }, [metadata.batches, loadedStudents]);

    const setScopeField = (field, values) => {
        setFormData(prev => {
            const next = { ...prev, [field]: values };
            // Drop courses that no longer belong to selected colleges
            if (field === 'colleges') {
                const allowed = new Set();
                values.forEach(college => {
                    Object.keys(metadata.hierarchy?.[college] || {}).forEach(c => allowed.add(c));
                });
                next.courses = (prev.courses || []).filter(c => allowed.has(c));
            }
            return next;
        });
    };

    const handleLoadStudents = async (applicationIdsFilter = null, excelShareByAppId = null, options = {}) => {
        if (
            !String(formData.proceedingNumber || '').trim()
            || !formData.proceedingDate
            || !formData.academicYear
        ) {
            Swal.fire('Warning', 'Please enter Proceeding Number, Date, and Academic Year first', 'warning');
            return { students: [], sharesApplied: 0, autoLocked: false, importSummary: null, shares: {} };
        }

        const excelMode = !!applicationIdsFilter?.length;
        const colleges = formData.colleges || [];
        const courses = formData.courses || [];
        const batches = formData.batches || [];

        if (!excelMode && (!colleges.length || !courses.length)) {
            Swal.fire('Warning', 'Please select College and Course first', 'warning');
            return { students: [], sharesApplied: 0, autoLocked: false, importSummary: null, shares: {} };
        }
        setLoadingStudents(true);
        setStudentQuotaFilter('All');
        try {
            let students = [];
            let importSummary = null;

            if (excelMode) {
                // POST body avoids huge query strings for ~500 application IDs
                const body = { applicationIds: applicationIdsFilter };
                if (options.respectFilters) {
                    if (colleges.length === 1) body.college = colleges[0];
                    if (courses.length === 1) body.course = courses[0];
                    if (formData.caste) body.caste = formData.caste;
                    if (batches.length === 1) body.batch = batches[0];
                }
                const res = await api.post('/proceedings/load-students', body);
                const payload = res.data;
                students = Array.isArray(payload) ? payload : (payload.students || []);
                importSummary = Array.isArray(payload) ? null : (payload.importSummary || null);
            } else {
                // Load each college × course pair and merge (supports multi-select)
                const pairs = [];
                colleges.forEach(college => {
                    courses.forEach(course => {
                        if (metadata.hierarchy?.[college]?.[course]) pairs.push({ college, course });
                    });
                });
                if (pairs.length === 0) {
                    Swal.fire('Warning', 'Selected course(s) do not match the selected college(s)', 'warning');
                    return { students: [], sharesApplied: 0, autoLocked: false, importSummary: null, shares: {} };
                }
                const merged = new Map();
                for (const pair of pairs) {
                    const params = { college: pair.college, course: pair.course };
                    if (formData.caste) params.caste = formData.caste;
                    if (batches.length === 1) params.batch = batches[0];
                    const res = await api.get('/proceedings/load-students', { params });
                    const list = Array.isArray(res.data) ? res.data : (res.data.students || []);
                    list.forEach(s => {
                        if (batches.length > 1 && s.batch && !batches.includes(s.batch)) return;
                        merged.set(s.studentId, s);
                    });
                }
                students = [...merged.values()];
            }

            setLoadedStudents(students);

            let sharesApplied = 0;
            let autoLocked = false;
            const shares = {};

            if (excelMode) {
                const checks = {};
                const n = students.length;
                for (let i = 0; i < n; i++) {
                    const s = students[i];
                    checks[s.studentId] = true;
                    if (excelShareByAppId?.size) {
                        const amt = resolveShareForStudent(s, excelShareByAppId, formData.academicYear);
                        if (amt != null) {
                            shares[s.studentId] = String(amt);
                            sharesApplied += 1;
                        }
                    }
                }
                setStudentChecks(checks);

                // Auto-check colleges / courses / batches from matched Excel students
                if (students.length > 0) {
                    const matchedColleges = [...new Set(students.map(s => s.college).filter(Boolean))].sort();
                    const matchedCourses = [...new Set(students.map(s => s.course).filter(Boolean))].sort();
                    const matchedBatches = [...new Set(students.map(s => s.batch).filter(Boolean))].sort();
                    setFormData(prev => ({
                        ...prev,
                        colleges: matchedColleges,
                        courses: matchedCourses,
                        batches: matchedBatches,
                        caste: '',
                    }));
                }

                if (sharesApplied > 0) {
                    setStudentShareAmounts(shares);
                    const allHaveShares = students.length > 0 && students.every(s => Number(shares[s.studentId]) > 0);
                    if (allHaveShares && formData.academicYear) {
                        let shareTotal = 0;
                        for (const v of Object.values(shares)) shareTotal += Number(v) || 0;
                        if (!(Number(formData.amount) > 0) && shareTotal > 0) {
                            setFormData(prev => ({
                                ...prev,
                                amount: String(Math.round(shareTotal * 100) / 100),
                            }));
                        }
                        setStudentsLocked(true);
                        autoLocked = true;
                    } else {
                        setStudentsLocked(false);
                    }
                } else {
                    setStudentShareAmounts({});
                    setStudentsLocked(false);
                }
            } else {
                setStudentChecks({});
                setStudentShareAmounts({});
                setStudentsLocked(false);
                setExcelImportSummary(null);
            }

            return { students, sharesApplied, autoLocked, importSummary, shares };
        } catch (e) {
            Swal.fire('Error', e.response?.data?.message || 'Failed to load students', 'error');
            return { students: [], sharesApplied: 0, autoLocked: false, importSummary: null, shares: {} };
        } finally {
            setLoadingStudents(false);
        }
    };

    const handleApplicationExcelUpload = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (
            !String(formData.proceedingNumber || '').trim()
            || !formData.proceedingDate
            || !formData.academicYear
        ) {
            Swal.fire('Warning', 'Please enter Proceeding Number, Date, and Academic Year first', 'warning');
            return;
        }
        try {
            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            Swal.fire({
                title: isPdf ? 'Reading PDF…' : 'Reading Excel…',
                html: `<div id="import-read-progress" style="font-size:13px;color:#64748b;margin-top:6px">${isPdf ? 'Preparing…' : 'Parsing rows…'}</div>`,
                allowOutsideClick: false,
                didOpen: () => Swal.showLoading(),
            });
            const parsed = await parseProceedingImportFile(
                file,
                isPdf
                    ? (done, total) => {
                        const el = document.getElementById('import-read-progress');
                        if (el) el.textContent = total > 0 ? `Page ${done} of ${total}` : 'Preparing…';
                    }
                    : undefined
            );
            if (parsed.applicationIds.length === 0) {
                Swal.close();
                Swal.fire(
                    'Warning',
                    file.name.toLowerCase().endsWith('.pdf')
                        ? 'No Student ID / Application ID found in the PDF. Use a text-based PDF (not a scanned image), or upload Excel.'
                        : 'No Student ID / Application ID found in the Excel file.',
                    'warning'
                );
                setExcelImportSummary(null);
                return;
            }

            if (parsed.academicYear && formData.academicYear) {
                const fileAY = formatNormalizedAcademicYear(parsed.academicYear);
                const selectedAY = formatNormalizedAcademicYear(formData.academicYear);
                if (fileAY && selectedAY && fileAY !== selectedAY) {
                    Swal.close();
                    Swal.fire({
                        icon: 'error',
                        title: 'Academic Year Mismatch',
                        html: `<div style="text-align:left;font-size:13px;line-height:1.5">
                            <p>The uploaded file contains Academic Year <strong style="color:#e11d48">${escapeHtml(parsed.academicYear)}</strong>.</p>
                            <p style="margin-top:6px">However, the selected Academic Year in the form is <strong style="color:#2563eb">${escapeHtml(formData.academicYear)}</strong>.</p>
                            <p style="margin-top:10px;color:#64748b;font-size:12px">Please select Academic Year <strong>${escapeHtml(parsed.academicYear)}</strong> in the form or upload a matching file.</p>
                        </div>`,
                        confirmButtonText: 'OK',
                    });
                    setExcelImportSummary(null);
                    return;
                }
            }
            const progressEl = document.getElementById('import-read-progress');
            if (progressEl) {
                progressEl.textContent = `Matching ${parsed.applicationIds.length} IDs against students…`;
            }
            Swal.update({ title: 'Matching students…' });
            const shareByAppId = new Map(
                parsed.entries
                    .filter(e => e.shareAmount != null)
                    .map(e => [e.applicationId.toLowerCase(), e.shareAmount])
            );
            const { students, autoLocked, importSummary, shares } = await handleLoadStudents(
                parsed.applicationIds,
                shareByAppId.size ? shareByAppId : null
            );
            Swal.close();
            const summary = buildExcelImportSummary(
                parsed, students, shares, importSummary, autoLocked, formData.academicYear
            );
            setExcelImportSummary(summary);
            setExcelSummaryExpanded(true);
            showExcelImportResultDialog(summary, students.length > 0, autoLocked);
        } catch (err) {
            console.error('Import parse error', err);
            Swal.close();
            Swal.fire('Error', 'Failed to read the file. For PDF, ensure it is text-based (not scanned).', 'error');
            setExcelImportSummary(null);
        }
    };

    const renderExcelImportSummaryPanel = () => {
        if (!excelImportSummary) return null;
        const s = excelImportSummary;
        const allOk = !s.hasIssues && s.matchedStudents > 0;

        return (
            <div className={`mb-4 rounded-xl border overflow-hidden ${allOk ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                        <div className={`text-xs font-bold uppercase tracking-wide ${allOk ? 'text-emerald-800' : 'text-amber-900'}`}>
                            File import summary
                        </div>
                        <div className={`text-sm font-semibold mt-1 ${allOk ? 'text-emerald-900' : 'text-amber-950'}`}>
                            {s.matchedStudents} of {s.requested} Student ID(s) loaded
                            {s.autoLocked ? ' · Selection locked with shares' : ''}
                        </div>
                        {(s.multiCourse || s.multiBatch || s.courses?.length || s.batches?.length) && (
                            <div className={`text-xs mt-1 ${allOk ? 'text-emerald-800' : 'text-amber-800'}`}>
                                {s.multiCourse
                                    ? `${s.courses.length} courses (${s.courses.slice(0, 6).join(', ')}${s.courses.length > 6 ? '…' : ''})`
                                    : (s.courses?.[0] ? `Course: ${s.courses[0]}` : null)}
                                {(s.multiCourse || s.courses?.[0]) && (s.multiBatch || s.batches?.[0]) ? ' · ' : ''}
                                {s.multiBatch
                                    ? `${s.batches.length} batches (${s.batches.slice(0, 6).join(', ')}${s.batches.length > 6 ? '…' : ''})`
                                    : (s.batches?.[0] ? `Batch: ${s.batches[0]}` : null)}
                            </div>
                        )}
                        {!allOk && (
                            <div className="text-xs text-amber-800 mt-1 space-y-0.5">
                                {s.notFound.length > 0 && <div>{s.notFound.length} ID(s) not loaded — check filters or verify IDs</div>}
                                {s.missingShareInExcel.length > 0 && <div>{s.missingShareInExcel.length} Excel row(s) missing share amount</div>}
                                {s.studentsMissingShare.length > 0 && <div>{s.studentsMissingShare.length} student(s) still need share amounts</div>}
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {(s.notFound.length > 0 || s.missingShareInExcel.length > 0 || s.studentsMissingShare.length > 0) && (
                            <button
                                type="button"
                                onClick={() => setExcelSummaryExpanded(v => !v)}
                                className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white/80 border border-amber-200 text-amber-900 hover:bg-white"
                            >
                                {excelSummaryExpanded ? 'Hide details' : 'Show details'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => setExcelImportSummary(null)}
                            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg bg-white/80 border border-slate-200 text-slate-600 hover:bg-white"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
                {excelSummaryExpanded && (s.notFound.length > 0 || s.missingShareInExcel.length > 0 || s.studentsMissingShare.length > 0) && (
                    <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 border-t border-amber-200/80 pt-3">
                        {s.notFound.length > 0 && (
                            <div className="bg-white/70 rounded-lg p-3 border border-amber-100 min-w-0">
                                <div className="text-[10px] font-bold text-amber-900 uppercase mb-2">Not loaded ({s.notFound.length})</div>
                                <ul className="text-xs text-slate-700 space-y-1.5 max-h-36 overflow-y-auto">
                                    {s.notFound.map(n => (
                                        <li key={n.applicationId} className="border-b border-amber-50 pb-1 last:border-0">
                                            <span className="font-mono font-semibold text-amber-950">{n.applicationId}</span>
                                            {n.message && <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{n.message}</div>}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {s.missingShareInExcel.length > 0 && (
                            <div className="bg-white/70 rounded-lg p-3 border border-amber-100 min-w-0">
                                <div className="text-[10px] font-bold text-amber-900 uppercase mb-2">Missing share in Excel ({s.missingShareInExcel.length})</div>
                                <div className="text-xs font-mono text-slate-700 max-h-36 overflow-y-auto leading-relaxed break-all">
                                    {s.missingShareInExcel.join(', ')}
                                </div>
                            </div>
                        )}
                        {s.studentsMissingShare.length > 0 && (
                            <div className="bg-white/70 rounded-lg p-3 border border-amber-100 min-w-0">
                                <div className="text-[10px] font-bold text-amber-900 uppercase mb-2">Students without share ({s.studentsMissingShare.length})</div>
                                <ul className="text-xs text-slate-700 space-y-1 max-h-36 overflow-y-auto">
                                    {s.studentsMissingShare.map(st => (
                                        <li key={st.studentId}>
                                            <span className="font-semibold">{st.studentName || st.studentId}</span>
                                            <span className="text-slate-500 font-mono text-[10px] ml-1">({st.applicationId})</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const toggleAllStudents = (checked) => {
        const newChecks = {};
        filteredLoadedStudents.forEach(s => { newChecks[s.studentId] = checked; });
        setStudentChecks(prev => ({ ...prev, ...newChecks }));
    };

    const studentQuotas = useMemo(() => {
        const set = new Set();
        loadedStudents.forEach(s => { if (s.studType) set.add(s.studType); });
        return Array.from(set).sort();
    }, [loadedStudents]);

    const getLoadedStudentSortValue = (s, key) => {
        switch (key) {
            case 'studentName': return String(s.studentName || '');
            case 'admissionNumber': return String(s.admissionNumber || '');
            case 'pinNo': return String(s.pinNo || '');
            case 'applicationId': return String(getStudentApplicationId(s, formData.academicYear) || '');
            case 'course': return String(s.course || '');
            case 'batch': return String(s.batch || '');
            case 'studType': return String(s.studType || '');
            case 'caste': return String(s.caste || '');
            case 'studentYear': {
                const n = Number(s.studentYear);
                return Number.isFinite(n) ? n : String(s.studentYear || '');
            }
            case 'proceedingYear': {
                const py = computeProceedingYear(s.batch, formData.academicYear)
                    ?? (Number(s.proceedingYear) > 0 ? Number(s.proceedingYear) : null);
                return Number.isFinite(Number(py)) ? Number(py) : 0;
            }
            case 'shareAmount': {
                const n = Number(studentShareAmounts[s.studentId]);
                return Number.isFinite(n) ? n : 0;
            }
            default: return String(s[key] ?? '');
        }
    };

    const compareLoadedStudentSort = (a, b, key, dir) => {
        const va = getLoadedStudentSortValue(a, key);
        const vb = getLoadedStudentSortValue(b, key);
        let cmp = 0;
        if (typeof va === 'number' && typeof vb === 'number') {
            cmp = va - vb;
        } else {
            cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
        }
        return dir === 'desc' ? -cmp : cmp;
    };

    const toggleStudentSort = (key) => {
        setStudentSort((prev) => (
            prev.key === key
                ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                : { key, dir: 'asc' }
        ));
    };

    const renderStudentSortTh = (label, sortKey, className = '') => {
        const active = studentSort.key === sortKey;
        return (
            <th
                className={`p-2 text-[10px] font-bold text-slate-500 uppercase cursor-pointer select-none hover:text-slate-800 ${className}`}
                onClick={() => toggleStudentSort(sortKey)}
                title={`Sort by ${label}`}
            >
                <span className="inline-flex items-center gap-1">
                    {label}
                    {active ? (
                        studentSort.dir === 'asc'
                            ? <ArrowUp size={11} className="text-blue-600 shrink-0" />
                            : <ArrowDown size={11} className="text-blue-600 shrink-0" />
                    ) : (
                        <span className="w-[11px] h-[11px] shrink-0 opacity-20 text-[9px] leading-none">↕</span>
                    )}
                </span>
            </th>
        );
    };

    const filteredLoadedStudents = useMemo(() => {
        const rows = loadedStudents.filter(s => {
            if (studentQuotaFilter !== 'All' && (s.studType || '') !== studentQuotaFilter) return false;
            if (!studentSearch.trim()) return true;
            const q = studentSearch.toLowerCase();
            return s.studentName?.toLowerCase().includes(q) || s.admissionNumber?.toLowerCase().includes(q) || s.pinNo?.toLowerCase().includes(q)
                || getStudentApplicationId(s, formData.academicYear).toLowerCase().includes(q);
        });
        const { key, dir } = studentSort;
        return [...rows].sort((a, b) => compareLoadedStudentSort(a, b, key, dir));
    }, [loadedStudents, studentSearch, studentQuotaFilter, formData.academicYear, studentSort, studentShareAmounts]);

    const selectedCount = Object.values(studentChecks).filter(Boolean).length;

    const lockedStudents = useMemo(() => {
        const rows = loadedStudents.filter(s => studentChecks[s.studentId]);
        const { key, dir } = studentSort;
        return [...rows].sort((a, b) => compareLoadedStudentSort(a, b, key, dir));
    }, [loadedStudents, studentChecks, studentSort, formData.academicYear, studentShareAmounts]);

    const sharesTotal = useMemo(() => {
        return lockedStudents.reduce((sum, s) => sum + (Number(studentShareAmounts[s.studentId]) || 0), 0);
    }, [lockedStudents, studentShareAmounts]);

    const proceedingAmountNum = Number(formData.amount) || 0;
    const remainingBalance = Math.round((proceedingAmountNum - sharesTotal) * 100) / 100;

    const allSharesValid = studentsLocked
        && lockedStudents.length > 0
        && lockedStudents.every(s => Number(studentShareAmounts[s.studentId]) > 0);

    const canSubmitProceeding = allSharesValid && Math.abs(remainingBalance) <= 0.009 && proceedingAmountNum > 0;

    const canLoadStudentsActions = Boolean(
        String(formData.proceedingNumber || '').trim()
        && formData.proceedingDate
        && formData.academicYear
    );
    const loadStudentsDisabledReason = !canLoadStudentsActions
        ? 'Enter Proceeding Number, Date, and Academic Year first'
        : '';

    const lockSelectedStudents = () => {
        if (!formData.academicYear) {
            Swal.fire('Warning', 'Please select Academic Year first — it is used to calculate each student\'s proceeding year', 'warning');
            return;
        }
        if (!(Number(formData.amount) > 0)) {
            Swal.fire('Warning', 'Please enter the Proceeding Amount at the top first', 'warning');
            return;
        }
        if (selectedCount === 0) {
            Swal.fire('Warning', 'Please select at least one student first', 'warning');
            return;
        }
        setStudentShareAmounts(prev => {
            const next = { ...prev };
            lockedStudents.forEach(s => {
                if (next[s.studentId] === undefined) next[s.studentId] = '';
            });
            return next;
        });
        setStudentsLocked(true);
    };

    const unlockStudents = () => {
        setStudentsLocked(false);
    };

    const handleStudentShareChange = (studentId, value) => {
        setStudentShareAmounts(prev => ({ ...prev, [studentId]: value }));
    };

    const resetForm = () => {
        setFormData(emptyForm());
        setIsEditing(false);
        setLoadedStudents([]);
        setStudentChecks({});
        setStudentShareAmounts({});
        setStudentsLocked(false);
        setStudentSearch('');
        setStudentQuotaFilter('All');
        setAttachmentFile(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
        setExcelImportSummary(null);
        setExcelSummaryExpanded(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!studentsLocked) {
            Swal.fire('Warning', 'Please confirm/lock the selected students, then enter each share amount', 'warning');
            return;
        }
        const selectedStudents = lockedStudents;
        if (selectedStudents.length === 0) {
            Swal.fire('Warning', 'Please load and select at least one student', 'warning');
            return;
        }
        const missing = selectedStudents.find(s => !(Number(studentShareAmounts[s.studentId]) > 0));
        if (missing) {
            Swal.fire('Warning', `Share amount must be greater than zero for ${missing.studentName || missing.admissionNumber}`, 'warning');
            return;
        }
        if (!(Number(formData.amount) > 0)) {
            Swal.fire('Warning', 'Please enter the Proceeding Amount', 'warning');
            return;
        }
        if (remainingBalance < 0) {
            Swal.fire('Warning', `Shares exceed proceeding amount by ₹${Math.abs(remainingBalance).toLocaleString('en-IN')}`, 'warning');
            return;
        }
        if (Math.abs(remainingBalance) > 0.009) {
            Swal.fire('Warning', `Balance must be ₹0 to create. Remaining: ₹${remainingBalance.toLocaleString('en-IN')}`, 'warning');
            return;
        }
        const studentsPayload = selectedStudents.map(s => ({
            ...s,
            shareAmount: Math.round(Number(studentShareAmounts[s.studentId]) * 100) / 100,
            proceedingYear: computeProceedingYear(s.batch, formData.academicYear)
                ?? (Number(s.proceedingYear) > 0 ? Number(s.proceedingYear) : null),
            studentYear: s.studentYear != null && s.studentYear !== '' ? String(s.studentYear) : ''
        }));
        const totalAmount = Math.round(Number(formData.amount) * 100) / 100;
        const headerCollege = headerFromList(formData.colleges);
        const headerCourse = headerFromList(formData.courses);
        const headerBatch = headerFromList(formData.batches);
        if (!headerCollege || !headerCourse) {
            Swal.fire('Warning', 'Please select at least one College and Course (or load from Excel)', 'warning');
            return;
        }

        if (!isEditing) {
            try {
                const dupRes = await api.post('/proceedings/check-duplicate', {
                    academicYear: formData.academicYear,
                    proceedingNumber: formData.proceedingNumber,
                    students: studentsPayload
                });
                if (dupRes.data?.isDuplicate) {
                    const dupConfirm = await Swal.fire({
                        title: 'Duplicate Proceeding Warning!',
                        html: `<div style="text-align:left;font-size:13px;line-height:1.5;">
                            <div style="background-color:#fffbe0;border:1px solid #fde68a;color:#92400e;padding:10px;border-radius:8px;margin-bottom:10px;">
                                <strong>Warning:</strong> A proceeding for Academic Year <strong>${escapeHtml(formData.academicYear)}</strong> with identical student list and share amounts already exists!
                            </div>
                            <p>Existing Proceeding Number: <strong>${escapeHtml(dupRes.data.existingProceeding?.proceedingNumber)}</strong></p>
                            <p>Status: <span style="font-weight:600;color:#1e40af">${escapeHtml(dupRes.data.existingProceeding?.status)}</span> · Total Amount: <strong>₹${dupRes.data.existingProceeding?.amount?.toLocaleString('en-IN')}</strong></p>
                            <p style="margin-top:10px;color:#475569;font-weight:500;">Do you still want to create this proceeding?</p>
                        </div>`,
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, create anyway',
                        cancelButtonText: 'Cancel creation',
                        confirmButtonColor: '#d97706',
                    });
                    if (!dupConfirm.isConfirmed) return;
                }
            } catch (dupErr) {
                console.error('Error checking duplicate proceeding:', dupErr);
            }

            const confirm = await Swal.fire({
                title: 'Create proceeding?',
                html: `<div style="text-align:left;font-size:14px;line-height:1.5">
                    <p>Proceeding <strong>${escapeHtml(formData.proceedingNumber || '')}</strong></p>
                    <p style="margin-top:6px">${selectedStudents.length} student(s) · Amount <strong>₹${totalAmount.toLocaleString('en-IN')}</strong></p>
                    <p style="margin-top:10px;color:#64748b">This will be created as Pending for verification.</p>
                </div>`,
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, create',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#2563eb',
            });
            if (!confirm.isConfirmed) return;
        }

        setIsSaving(true);
        try {
            if (isEditing) {
                const { status, approvedBy, approvedByName, approvedAt, verifiedBy, verifiedByName, verifiedAt, requestedBy, requestedByName, totalUsed, studentCount, feeHead, transactionsGenerated, colleges, courses, batches, attachmentUrl, attachmentName, attachmentKey, ...rest } = formData;
                const editPayload = {
                    ...rest,
                    college: headerCollege,
                    course: headerCourse,
                    batch: headerBatch || '',
                    students: studentsPayload,
                    amount: totalAmount,
                };
                if (attachmentFile) {
                    const fd = new FormData();
                    Object.entries(editPayload).forEach(([key, value]) => {
                        if (key === 'students') fd.append('students', JSON.stringify(value));
                        else if (value != null && value !== '') fd.append(key, value);
                    });
                    fd.append('attachment', attachmentFile);
                    await api.put(`/proceedings/${formData._id}`, fd);
                } else {
                    await api.put(`/proceedings/${formData._id}`, editPayload);
                }
                Swal.fire('Success', 'Proceeding updated successfully', 'success');
                resetForm();
                setShowEditModal(false);
                fetchInitialData();
            } else {
                const { colleges, courses, batches, attachmentUrl, attachmentName, attachmentKey, ...rest } = formData;
                const createPayload = {
                    ...rest,
                    college: headerCollege,
                    course: headerCourse,
                    batch: headerBatch || '',
                    amount: totalAmount,
                    students: studentsPayload
                };
                if (attachmentFile) {
                    const fd = new FormData();
                    Object.entries(createPayload).forEach(([key, value]) => {
                        if (key === 'students') fd.append('students', JSON.stringify(value));
                        else if (value != null && value !== '') fd.append(key, value);
                    });
                    fd.append('attachment', attachmentFile);
                    await api.post('/proceedings', fd);
                } else {
                    await api.post('/proceedings', createPayload);
                }
                Swal.fire('Success', 'Proceeding created — pending verification', 'success');
                clearCreateDraft();
                skipNextDraftSave.current = true;
                resetForm();
                goToTab('pending');
                fetchInitialData();
            }
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to save proceeding', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const handleEdit = async (proc) => {
        if (proc.status !== 'Pending') {
            Swal.fire('Not allowed', 'Only Pending proceedings can be edited.', 'warning');
            return;
        }
        setFormData(normalizeScopeArrays({
            ...proc,
            proceedingDate: proc.proceedingDate ? proc.proceedingDate.split('T')[0] : '',
            bankCreditedDate: proc.bankCreditedDate ? proc.bankCreditedDate.split('T')[0] : ''
        }));
        setAttachmentFile(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
        setIsEditing(true);
        setShowEditModal(true);

        try {
            const res = await api.get(`/proceedings/${proc._id}`);
            if (res.data.students) {
                setLoadedStudents(res.data.students);
                const checks = {};
                const amounts = {};
                res.data.students.forEach(s => {
                    checks[s.studentId] = true;
                    amounts[s.studentId] = s.shareAmount != null && s.shareAmount !== '' ? String(s.shareAmount) : '';
                });
                setStudentChecks(checks);
                setStudentShareAmounts(amounts);
                setStudentsLocked(true);

                // If header was Multiple, derive checkbox selections from students
                const matchedColleges = [...new Set(res.data.students.map(s => s.college).filter(Boolean))].sort();
                const matchedCourses = [...new Set(res.data.students.map(s => s.course).filter(Boolean))].sort();
                const matchedBatches = [...new Set(res.data.students.map(s => s.batch).filter(Boolean))].sort();
                setFormData(prev => ({
                    ...prev,
                    colleges: matchedColleges.length ? matchedColleges : prev.colleges,
                    courses: matchedCourses.length ? matchedCourses : prev.courses,
                    batches: matchedBatches.length ? matchedBatches : prev.batches,
                }));
            }
        } catch (e) {
            console.error('Failed to load proceeding students', e);
        }
    };

    const closeEditModal = () => {
        setShowEditModal(false);
        setIsEditing(false);
        setFormData(emptyForm());
        setLoadedStudents([]);
        setStudentChecks({});
        setStudentShareAmounts({});
        setStudentsLocked(false);
        setStudentSearch('');
        setStudentQuotaFilter('All');
        setAttachmentFile(null);
        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    };

    const handleVerify = async (proc) => {
        const confirm = await Swal.fire({
            title: 'Verify Proceeding?',
            html: `<p><b>${proc.proceedingNumber}</b> will move to <b>Verified</b> status and await approval.</p>`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#4f46e5',
            confirmButtonText: 'Verify'
        });
        if (!confirm.isConfirmed) return;

        try {
            await api.put(`/proceedings/${proc._id}/verify`);
            Swal.fire('Success', 'Proceeding verified successfully', 'success');
            fetchInitialData();
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to verify', 'error');
        }
    };

    const openApproveModal = async (proc) => {
        if (proc.status !== 'Verified') {
            Swal.fire('Not allowed', 'Only Verified proceedings can be approved.', 'warning');
            return;
        }
        setApprovingProc(proc);
        setApproveData({
            bankAccount: proc.bankAccount || '',
            bankCreditedDate: proc.bankCreditedDate ? proc.bankCreditedDate.split('T')[0] : '',
            amount: proc.amount || '',
            bankCreditedAmount: proc.bankCreditedAmount || proc.amount || '',
            feeHead: proc.feeHead?._id || proc.feeHead || ''
        });
        setApproveStudents([]);
        setApproveSkipTransactions(false);
        setShowApproveModal(true);

        try {
            const res = await api.get(`/proceedings/${proc._id}`);
            setApproveStudents((res.data.students || []).map(s => ({
                ...s,
                shareAmount: Number(s.shareAmount) || 0
            })));
        } catch (e) {
            setApproveStudents([]);
        }
    };

    const approveProceedingAmount = Number(approvingProc?.amount || 0);
    const approveSharesTotal = useMemo(
        () => Math.round(approveStudents.reduce((t, s) => t + (Number(s.shareAmount) || 0), 0) * 100) / 100,
        [approveStudents]
    );

    const isStudentAccountProc = approvingProc?.proceedingNature === 'Student Account';
    const approveBankAmount = Number(approveData.bankCreditedAmount) || 0;
    const approveBankMatchesProceeding = approveBankAmount > 0 && Math.abs(approveBankAmount - approveProceedingAmount) <= 0.009;
    const approveSharesMatchProceeding = approveProceedingAmount > 0 && Math.abs(approveSharesTotal - approveProceedingAmount) <= 0.009;
    const canSubmitApprove = isStudentAccountProc
        ? approveSharesMatchProceeding
        : Boolean(
            approveData.bankAccount
            && approveData.bankCreditedAmount
            && approveData.bankCreditedDate
            && approveData.feeHead
            && approveBankMatchesProceeding
            && approveSharesMatchProceeding
        );
    const approveTxnCount = approveStudents.filter(s => Number(s.shareAmount) > 0).length;

    const handleApproveSubmit = async (mode) => {
        // mode: 'now' | 'nightly' | 'skip'
        if (isStudentAccountProc) {
            if (!approveSharesMatchProceeding) {
                Swal.fire(
                    'Warning',
                    `Sum of student shares (₹${approveSharesTotal.toLocaleString('en-IN')}) must equal proceeding amount (₹${approveProceedingAmount.toLocaleString('en-IN')}). Edit the proceeding before approval if shares need to change.`,
                    'warning'
                );
                return;
            }
            mode = 'skip';
        } else {
            if (!approveData.bankAccount || !approveData.bankCreditedAmount || !approveData.bankCreditedDate || !approveData.feeHead) {
                Swal.fire('Warning', 'Please fill Bank Account, Bank Credited Amount, Bank Credited Date, and Fee Head', 'warning');
                return;
            }
            if (!approveBankMatchesProceeding) {
                Swal.fire(
                    'Warning',
                    `Bank credited amount (₹${approveBankAmount.toLocaleString('en-IN')}) must exactly match proceeding amount (₹${approveProceedingAmount.toLocaleString('en-IN')}).`,
                    'warning'
                );
                return;
            }
            if (!approveSharesMatchProceeding) {
                Swal.fire(
                    'Warning',
                    `Sum of student shares (₹${approveSharesTotal.toLocaleString('en-IN')}) must equal proceeding amount (₹${approveProceedingAmount.toLocaleString('en-IN')}). Edit the proceeding before approval if shares need to change.`,
                    'warning'
                );
                return;
            }
        }

        const isSkip = mode === 'skip';
        const generateNow = mode === 'now';
        const confirm = await Swal.fire({
            title: isSkip
                ? 'Skip Transactions & Mark Completed?'
                : generateNow
                    ? 'Approve & Create Transactions Now?'
                    : 'Approve for Nightly Run?',
            html: isSkip
                ? `<p><b>${approvingProc.proceedingNumber}</b> will be marked <b>Completed</b> with <b>no Bank/RTF transactions</b> created.</p>
                   <p style="margin-top:8px;color:#64748b">${approveTxnCount} student(s) stay mapped on the proceeding. Nightly auto-txn will not run for this proceeding.</p>`
                : generateNow
                    ? `<p>${approvingProc.proceedingNumber} will become Active and up to <b>${approveTxnCount} Bank/RTF DEBIT transactions</b> will be created where fee demand allows (same as Fee Collection → Bank → RTF).</p>`
                    : `<p>${approvingProc.proceedingNumber} will become Active. Bank/RTF transactions will be auto-generated during the nightly run where fee demand allows.</p>`,
            icon: isSkip ? 'warning' : 'question',
            showCancelButton: true,
            confirmButtonColor: isSkip ? '#475569' : '#059669',
            confirmButtonText: isSkip
                ? 'Yes, approve & complete'
                : generateNow
                    ? 'Approve & Create Now'
                    : 'Approve for Nightly'
        });
        if (!confirm.isConfirmed) return;

        Swal.fire({
            title: isSkip
                ? 'Approving & Completing...'
                : generateNow
                    ? 'Approving & Creating Transactions...'
                    : 'Approving Proceeding...',
            html: isSkip
                ? '<p>Please wait...</p>'
                : generateNow
                    ? `<p>Generating transactions, please wait...</p>`
                    : '<p>Please wait...</p>',
            allowOutsideClick: false,
            allowEscapeKey: false,
            showConfirmButton: false,
            didOpen: () => Swal.showLoading()
        });

        try {
            const res = await api.put(`/proceedings/${approvingProc._id}/approve`, {
                ...approveData,
                generateTransactionsNow: generateNow,
                skipTransactions: isSkip
            });
            Swal.fire('Success', res.data.message, 'success');
            setShowApproveModal(false);
            setApprovingProc(null);
            setApproveStudents([]);
            setApproveSkipTransactions(false);
            fetchInitialData();
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to approve', 'error');
        }
    };

    const handleDelete = async (id) => {
        const result = await Swal.fire({
            title: 'Are you sure?', text: "This will delete the proceeding and all mapped students.",
            icon: 'warning', showCancelButton: true, confirmButtonColor: '#3085d6', cancelButtonColor: '#d33', confirmButtonText: 'Yes, delete it!'
        });
        if (result.isConfirmed) {
            try {
                await api.delete(`/proceedings/${id}`);
                Swal.fire('Deleted!', 'Proceeding has been deleted.', 'success');
                fetchInitialData();
            } catch (error) {
                Swal.fire('Error', error.response?.data?.message || 'Failed to delete proceeding', 'error');
            }
        }
    };

    const handleCancel = async (proc) => {
        if (proc.status === 'Cancelled') {
            Swal.fire('Info', 'Proceeding is already cancelled.', 'info');
            return;
        }
        const confirm = await Swal.fire({
            title: 'Cancel Proceeding?',
            html: `<div style="text-align:left;font-size:13px;line-height:1.5;">
                <p>Are you sure you want to cancel proceeding <strong>${escapeHtml(proc.proceedingNumber)}</strong>?</p>
                <p style="margin-top:8px;color:#dc2626;font-weight:600;">This action will mark the proceeding as <strong>Cancelled</strong> and exclude it from Scholarship Analytics.</p>
            </div>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            confirmButtonText: 'Yes, cancel proceeding',
            cancelButtonText: 'No, keep active'
        });
        if (!confirm.isConfirmed) return;

        try {
            const res = await api.put(`/proceedings/${proc._id}/cancel`);
            Swal.fire('Cancelled', res.data.message || 'Proceeding cancelled successfully', 'success');
            if (detailModal?.proc?._id === proc._id) {
                closeDetailModal();
            }
            fetchInitialData();
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to cancel proceeding', 'error');
        }
    };

    const handleToggleActive = async (proc) => {
        const isCurrentlyActive = proc.isActive !== false;
        const actionText = isCurrentlyActive ? 'mark as Inactive' : 'Reactivate';
        const confirm = await Swal.fire({
            title: `${isCurrentlyActive ? 'Mark as Inactive' : 'Reactivate'} Proceeding?`,
            html: `<div style="text-align:left;font-size:13px;line-height:1.5;">
                <p>Are you sure you want to ${actionText} proceeding <strong>${escapeHtml(proc.proceedingNumber)}</strong>?</p>
                ${isCurrentlyActive ? '<p style="margin-top:8px;color:#dc2626;font-weight:600;">Inactive proceedings will NOT be included in Scholarship Analytics or duplicate detection.</p>' : '<p style="margin-top:8px;color:#059669;font-weight:600;">Reactivating will include this proceeding back in analytics and duplicate detection.</p>'}
            </div>`,
            icon: isCurrentlyActive ? 'warning' : 'question',
            showCancelButton: true,
            confirmButtonColor: isCurrentlyActive ? '#dc2626' : '#059669',
            confirmButtonText: `Yes, ${actionText}`
        });
        if (!confirm.isConfirmed) return;

        try {
            const res = await api.put(`/proceedings/${proc._id}/toggle-active`, { isActive: !isCurrentlyActive });
            Swal.fire('Success', res.data.message || `Proceeding ${isCurrentlyActive ? 'inactivated' : 'reactivated'} successfully`, 'success');
            if (detailModal?.proc?._id === proc._id) {
                setDetailModal(prev => prev ? { ...prev, proc: { ...prev.proc, isActive: !isCurrentlyActive } } : prev);
            }
            fetchInitialData();
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to update active status', 'error');
        }
    };

    const handlePrint = () => setShowPrintModal(true);

    const executePrint = async () => {
        setShowPrintModal(false);
        try {
            Swal.fire({ title: 'Preparing Print...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const printDataList = await Promise.all(filteredProceedings.map(async (proc) => {
                let studentsList = []; let used = proc.totalUsed || 0;
                if (printOptions.detailed) {
                    try { const res = await api.get(`/proceedings/${proc._id}/summary`); studentsList = res.data.transactions || []; used = res.data.totalUsed || 0; } catch (e) {}
                }
                return { ...proc, totalUsed: used, students: studentsList };
            }));
            const response = await api.post('/print', {
                template: 'proceedings-report',
                data: { reportData: printDataList, includeAbstract: printOptions.abstract, includeDetailed: printOptions.detailed, filters: { collegeFilter, courseFilter, statusFilter: 'Active', searchTerm } }
            });
            Swal.close();
            printHtmlDocument(response.data);
        } catch (error) {
            Swal.close();
            Swal.fire('Error', 'Failed to generate print document', 'error');
        }
    };

    const handlePrintSingle = async (proc) => {
        try {
            Swal.fire({ title: 'Preparing Print...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
            const res = await api.get(`/proceedings/${proc._id}/summary`);
            const response = await api.post('/print', {
                template: 'proceedings-report',
                data: { reportData: [{ ...proc, totalUsed: res.data.totalUsed, students: res.data.transactions || [] }], includeAbstract: false, includeDetailed: true, filters: { collegeFilter: proc.college, courseFilter: proc.course, statusFilter: 'All', searchTerm: '' } }
            });
            Swal.close();
            printHtmlDocument(response.data);
        } catch (error) {
            Swal.close();
            Swal.fire('Error', 'Failed to generate print document', 'error');
        }
    };

    const filteredProceedings = proceedings.filter(p => {
        // All Proceedings tab: Active + Completed (Pending/Verified live in Pending Queue)
        if (p.status !== 'Active' && p.status !== 'Completed') return false;

        const isProcActive = p.isActive !== false;
        if (activeStatusFilter === 'Active' && !isProcActive) return false;
        if (activeStatusFilter === 'Inactive' && isProcActive) return false;

        const matchesSearch = p.proceedingNumber?.toLowerCase().includes(searchTerm.toLowerCase()) || p.college?.toLowerCase().includes(searchTerm.toLowerCase()) || p.course?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCollege = collegeFilter === 'All' || p.college === collegeFilter;
        const matchesCourse = courseFilter === 'All' || p.course === courseFilter;
        const matchesAcademicYear = academicYearFilter === 'All' || p.academicYear === academicYearFilter;
        return matchesSearch && matchesCollege && matchesCourse && matchesAcademicYear;
    });

    // Pending auto-txns across ALL academic years (ignore top AY filter so the note still shows)
    const pendingTxnProceedings = useMemo(() => (
        proceedings
            .filter(p =>
                (p.status === 'Active' || p.status === 'Completed')
                && Number(p.pendingTxnCount) > 0
            )
            .sort((a, b) => Number(b.pendingTxnCount || 0) - Number(a.pendingTxnCount || 0))
    ), [proceedings]);

    const pendingTxnStudentTotal = useMemo(
        () => pendingTxnProceedings.reduce((sum, p) => sum + (Number(p.pendingTxnCount) || 0), 0),
        [pendingTxnProceedings]
    );

    const pendingTxnHiddenByYearFilter = useMemo(() => {
        if (academicYearFilter === 'All') return 0;
        return pendingTxnProceedings.filter(p => p.academicYear !== academicYearFilter).length;
    }, [pendingTxnProceedings, academicYearFilter]);

    const summaryStats = filteredProceedings.reduce((acc, p) => {
        acc.totalAmount += p.amount || 0; acc.totalUsed += p.totalUsed || 0; acc.count += 1;
        return acc;
    }, { totalAmount: 0, totalUsed: 0, count: 0 });
    summaryStats.totalRemaining = Math.max(0, summaryStats.totalAmount - summaryStats.totalUsed);

    const pendingQueue = proceedings.filter(p => {
        // Status filter
        if (pendingStatusFilter === 'Pending') {
            if (p.status !== 'Pending' && p.status !== 'Verified') return false;
        } else if (pendingStatusFilter === 'Pending Only') {
            if (p.status !== 'Pending') return false;
        } else if (pendingStatusFilter === 'Verified Only') {
            if (p.status !== 'Verified') return false;
        } else if (pendingStatusFilter === 'Cancelled') {
            if (p.status !== 'Cancelled') return false;
        } else if (pendingStatusFilter === 'All') {
            if (p.status !== 'Pending' && p.status !== 'Verified' && p.status !== 'Cancelled') return false;
        }

        // College filter
        if (pendingCollegeFilter !== 'All') {
            const scope = formatProceedingScope(p);
            const colleges = scope.colleges.length ? scope.colleges : (p.college && p.college !== 'Multiple' ? [p.college] : []);
            if (!colleges.includes(pendingCollegeFilter)) return false;
        }

        // Course filter
        if (pendingCourseFilter !== 'All') {
            const scope = formatProceedingScope(p);
            const courses = scope.courses.length ? scope.courses : (p.course && p.course !== 'Multiple' ? [p.course] : []);
            if (!courses.includes(pendingCourseFilter)) return false;
        }

        // Academic Year filter
        if (pendingAcademicYearFilter !== 'All') {
            if (p.academicYear !== pendingAcademicYearFilter) return false;
        }

        // Search text filter
        if (!pendingSearch.trim()) return true;
        const q = pendingSearch.toLowerCase();
        const scope = formatProceedingScope(p);
        return p.proceedingNumber?.toLowerCase().includes(q)
            || p.college?.toLowerCase().includes(q)
            || p.course?.toLowerCase().includes(q)
            || scope.collegeLabel.toLowerCase().includes(q)
            || scope.courseLabel.toLowerCase().includes(q)
            || scope.batchLabel.toLowerCase().includes(q)
            || (p.courses || []).some((c) => String(c).toLowerCase().includes(q))
            || (p.batches || []).some((b) => String(b).toLowerCase().includes(q));
    });

    const pendingQueueCount = proceedings.filter(p => p.status === 'Pending' || p.status === 'Verified').length;
    const pendingStatusCount = proceedings.filter(p => p.status === 'Pending').length;
    const verifiedStatusCount = proceedings.filter(p => p.status === 'Verified').length;
    const cancelledStatusCount = proceedings.filter(p => p.status === 'Cancelled').length;

    const openDetailModal = async (proc) => {
        setDetailModal({
            proc,
            loading: true,
            transactions: [],
            mappedStudents: [],
            totalUsed: proc.totalUsed || 0
        });
        try {
            const res = await api.get(`/proceedings/${proc._id}/summary`);
            const scopeProc = {
                ...proc,
                status: res.data.proceedingStatus || proc.status,
                totalUsed: res.data.totalUsed ?? proc.totalUsed,
                colleges: res.data.colleges || proc.colleges,
                courses: res.data.courses || proc.courses,
                batches: res.data.batches || proc.batches,
                cancelledBy: res.data.cancelledBy || proc.cancelledBy,
                cancelledByName: res.data.cancelledByName || proc.cancelledByName,
                cancelledAt: res.data.cancelledAt || proc.cancelledAt,
            };
            setDetailModal({
                proc: scopeProc,
                loading: false,
                transactions: res.data.transactions || [],
                mappedStudents: res.data.mappedStudents || [],
                totalUsed: res.data.totalUsed || 0
            });
            setProceedings(prev => prev.map(p => (
                p._id === proc._id ? {
                    ...p,
                    status: res.data.proceedingStatus || p.status,
                    totalUsed: res.data.totalUsed ?? p.totalUsed,
                    colleges: res.data.colleges || p.colleges,
                    courses: res.data.courses || p.courses,
                    batches: res.data.batches || p.batches,
                    cancelledBy: res.data.cancelledBy || p.cancelledBy,
                    cancelledByName: res.data.cancelledByName || p.cancelledByName,
                    cancelledAt: res.data.cancelledAt || p.cancelledAt,
                } : p
            )));
        } catch (e) {
            setDetailModal(prev => (prev ? { ...prev, loading: false } : null));
            Swal.fire('Error', 'Failed to load proceeding details', 'error');
        }
    };

    const closeDetailModal = () => setDetailModal(null);

    const canAttachProceedingFile = canEdit || canCreate;

    const handleDetailAttachmentUpload = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file || !detailModal?.proc?._id) return;
        if (detailModal.proc.status === 'Cancelled') {
            Swal.fire('Not allowed', 'Cannot attach a file to a cancelled proceeding', 'warning');
            return;
        }
        setDetailAttachmentUploading(true);
        try {
            const fd = new FormData();
            fd.append('attachment', file);
            const res = await api.put(`/proceedings/${detailModal.proc._id}/attachment`, fd);
            const next = {
                attachmentUrl: res.data?.proceeding?.attachmentUrl || '',
                attachmentName: res.data?.proceeding?.attachmentName || file.name,
                attachmentKey: res.data?.proceeding?.attachmentKey || ''
            };
            setDetailModal((prev) => (
                prev ? { ...prev, proc: { ...prev.proc, ...next } } : prev
            ));
            setProceedings((prev) => prev.map((p) => (
                p._id === detailModal.proc._id ? { ...p, ...next } : p
            )));
            Swal.fire('Success', 'Attachment saved', 'success');
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Failed to upload attachment', 'error');
        } finally {
            setDetailAttachmentUploading(false);
        }
    };

    const resolveTxnFeeHeadName = (txn, proc) => {
        if (txn?.feeHead?.name) return txn.feeHead.name;
        if (typeof txn?.feeHead === 'string' && proc?.feeHead?.name) return proc.feeHead.name;
        if (proc?.feeHead?.name) return proc.feeHead.name;
        return '—';
    };

    const renderAuditBlock = (proc) => {
        if (!proc) return null;
        const items = [];
        if (proc.requestedByName || proc.requestedBy) {
            items.push({ label: 'Requested by', value: proc.requestedByName || proc.requestedBy });
        }
        if (proc.verifiedByName || proc.verifiedBy) {
            items.push({ label: 'Verified by', value: proc.verifiedByName || proc.verifiedBy });
        }
        if (proc.approvedByName || proc.approvedBy) {
            items.push({ label: 'Approved by', value: proc.approvedByName || proc.approvedBy });
        }
        if (proc.status === 'Cancelled' || proc.cancelledByName || proc.cancelledBy) {
            const dateStr = proc.cancelledAt ? ` on ${new Date(proc.cancelledAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
            items.push({
                label: 'Cancelled by',
                value: proc.cancelledByName || proc.cancelledBy ? `${proc.cancelledByName || proc.cancelledBy}${dateStr}` : 'System',
                isDanger: true
            });
        }
        if (proc.isActive === false || proc.inactivatedByName || proc.inactivatedBy) {
            const dateStr = proc.inactivatedAt ? ` on ${new Date(proc.inactivatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '';
            items.push({
                label: 'Active Status',
                value: `INACTIVE (marked by ${proc.inactivatedByName || proc.inactivatedBy || 'User'}${dateStr})`,
                isDanger: true
            });
        }
        if (proc.transactionsSkipped) {
            items.push({ label: 'Transactions', value: 'Skipped — marked Completed without auto RTF' });
        }
        if (items.length === 0) return null;
        return (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600 border-b border-slate-100 pb-3 mb-4">
                {items.map((item) => (
                    <span key={item.label} className={item.isDanger ? 'text-red-700 font-medium' : ''}>
                        {item.label}: <b className={item.isDanger ? 'text-red-800 font-bold' : 'text-slate-800'}>{item.value}</b>
                    </span>
                ))}
            </div>
        );
    };

    const renderMappedStudentCard = (s) => {
        const fixedShare = Number(s.shareAmount || 0);
        const usedShare = Number(s.shareUtilized ?? Math.max(0, fixedShare - Number(s.shareRemaining ?? 0)));
        const leftShare = Math.max(0, Number(s.shareRemaining ?? fixedShare - usedShare));
        const needsCollection = leftShare > 0.009;
        const showPending = Boolean(s.txnPending);
        return (
            <div key={`${s.studentId}-${s.admissionNumber}`} className={`border rounded-lg p-2 flex items-center gap-2 ${showPending ? 'bg-amber-50 border-amber-200' : needsCollection ? 'bg-blue-50/60 border-blue-100' : 'bg-emerald-50/40 border-emerald-100'}`}>
                <div className="h-7 w-7 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-[10px] uppercase">{s.studentName?.charAt(0)}</div>
                <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-bold text-slate-800 truncate">{s.studentName}</div>
                    <div className="text-[9px] text-slate-400 font-mono">{s.admissionNumber} {s.pinNo && s.pinNo !== '-' ? `| ${s.pinNo}` : ''}</div>
                    <div className="text-[9px] text-slate-600 mt-0.5 leading-snug">
                        <span className="font-bold">Fixed ₹{fixedShare.toLocaleString('en-IN')}</span>
                        <span className="text-slate-300"> · </span>
                        <span className="font-semibold text-emerald-700">Used ₹{usedShare.toLocaleString('en-IN')}</span>
                        <span className="text-slate-300"> · </span>
                        <span className={`font-semibold ${needsCollection ? 'text-amber-700' : 'text-slate-500'}`}>
                            Left ₹{leftShare.toLocaleString('en-IN')}
                        </span>
                    </div>
                    {showPending && (
                        <div className="text-[9px] font-bold text-amber-700 mt-0.5 truncate" title={s.txnPendingReason || 'Pending auto transaction'}>
                            Pending auto-txn{s.txnPendingReason ? `: ${s.txnPendingReason}` : ''}
                        </div>
                    )}
                    {!showPending && needsCollection && (
                        <div className="text-[9px] font-semibold text-blue-700 mt-0.5">
                            ₹{leftShare.toLocaleString('en-IN')} to collect (Fee Collection)
                        </div>
                    )}
                    {!showPending && !needsCollection && fixedShare > 0 && (
                        <div className="text-[9px] font-semibold text-emerald-700 mt-0.5">Share fully collected</div>
                    )}
                </div>
            </div>
        );
    };

    if (!canView) {
        return (
            <div className="flex min-h-screen bg-slate-50 font-sans">
                <Sidebar />
                <div className="flex-1 p-6 flex items-center justify-center">
                    <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm text-center max-w-sm">
                        <h3 className="font-bold text-slate-800 text-lg mb-2">Access Denied</h3>
                        <p className="text-slate-500 text-xs font-semibold">You do not have view permissions for Proceedings.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="flex min-h-screen bg-slate-50 font-sans">
            <Sidebar />
            <div className="flex-1 min-w-0 p-3 sm:p-5 lg:p-6">
                <div className="w-full max-w-full">
                    {/* Header */}
                    <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                        <div className="min-w-0">
                            <h1 className="text-xl sm:text-2xl font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                                <FileText className="text-gray-800 shrink-0" size={22} />
                                <span className="break-words">Proceedings {TAB_META[activeTab] ? `– ${TAB_META[activeTab].title}` : ''}</span>
                            </h1>
                            <p className="text-xs sm:text-sm text-gray-500 mt-1">
                                {TAB_META[activeTab]?.desc || 'Create → Verify → Approve to generate RTF transactions'}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-end gap-3 self-start sm:self-auto shrink-0">
                            {activeTab === 'create' && canCreate && draftAvailable && (
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 sm:p-3 rounded-xl border border-amber-200 bg-amber-50 max-w-full sm:max-w-md">
                                    <div className="text-[11px] sm:text-xs font-semibold text-amber-800 leading-snug min-w-0">
                                        Draft saved{draftSavedAt ? ` · ${new Date(draftSavedAt).toLocaleString()}` : ''}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button type="button" onClick={restoreCreateDraft} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg">
                                            Restore Draft
                                        </button>
                                        <button type="button" onClick={discardCreateDraft} className="px-3 py-1.5 bg-white border border-amber-200 text-amber-800 text-xs font-bold rounded-lg hover:bg-amber-100">
                                            Discard
                                        </button>
                                    </div>
                                </div>
                            )}
                            {activeTab === 'list' && (
                                <>
                                    <div className="relative min-w-[140px]">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Academic Year</label>
                                        <select
                                            value={academicYearFilter}
                                            onChange={(e) => setAcademicYearFilter(e.target.value)}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                        >
                                            <option value="All">All Years</option>
                                            {listAcademicYears.map(y => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                    </div>
                                    <button onClick={handlePrint} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center gap-2 border border-slate-200">
                                        <Printer size={16} /> Print Report
                                    </button>
                                </>
                            )}
                            {activeTab === 'analytics' && (
                                <div className="relative min-w-[140px]">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Academic Year</label>
                                    <select
                                        value={analyticsFilters.academicYear}
                                        onChange={(e) => {
                                            setAnalyticsFilters(f => ({ ...f, academicYear: e.target.value }));
                                            setAnalyticsData(null);
                                        }}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-8 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                    >
                                        {getAcademicYears().map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                </div>
                            )}
                            {activeTab === 'pending' && (
                                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto justify-end">
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-amber-50 text-amber-800 border-amber-200">
                                        Pending
                                        <span className="min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-900">{pendingStatusCount}</span>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-indigo-50 text-indigo-800 border-indigo-200">
                                        Verified
                                        <span className="min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-900">{verifiedStatusCount}</span>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border bg-red-50 text-red-800 border-red-200">
                                        Cancelled
                                        <span className="min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-md bg-red-100 text-red-900">{cancelledStatusCount}</span>
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ═══ LIST TAB ═══ */}
                    {activeTab === 'list' && (
                        <>
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                                    <div className="p-2.5 bg-blue-50 rounded-xl"><DollarSign size={18} className="text-blue-600" /></div>
                                    <div>
                                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Total Amount</div>
                                        <div className="text-base font-bold text-slate-800">₹{summaryStats.totalAmount.toLocaleString('en-IN')}</div>
                                    </div>
                                </div>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                                    <div className="p-2.5 bg-indigo-50 rounded-xl"><FileText size={18} className="text-indigo-600" /></div>
                                    <div>
                                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Utilized</div>
                                        <div className="text-base font-bold text-indigo-700">₹{summaryStats.totalUsed.toLocaleString('en-IN')}</div>
                                    </div>
                                </div>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                                    <div className="p-2.5 bg-amber-50 rounded-xl"><Calendar size={18} className="text-amber-600" /></div>
                                    <div>
                                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Remaining</div>
                                        <div className="text-base font-bold text-amber-700">₹{summaryStats.totalRemaining.toLocaleString('en-IN')}</div>
                                    </div>
                                </div>
                                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                                    <div className="p-2.5 bg-slate-100 rounded-xl"><GraduationCap size={18} className="text-slate-600" /></div>
                                    <div>
                                        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Records</div>
                                        <div className="text-base font-bold text-slate-800">{summaryStats.count}</div>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-6 flex flex-wrap items-center gap-3">
                                <div className="relative min-w-[200px] flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 transition-all text-sm" />
                                </div>
                                <div className="relative">
                                    <select value={collegeFilter} onChange={(e) => { setCollegeFilter(e.target.value); setCourseFilter('All'); }} className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer">
                                        <option value="All">All Colleges</option>
                                        {metadata?.hierarchy && Object.keys(metadata.hierarchy).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                                <div className="relative">
                                    <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)} className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer">
                                        <option value="All">All Courses</option>
                                        {(() => {
                                            if (collegeFilter !== 'All') return metadata?.hierarchy?.[collegeFilter] && Object.keys(metadata.hierarchy[collegeFilter]).map(c => <option key={c} value={c}>{c}</option>);
                                            const u = new Set();
                                            if (metadata?.hierarchy) Object.values(metadata.hierarchy).forEach(co => { if (co) Object.keys(co).forEach(c => u.add(c)); });
                                            return Array.from(u).map(c => <option key={c} value={c}>{c}</option>);
                                        })()}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                                <div className="relative">
                                    <select value={activeStatusFilter} onChange={(e) => setActiveStatusFilter(e.target.value)} className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-medium text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer">
                                        <option value="Active">Active Proceedings</option>
                                        <option value="Inactive">Inactive Proceedings</option>
                                        <option value="All">All Statuses (Active & Inactive)</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                </div>
                                {(collegeFilter !== 'All' || courseFilter !== 'All' || activeStatusFilter !== 'Active' || searchTerm) && (
                                    <button onClick={() => { setCollegeFilter('All'); setCourseFilter('All'); setActiveStatusFilter('Active'); setSearchTerm(''); setAcademicYearFilter(listAcademicYears[0] || 'All'); }} className="text-xs font-bold text-red-500 hover:text-red-600 py-2 px-3 hover:bg-red-50 rounded-xl">Clear Filters</button>
                                )}
                            </div>

                            {pendingTxnProceedings.length > 0 && (
                                <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3.5 shadow-sm">
                                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                            <div className="mt-0.5 p-1.5 rounded-lg bg-amber-100 border border-amber-200 shrink-0">
                                                <AlertTriangle size={16} className="text-amber-700" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-bold text-amber-900">
                                                    {pendingTxnStudentTotal} pending proceeding transaction{pendingTxnStudentTotal === 1 ? '' : 's'}
                                                    {' '}across {pendingTxnProceedings.length} proceeding{pendingTxnProceedings.length === 1 ? '' : 's'}
                                                </div>
                                                <p className="text-xs text-amber-800/90 mt-0.5 leading-snug">
                                                    Auto RTF/collection could not be created for some mapped students (e.g. no fee-head due).
                                                    {pendingTxnHiddenByYearFilter > 0 && (
                                                        <>
                                                            {' '}
                                                            <span className="font-bold">
                                                                {pendingTxnHiddenByYearFilter} of these are outside Academic Year {academicYearFilter}
                                                            </span>
                                                            {' '}— shown here regardless of the year filter.
                                                        </>
                                                    )}
                                                </p>
                                                <div className="mt-2.5 flex flex-wrap gap-1.5">
                                                    {pendingTxnProceedings.slice(0, 8).map(p => (
                                                        <button
                                                            key={p._id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (p.academicYear) setAcademicYearFilter(p.academicYear);
                                                                setSearchTerm(p.proceedingNumber || '');
                                                                setCollegeFilter('All');
                                                                setCourseFilter('All');
                                                            }}
                                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
                                                            title="Jump to this proceeding"
                                                        >
                                                            <span className="font-mono">{p.proceedingNumber}</span>
                                                            <span className="text-amber-500">·</span>
                                                            <span>{p.academicYear || '—'}</span>
                                                            <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                                                                {p.pendingTxnCount}
                                                            </span>
                                                        </button>
                                                    ))}
                                                    {pendingTxnProceedings.length > 8 && (
                                                        <span className="inline-flex items-center px-2 py-1 text-[11px] font-semibold text-amber-700">
                                                            +{pendingTxnProceedings.length - 8} more
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {academicYearFilter !== 'All' && pendingTxnHiddenByYearFilter > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setAcademicYearFilter('All')}
                                                className="shrink-0 self-start px-3 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors"
                                            >
                                                Show All Years
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                {loading ? (
                                    <div className="py-20 flex justify-center"><Loader2 size={28} className="animate-spin text-blue-600" /></div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                                <th className="p-4 font-semibold text-slate-600 text-sm">College / Course / Caste</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Academic Year</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Proceeding No</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Date</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-center">Students</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-right">Amount / Used</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Bank</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filteredProceedings.length === 0 ? (
                                                <tr>
                                                    <td colSpan="8" className="p-12 text-center text-slate-400 italic text-sm">No active proceedings found</td>
                                                </tr>
                                            ) : filteredProceedings.map(proc => {
                                                const scope = formatProceedingScope(proc);
                                                return (
                                                <tr key={proc._id} className="hover:bg-slate-50/50 transition-colors group">
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-700 text-xs">{scope.collegeLabel}</div>
                                                        <div className="text-[10px] text-slate-500 font-medium uppercase">
                                                            {scope.courseLabel}{scope.batchLabel ? ` (${scope.batchLabel})` : ''} - {proc.caste || 'ALL'}
                                                        </div>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className="px-2.5 py-1 text-xs bg-slate-100 text-slate-700 font-bold rounded-lg border border-slate-200">{proc.academicYear || '-'}</span>
                                                    </td>
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                                                            {proc.proceedingNumber}
                                                            {proc.attachmentUrl && (
                                                                <a
                                                                    href={proc.attachmentUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-indigo-600 hover:text-indigo-800"
                                                                    title={proc.attachmentName || 'View attachment'}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <Paperclip size={13} />
                                                                </a>
                                                            )}
                                                        </div>
                                                        {proc.isActive === false ? (
                                                            <span className="inline-block mt-1 px-2 py-0.5 text-[10px] uppercase font-bold rounded-md border bg-rose-50 text-rose-700 border-rose-200">
                                                                INACTIVE
                                                            </span>
                                                        ) : (
                                                            <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] uppercase font-bold rounded-md border ${STATUS_BADGE[proc.status] || STATUS_BADGE.Active}`}>
                                                                {proc.status || 'Active'}
                                                            </span>
                                                        )}
                                                        {proc.proceedingNature === 'Student Account' && (
                                                            <span className="inline-block mt-1 ml-1 px-2 py-0.5 text-[10px] font-bold rounded-md border bg-purple-50 text-purple-700 border-purple-200">
                                                                Credited to Student Account
                                                            </span>
                                                        )}
                                                        {(proc.pendingTxnCount > 0) && (
                                                            <span className="inline-block mt-1 ml-1 px-2 py-0.5 text-[10px] font-bold rounded-md border bg-amber-50 text-amber-700 border-amber-200">
                                                                {proc.pendingTxnCount} pending txn
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-slate-600 font-medium text-sm">{new Date(proc.proceedingDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                                    <td className="p-4 text-center">
                                                        <span className="px-2 py-1 text-xs font-bold bg-blue-50 text-blue-700 rounded-lg border border-blue-100">{proc.studentCount || 0}</span>
                                                    </td>
                                                    <td className="p-4 text-right">
                                                        <div className="font-bold text-slate-800">₹{(proc.amount || 0).toLocaleString('en-IN')}</div>
                                                        {(() => {
                                                            const used = proc.totalUsed || 0;
                                                            const rem = Math.max(0, (proc.amount || 0) - used);
                                                            return (
                                                                <div className="text-[10px] font-bold">
                                                                    <span className="text-slate-500">USED: ₹{used.toLocaleString('en-IN')}</span>
                                                                    <span className="mx-1 text-slate-300">|</span>
                                                                    <span className={rem === 0 ? "text-red-600 font-extrabold" : "text-emerald-600"}>REM: ₹{rem.toLocaleString('en-IN')}</span>
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="p-4">
                                                        {proc.bankAccount ? (
                                                            <>
                                                                <div className="font-bold text-slate-700 text-xs">{proc.bankAccount}</div>
                                                                {proc.bankCreditedAmount > 0 && <div className="text-[10px] font-bold text-emerald-600">₹{proc.bankCreditedAmount.toLocaleString('en-IN')}</div>}
                                                                <div className="text-[10px] text-slate-500 font-bold">{proc.bankCreditedDate ? new Date(proc.bankCreditedDate).toLocaleDateString() : 'PENDING'}</div>
                                                            </>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 italic">-</span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <div className="flex justify-center gap-1 items-center">
                                                            <button onClick={() => openDetailModal(proc)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="View details"><Eye size={16} /></button>
                                                            <button onClick={() => handlePrintSingle(proc)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Print"><Printer size={16} /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}

                    {/* ═══ CREATE TAB (inline, create only) ═══ */}
                    {activeTab === 'create' && canCreate && (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                            <form onSubmit={handleSubmit} className="p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Proceeding Number *</label>
                                        <input type="text" name="proceedingNumber" value={formData.proceedingNumber} onChange={handleInputChange} required placeholder="PR-2024-001" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm hover:border-slate-300 transition-all" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Proceeding Nature *</label>
                                        <div className="relative">
                                            <select name="proceedingNature" value={formData.proceedingNature || 'College Account'} onChange={handleInputChange} required className="w-full px-3 py-2 pr-8 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm appearance-none cursor-pointer hover:border-slate-300 transition-all">
                                                <option value="College Account">College Account</option>
                                                <option value="Student Account">Student Account</option>
                                            </select>
                                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Proceeding Date *</label>
                                        <input type="date" name="proceedingDate" value={formData.proceedingDate} onChange={handleInputChange} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm hover:border-slate-300 transition-all" />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Academic Year *</label>
                                        <div className="relative">
                                            <select name="academicYear" value={formData.academicYear} onChange={handleInputChange} required className="w-full px-3 py-2 pr-8 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm appearance-none cursor-pointer hover:border-slate-300 transition-all">
                                                <option value="">Select</option>
                                                {getAcademicYears().map(y => <option key={y} value={y}>{y}</option>)}
                                            </select>
                                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Proceeding Amount *</label>
                                        <input
                                            type="number"
                                            name="amount"
                                            value={formData.amount}
                                            onChange={handleInputChange}
                                            required
                                            min="0"
                                            step="0.01"
                                            placeholder="0.00"
                                            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm font-mono hover:border-slate-300 transition-all"
                                        />
                                    </div>
                                </div>

                                <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                        <div className="min-w-0 flex-1">
                                            <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                                                <Paperclip size={13} className="text-slate-400" />
                                                Attachment <span className="font-semibold text-slate-400">(optional)</span>
                                            </label>
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                Upload the related proceeding file (PDF, image, Excel, Word).
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <input
                                                ref={attachmentInputRef}
                                                type="file"
                                                accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                                                className="hidden"
                                                onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => attachmentInputRef.current?.click()}
                                                className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5"
                                            >
                                                <Upload size={14} />
                                                {attachmentFile ? 'Change File' : 'Choose File'}
                                            </button>
                                            {attachmentFile && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAttachmentFile(null);
                                                        if (attachmentInputRef.current) attachmentInputRef.current.value = '';
                                                    }}
                                                    className="px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl"
                                                >
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {attachmentFile ? (
                                        <div className="mt-2 text-xs font-semibold text-indigo-700 truncate">
                                            Selected: {attachmentFile.name}
                                        </div>
                                    ) : formData.attachmentUrl ? (
                                        <a
                                            href={formData.attachmentUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline"
                                        >
                                            <Paperclip size={12} />
                                            {formData.attachmentName || 'View current attachment'}
                                        </a>
                                    ) : null}
                                </div>

                                <div className="bg-slate-50 rounded-xl p-4 mb-4">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                        Student Filters
                                        <span className="normal-case font-semibold text-slate-400"> · multi-select · Excel auto-checks matched courses/batches</span>
                                    </div>
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                                        <MultiCheckDropdown
                                            label="College"
                                            required
                                            options={availableCollegeOptions}
                                            selected={formData.colleges || []}
                                            onChange={(vals) => setScopeField('colleges', vals)}
                                            placeholder="Select college(s)"
                                            readOnly={studentsLocked}
                                        />
                                        <MultiCheckDropdown
                                            label="Course"
                                            required
                                            options={availableCourseOptions}
                                            selected={formData.courses || []}
                                            onChange={(vals) => setScopeField('courses', vals)}
                                            placeholder={(formData.colleges || []).length ? 'Select course(s)' : 'Select college first'}
                                            disabled={!(formData.colleges || []).length && !studentsLocked}
                                            readOnly={studentsLocked}
                                        />
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-slate-600">Caste</label>
                                            <div className="relative">
                                                <select name="caste" value={formData.caste || ''} onChange={handleInputChange} disabled={studentsLocked} className="w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm appearance-none cursor-pointer disabled:opacity-60">
                                                    <option value="">All Castes</option>
                                                    {metadata.castes?.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            </div>
                                        </div>
                                        <MultiCheckDropdown
                                            label="Batch"
                                            options={availableBatchOptions}
                                            selected={formData.batches || []}
                                            onChange={(vals) => setScopeField('batches', vals)}
                                            placeholder="All batches"
                                            readOnly={studentsLocked}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleLoadStudents()}
                                            disabled={!canLoadStudentsActions || loadingStudents || studentsLocked}
                                            title={loadStudentsDisabledReason || undefined}
                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {loadingStudents ? <><Loader2 size={16} className="animate-spin" /> Loading...</> : <><Users size={16} /> Load Students</>}
                                        </button>
                                        <input ref={applicationExcelRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden" onChange={handleApplicationExcelUpload} />
                                        <button
                                            type="button"
                                            onClick={() => applicationExcelRef.current?.click()}
                                            disabled={!canLoadStudentsActions || loadingStudents || studentsLocked}
                                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                            title={loadStudentsDisabledReason || 'Upload Excel or PDF: Student ID + optional Released Amount'}
                                        >
                                            {loadingStudents ? <Loader2 size={16} className="animate-spin" /> : <><Upload size={16} /> Load by File</>}
                                        </button>
                                    </div>
                                    {((formData.colleges || []).length > 1 || (formData.courses || []).length > 1 || (formData.batches || []).length > 1) && (
                                        <div className="mt-3 text-[11px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                                            Multi-scope: {(formData.colleges || []).join(', ') || '—'}
                                            {(formData.courses || []).length ? ` · ${(formData.courses || []).join(', ')}` : ''}
                                            {(formData.batches || []).length ? ` · Batch ${(formData.batches || []).join(', ')}` : ''}
                                        </div>
                                    )}
                                </div>

                                {renderExcelImportSummaryPanel()}

                                {loadedStudents.length > 0 && (
                                    <>
                                    {!studentsLocked ? (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                                        <div className="bg-slate-50 p-3 flex items-center justify-between border-b border-slate-200 flex-wrap gap-2">
                                            <div className="flex items-center gap-3">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input type="checkbox" checked={filteredLoadedStudents.length > 0 && filteredLoadedStudents.every(s => studentChecks[s.studentId])} onChange={(e) => toggleAllStudents(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                                                    <span className="text-xs font-bold text-slate-600">Select All (filtered)</span>
                                                </label>
                                                <span className="text-xs font-bold text-blue-600">{selectedCount} / {loadedStudents.length} selected</span>
                                                {selectedCount > 0 && (
                                                    <button type="button" onClick={() => { const cleared = {}; loadedStudents.forEach(s => { cleared[s.studentId] = false; }); setStudentChecks(cleared); }} className="text-[10px] font-bold text-red-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg transition-colors">
                                                        Clear Selection
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {studentQuotas.length > 0 && (
                                                    <div className="relative">
                                                        <select value={studentQuotaFilter} onChange={(e) => setStudentQuotaFilter(e.target.value)} className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 pr-7 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer">
                                                            <option value="All">All Quotas ({loadedStudents.length})</option>
                                                            {studentQuotas.map(q => {
                                                                const count = loadedStudents.filter(s => s.studType === q).length;
                                                                return <option key={q} value={q}>{q} ({count})</option>;
                                                            })}
                                                        </select>
                                                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                    </div>
                                                )}
                                                <div className="relative">
                                                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                    <input type="text" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search students..." className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-100 w-48" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="max-h-[360px] overflow-y-auto">
                                            <table className="w-full text-left">
                                                <thead className="sticky top-0 bg-white border-b">
                                                    <tr>
                                                        <th className="p-2 w-10"></th>
                                                        {renderStudentSortTh('Name', 'studentName')}
                                                        {renderStudentSortTh('Adm No', 'admissionNumber')}
                                                        {renderStudentSortTh('PIN', 'pinNo')}
                                                        {renderStudentSortTh('Application ID', 'applicationId')}
                                                        {renderStudentSortTh('Course', 'course')}
                                                        {renderStudentSortTh('Batch', 'batch')}
                                                        {renderStudentSortTh('Quota', 'studType')}
                                                        {renderStudentSortTh('Caste', 'caste')}
                                                        {renderStudentSortTh('Year', 'studentYear')}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {filteredLoadedStudents.map(s => (
                                                        <tr key={s.studentId} className={`hover:bg-blue-50/30 transition-colors ${studentChecks[s.studentId] ? '' : 'opacity-50'}`}>
                                                            <td className="p-2">
                                                                <input type="checkbox" checked={!!studentChecks[s.studentId]} onChange={(e) => setStudentChecks(prev => ({ ...prev, [s.studentId]: e.target.checked }))} className="rounded text-blue-600 focus:ring-blue-500" />
                                                            </td>
                                                            <td className="p-2 text-xs font-bold text-slate-800">{s.studentName}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-600">{s.admissionNumber}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-500">{s.pinNo || '-'}</td>
                                                            <td className="p-2 text-xs font-mono font-semibold text-indigo-700">{getStudentApplicationId(s, formData.academicYear)}</td>
                                                            <td className="p-2 text-xs text-slate-600">{s.course || '-'}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-600">{s.batch || '-'}</td>
                                                            <td className="p-2 text-xs text-slate-500">{s.studType || '-'}</td>
                                                            <td className="p-2 text-xs text-slate-500">{s.caste || '-'}</td>
                                                            <td className="p-2 text-xs text-slate-500">{s.studentYear || '-'}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="p-3 border-t border-slate-200 bg-white flex justify-end">
                                            <button type="button" onClick={lockSelectedStudents} disabled={selectedCount === 0} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                                                Confirm Selection ({selectedCount}) & Enter Amounts
                                            </button>
                                        </div>
                                    </div>
                                    ) : (
                                    <div className="border border-indigo-200 rounded-xl overflow-hidden">
                                        <div className="bg-indigo-50 p-3 flex items-center justify-between border-b border-indigo-100 flex-wrap gap-2">
                                            <div>
                                                <div className="text-xs font-bold text-indigo-800">Locked students — enter share for each</div>
                                                <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                                                    {lockedStudents.length} students · Allocated ₹{sharesTotal.toLocaleString('en-IN')}
                                                    {formData.academicYear ? ` · AY ${formData.academicYear}` : ''}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className={`text-sm font-bold ${remainingBalance < 0 ? 'text-red-600' : remainingBalance === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                    Balance ₹{remainingBalance.toLocaleString('en-IN')}
                                                </div>
                                                <div className="text-[10px] text-indigo-500 font-semibold">of ₹{proceedingAmountNum.toLocaleString('en-IN')}</div>
                                            </div>
                                            <button type="button" onClick={unlockStudents} className="text-xs font-bold text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">
                                                Change Selection
                                            </button>
                                        </div>
                                        <div className="max-h-[360px] overflow-y-auto">
                                            <table className="w-full text-left">
                                                <thead className="sticky top-0 bg-white border-b">
                                                    <tr>
                                                        {renderStudentSortTh('Name', 'studentName')}
                                                        {renderStudentSortTh('Adm No', 'admissionNumber')}
                                                        {renderStudentSortTh('PIN', 'pinNo')}
                                                        {renderStudentSortTh('Application ID', 'applicationId')}
                                                        {renderStudentSortTh('Quota', 'studType')}
                                                        {renderStudentSortTh('Batch', 'batch')}
                                                        {renderStudentSortTh('Current Yr', 'studentYear')}
                                                        {renderStudentSortTh('Proc. Yr', 'proceedingYear')}
                                                        {renderStudentSortTh('Share Amount *', 'shareAmount', 'w-36')}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {lockedStudents.map(s => {
                                                        const procYear = computeProceedingYear(s.batch, formData.academicYear)
                                                            ?? (Number(s.proceedingYear) > 0 ? Number(s.proceedingYear) : null);
                                                        return (
                                                        <tr key={s.studentId} className="hover:bg-indigo-50/30">
                                                            <td className="p-2 text-xs font-bold text-slate-800">{s.studentName}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-600">{s.admissionNumber}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-500">{s.pinNo || '-'}</td>
                                                            <td className="p-2 text-xs font-mono font-semibold text-indigo-700">{getStudentApplicationId(s, formData.academicYear)}</td>
                                                            <td className="p-2 text-xs text-slate-500">{s.studType || '-'}</td>
                                                            <td className="p-2 text-xs font-mono text-slate-600">{s.batch || '-'}</td>
                                                            <td className="p-2 text-xs text-slate-600">{formatYearLabel(s.studentYear)}</td>
                                                            <td className="p-2 text-xs font-bold text-indigo-700">{formatYearLabel(procYear)}</td>
                                                            <td className="p-2">
                                                                <input
                                                                    type="number"
                                                                    min="0.01"
                                                                    step="0.01"
                                                                    value={studentShareAmounts[s.studentId] ?? ''}
                                                                    onChange={(e) => handleStudentShareChange(s.studentId, e.target.value)}
                                                                    placeholder="0.00"
                                                                    className={`w-full px-2 py-1.5 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-100 ${
                                                                        !(Number(studentShareAmounts[s.studentId]) > 0)
                                                                            ? 'bg-red-50 border border-red-300'
                                                                            : 'bg-slate-50 border border-slate-200'
                                                                    }`}
                                                                />
                                                            </td>
                                                        </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="p-3 border-t border-indigo-100 bg-indigo-50 flex items-center justify-between gap-3 flex-wrap text-xs font-bold">
                                            <span className="text-indigo-800">Proceeding Amount: ₹{proceedingAmountNum.toLocaleString('en-IN')}</span>
                                            <span className="text-indigo-700">Allocated: ₹{sharesTotal.toLocaleString('en-IN')}</span>
                                            <span className={remainingBalance < 0 ? 'text-red-600' : remainingBalance === 0 ? 'text-emerald-700' : 'text-amber-600'}>
                                                Balance: ₹{remainingBalance.toLocaleString('en-IN')}
                                            </span>
                                        </div>
                                    </div>
                                    )}
                                    </>
                                )}

                                <div className="mt-6 flex justify-end gap-3">
                                    <button type="submit" disabled={!canSubmitProceeding || isSaving} className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                                        {isSaving ? <><Loader2 size={18} className="animate-spin" /> Creating...</> : `Create Proceeding (${lockedStudents.length || selectedCount} students)`}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* ═══ PENDING QUEUE TAB ═══ */}
                    {activeTab === 'pending' && (
                        <>
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 mb-4 flex flex-wrap items-center gap-3">
                                <div className="relative min-w-[200px] flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                                    <input
                                        type="text"
                                        placeholder="Search proceeding number, college, course..."
                                        value={pendingSearch}
                                        onChange={(e) => setPendingSearch(e.target.value)}
                                        className="w-full pl-10 pr-8 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 transition-all text-sm font-medium"
                                    />
                                    {pendingSearch && (
                                        <button
                                            type="button"
                                            onClick={() => setPendingSearch('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-red-500 p-0.5"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>

                                <div className="relative">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Status</label>
                                    <select
                                        value={pendingStatusFilter}
                                        onChange={(e) => setPendingStatusFilter(e.target.value)}
                                        className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                    >
                                        <option value="Pending">Pending & Verified (Default)</option>
                                        <option value="Pending Only">Pending Only</option>
                                        <option value="Verified Only">Verified Only</option>
                                        <option value="Cancelled">Cancelled</option>
                                        <option value="All">All Statuses</option>
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                </div>

                                <div className="relative">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">College</label>
                                    <select
                                        value={pendingCollegeFilter}
                                        onChange={(e) => {
                                            setPendingCollegeFilter(e.target.value);
                                            setPendingCourseFilter('All');
                                        }}
                                        className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                    >
                                        <option value="All">All Colleges</option>
                                        {metadata?.hierarchy && Object.keys(metadata.hierarchy).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                </div>

                                <div className="relative">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Course</label>
                                    <select
                                        value={pendingCourseFilter}
                                        onChange={(e) => setPendingCourseFilter(e.target.value)}
                                        className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                    >
                                        <option value="All">All Courses</option>
                                        {(() => {
                                            if (pendingCollegeFilter !== 'All') return metadata?.hierarchy?.[pendingCollegeFilter] && Object.keys(metadata.hierarchy[pendingCollegeFilter]).map(c => <option key={c} value={c}>{c}</option>);
                                            const u = new Set();
                                            if (metadata?.hierarchy) Object.values(metadata.hierarchy).forEach(co => { if (co) Object.keys(co).forEach(c => u.add(c)); });
                                            return Array.from(u).map(c => <option key={c} value={c}>{c}</option>);
                                        })()}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                </div>

                                <div className="relative">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Academic Year</label>
                                    <select
                                        value={pendingAcademicYearFilter}
                                        onChange={(e) => setPendingAcademicYearFilter(e.target.value)}
                                        className="bg-slate-50 border-none rounded-xl pl-3 pr-8 py-2 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-100 appearance-none cursor-pointer"
                                    >
                                        <option value="All">All Years</option>
                                        {getAcademicYears().map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                    <ChevronDown size={14} className="absolute right-2.5 bottom-2.5 text-slate-500 pointer-events-none" />
                                </div>

                                {(pendingCollegeFilter !== 'All' || pendingCourseFilter !== 'All' || pendingAcademicYearFilter !== 'All' || pendingStatusFilter !== 'Pending' || pendingSearch) && (
                                    <button
                                        onClick={() => {
                                            setPendingCollegeFilter('All');
                                            setPendingCourseFilter('All');
                                            setPendingAcademicYearFilter('All');
                                            setPendingStatusFilter('Pending');
                                            setPendingSearch('');
                                        }}
                                        className="text-xs font-bold text-red-500 hover:text-red-600 py-2 px-3 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                                    >
                                        Clear Filters
                                    </button>
                                )}
                            </div>

                            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                                {loading ? (
                                    <div className="py-20 flex justify-center"><Loader2 size={28} className="animate-spin text-blue-600" /></div>
                                ) : (
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                                <th className="p-4 font-semibold text-slate-600 text-sm min-w-[220px]">Proceeding No</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">College / Course</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-right">Amount</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-center">Students</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Status</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Requested By</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm">Verified By</th>
                                                <th className="p-4 font-semibold text-slate-600 text-sm text-center">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {pendingQueue.length === 0 ? (
                                                <tr>
                                                    <td colSpan="8" className="p-12 text-center text-slate-400 italic text-sm">No pending or verified proceedings</td>
                                                </tr>
                                            ) : pendingQueue.map(proc => (
                                                <tr key={proc._id} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="p-4">
                                                        <div className="font-bold text-slate-800 hover:text-blue-600 cursor-pointer transition-colors flex items-center gap-1.5" onClick={() => openDetailModal(proc)}>
                                                            {proc.proceedingNumber}
                                                            {proc.attachmentUrl && (
                                                                <a
                                                                    href={proc.attachmentUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-indigo-600 hover:text-indigo-800"
                                                                    title={proc.attachmentName || 'View attachment'}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <Paperclip size={13} />
                                                                </a>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 font-medium">
                                                            {proc.proceedingDate ? new Date(proc.proceedingDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}
                                                            {proc.academicYear ? ` · ${proc.academicYear}` : ''}
                                                        </div>
                                                        <div className="mt-1">
                                                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                                                                proc.proceedingNature === 'Student Account'
                                                                    ? 'bg-purple-50 text-purple-700 border-purple-200'
                                                                    : 'bg-slate-100 text-slate-700 border-slate-200'
                                                            }`}>
                                                                {proc.proceedingNature === 'Student Account' ? 'Credited to Student Account' : 'Credited to College Account'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="p-4 cursor-pointer" onClick={() => openDetailModal(proc)}>
                                                        {(() => {
                                                            const scope = formatProceedingScope(proc);
                                                            return (
                                                                <>
                                                                    <div className="font-bold text-slate-700 text-xs">{scope.collegeLabel}</div>
                                                                    <div className="text-[10px] text-slate-500 font-medium uppercase">
                                                                        {scope.courseLabel}{scope.batchLabel ? ` (${scope.batchLabel})` : ''} - {proc.caste || 'ALL'}
                                                                    </div>
                                                                </>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td className="p-4 text-right font-bold text-slate-800">₹{(proc.amount || 0).toLocaleString('en-IN')}</td>
                                                    <td className="p-4 text-center">
                                                        <button
                                                            onClick={() => openDetailModal(proc)}
                                                            className="px-2.5 py-1 text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors flex items-center gap-1.5 mx-auto cursor-pointer"
                                                            title="Click to view & cross-check mapped students"
                                                        >
                                                            <Users size={12} /> {proc.studentCount || 0}
                                                        </button>
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`inline-block px-2 py-0.5 text-[10px] uppercase font-bold rounded-md border ${proc.isActive === false ? 'bg-rose-50 text-rose-700 border-rose-200' : (STATUS_BADGE[proc.status] || STATUS_BADGE.Pending)}`}>
                                                            {proc.isActive === false ? 'INACTIVE' : proc.status}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-xs font-medium text-slate-600">{proc.requestedByName || '-'}</td>
                                                    <td className="p-4 text-xs font-medium text-slate-600">
                                                        {proc.status === 'Cancelled' ? (
                                                            <span className="font-bold text-red-600">{proc.cancelledByName || proc.cancelledBy || 'Cancelled'}</span>
                                                        ) : (proc.verifiedByName || '-')}
                                                     </td>
                                                    <td className="p-4 text-center">
                                                        <button
                                                            onClick={() => openDetailModal(proc)}
                                                            className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors flex items-center gap-1.5 mx-auto cursor-pointer"
                                                            title="View Details & Actions"
                                                        >
                                                            <Eye size={14} className="text-slate-500" /> View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    )}

                    {/* ═══ ANALYTICS TAB ═══ */}
                    {activeTab === 'analytics' && (
                        <div className="space-y-4 animate-fadeIn">
                            {/* Filters */}
                            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 items-end">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">College</label>
                                        <select
                                            value={analyticsFilters.college}
                                            onChange={handleAnalyticsCollegeChange}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100"
                                        >
                                            <option value="">Select College</option>
                                            {metadata?.hierarchy && Object.keys(metadata.hierarchy).map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Course</label>
                                        <select
                                            value={analyticsFilters.course}
                                            onChange={handleAnalyticsCourseChange}
                                            disabled={!analyticsFilters.college}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                                        >
                                            <option value="">Select Course</option>
                                            {(analyticsFilters.college
                                                ? Object.keys(metadata.hierarchy?.[analyticsFilters.college] || {})
                                                : analyticsCourses
                                            ).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Branch</label>
                                        <select
                                            value={analyticsFilters.branch}
                                            onChange={e => { setAnalyticsFilters(f => ({ ...f, branch: e.target.value })); setAnalyticsData(null); }}
                                            disabled={!analyticsFilters.course}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                                        >
                                            <option value="">All Branches</option>
                                            {analyticsBranches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Batch</label>
                                        <select
                                            value={analyticsFilters.batch}
                                            onChange={e => { setAnalyticsFilters(f => ({ ...f, batch: e.target.value })); setAnalyticsData(null); }}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100"
                                        >
                                            <option value="">All Batches</option>
                                            {metadata.batches?.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => fetchScholarshipAnalytics(1)}
                                        disabled={analyticsLoading || !analyticsFilters.college || !analyticsFilters.course || !analyticsFilters.academicYear}
                                        className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {analyticsLoading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                                        {analyticsLoading ? 'Loading...' : 'Get Data'}
                                    </button>
                                </div>
                            </div>

                            {analyticsData?.overview && (
                                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                                    {[
                                        {
                                            label: 'Eligible Students',
                                            value: analyticsData.overview.eligibleStudents,
                                            color: 'text-blue-700',
                                            sub: 'With application ID',
                                            yearKey: 'eligibleStudents',
                                            isAmount: false,
                                        },
                                        {
                                            label: 'Eligible Amount',
                                            value: formatAnalyticsAmount(analyticsData.overview.eligibleAmount),
                                            color: 'text-blue-700',
                                            sub: 'SDMS sanctioned total',
                                            yearKey: 'eligibleAmount',
                                            isAmount: true,
                                        },
                                        {
                                            label: 'Sanctioned Students',
                                            value: analyticsData.overview.mappedStudents,
                                            color: 'text-emerald-700',
                                            sub: Number(analyticsData.overview.partialStudents) > 0
                                                ? `${analyticsData.overview.proceedingCount || 0} proceeding(s) · ${analyticsData.overview.fullStudents || 0} full · ${analyticsData.overview.partialStudents} partial`
                                                : `${analyticsData.overview.proceedingCount || 0} proceeding(s)`,
                                            yearKey: 'mappedStudents',
                                            isAmount: false,
                                        },
                                        {
                                            label: 'Released Amount',
                                            value: formatAnalyticsAmount(analyticsData.overview.releasedAmount),
                                            color: 'text-emerald-700',
                                            sub: 'Proceeding shares',
                                            yearKey: 'releasedAmount',
                                            isAmount: true,
                                        },
                                        {
                                            label: 'Pending Students',
                                            value: analyticsData.overview.pendingStudents,
                                            color: 'text-orange-700',
                                            sub: 'No amount released yet',
                                            yearKey: 'pendingStudents',
                                            isAmount: false,
                                        },
                                        {
                                            label: 'Pending Amount',
                                            value: formatAnalyticsAmount(analyticsData.overview.pendingAmount),
                                            color: 'text-amber-700',
                                            sub: Number(analyticsData.overview.partialStudents) > 0
                                                ? 'Includes partial shortfalls'
                                                : 'Not yet allotted',
                                            yearKey: 'pendingAmount',
                                            isAmount: true,
                                        },
                                    ].map(card => (
                                        <div key={card.label} className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 min-w-0">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{card.label}</p>
                                            <p className={`text-lg xl:text-xl font-black mt-1 tabular-nums ${card.color}`}>{card.value}</p>
                                            {card.sub && <p className="text-[10px] text-slate-400 mt-1 truncate" title={card.sub}>{card.sub}</p>}
                                            {(analyticsData.overview.byYear || []).length > 0 && (
                                                <div className="mt-3 pt-2 border-t border-slate-100 space-y-1">
                                                    {(analyticsData.overview.byYear || []).map((yr) => {
                                                        const count = Number(yr.eligibleStudents) || 0;
                                                        const unit = Number(yr.avgSanctioned) > 0
                                                            ? Number(yr.avgSanctioned)
                                                            : (count > 0 ? Math.round((Number(yr.eligibleAmount) || 0) / count * 100) / 100 : 0);
                                                        const raw = yr[card.yearKey];
                                                        // Eligible Students: show "64 × ₹xx"; Eligible Amount keeps plain total like before
                                                        const display = card.yearKey === 'eligibleStudents' && count > 0 && unit > 0
                                                            ? `${count} × ${formatAnalyticsAmount(unit)}`
                                                            : (card.isAmount ? formatAnalyticsAmount(raw) : (raw ?? 0));
                                                        return (
                                                            <div key={`${card.label}_${yr.year}`} className="flex items-center justify-between gap-2 text-[11px]">
                                                                <span className="font-semibold text-slate-500 shrink-0">{formatYearLabel(yr.year)}</span>
                                                                <span className={`font-bold tabular-nums text-right ${card.color}`}>{display}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {analyticsData && (
                                <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                                    <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <h3 className="text-sm font-bold text-slate-800">Students & Scholarship Applications</h3>
                                            <p className="text-[11px] text-slate-500 mt-0.5">
                                                {analyticsData.pagination ? (
                                                    `Showing ${((analyticsData.pagination.page - 1) * analyticsData.pagination.limit) + (analyticsData.pagination.totalStudents > 0 ? 1 : 0)}–${Math.min(analyticsData.pagination.page * analyticsData.pagination.limit, analyticsData.pagination.totalStudents)} of ${analyticsData.pagination.totalStudents} students`
                                                ) : `${filteredAnalyticsStudents.length} shown`}
                                                {analyticsData.stats ? ` · ${analyticsData.stats.uniqueApplications} applications` : ''}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <div className="relative">
                                                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                                <input
                                                    type="text"
                                                    value={analyticsSearch}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        setAnalyticsSearch(val);
                                                        if (analyticsData && !val) {
                                                            fetchScholarshipAnalytics(1, { search: '' });
                                                        }
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && analyticsData) {
                                                            fetchScholarshipAnalytics(1, { search: analyticsSearch });
                                                        }
                                                    }}
                                                    placeholder="Search name / adm / pin..."
                                                    className="w-48 sm:w-60 pl-8 pr-3 py-2 text-xs border border-slate-200 rounded-lg bg-slate-50 font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100"
                                                />
                                            </div>
                                            <div className="relative">
                                                <select
                                                    value={analyticsStatusFilter}
                                                    onChange={(e) => handleStatusFilterChange(e.target.value)}
                                                    className="appearance-none bg-slate-50 border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 min-w-[140px]"
                                                >
                                                    <option value="all">All Eligible</option>
                                                    <option value="sanctioned">Fully Released</option>
                                                    <option value="partial">Partial Released</option>
                                                    <option value="pending">Pending (None)</option>
                                                </select>
                                                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            </div>
                                            <div className="relative">
                                                <select
                                                    value={analyticsYearFilter}
                                                    onChange={(e) => handleYearFilterChange(e.target.value)}
                                                    className="appearance-none bg-slate-50 border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100 min-w-[110px]"
                                                >
                                                    <option value="all">All Years</option>
                                                    {analyticsYearOptions.map(y => (
                                                        <option key={y} value={String(y)}>{formatYearLabel(y)}</option>
                                                    ))}
                                                </select>
                                                <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                                                <tr>
                                                    <th className="px-3 py-2.5 w-8"></th>
                                                    {renderAnalyticsSortTh('Student', 'studentName')}
                                                    {renderAnalyticsSortTh('Admission No', 'admissionNumber')}
                                                    {renderAnalyticsSortTh('PIN', 'pinNo')}
                                                    {renderAnalyticsSortTh('Branch', 'branch')}
                                                    {renderAnalyticsSortTh('Batch', 'batch')}
                                                    <th className="px-3 py-2.5">Quota</th>
                                                    <th className="px-3 py-2.5">Year</th>
                                                    <th className="px-3 py-2.5">Status</th>
                                                    <th className="px-3 py-2.5 text-center">Applications</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {filteredAnalyticsStudents.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={10} className="px-4 py-10 text-center text-slate-400 font-medium">
                                                            No students match the current filters.
                                                        </td>
                                                    </tr>
                                                ) : filteredAnalyticsStudents.map(student => {
                                                    const rowKey = student.admissionNumber || String(student.sqlId);
                                                    const isOpen = !!analyticsExpanded[rowKey];
                                                    const yearGroups = groupScholarshipsByYear(student.scholarships);
                                                    const hasApps = yearGroups.length > 0;
                                                    const releaseStatus = student.releaseStatus
                                                        || (student.sanctionStatus === 'partial' ? 'partial'
                                                            : student.sanctionStatus === 'sanctioned' ? 'full'
                                                                : 'pending');
                                                    return (
                                                        <React.Fragment key={rowKey}>
                                                            <tr className={`hover:bg-slate-50/80 ${hasApps ? 'cursor-pointer' : ''}`}
                                                                onClick={() => hasApps && toggleAnalyticsExpand(rowKey)}>
                                                                <td className="px-3 py-2.5 text-slate-400">
                                                                    {hasApps ? (
                                                                        <ChevronRight size={14} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                                                    ) : <span className="inline-block w-3.5" />}
                                                                </td>
                                                                <td className="px-3 py-2.5 font-semibold text-slate-800">{student.studentName || '—'}</td>
                                                                <td className="px-3 py-2.5 font-mono text-slate-600">{student.admissionNumber || '—'}</td>
                                                                <td className="px-3 py-2.5 font-mono text-slate-500">{student.pinNo || '—'}</td>
                                                                <td className="px-3 py-2.5 text-slate-600">{student.branch || '—'}</td>
                                                                <td className="px-3 py-2.5 text-slate-600">{student.batch || '—'}</td>
                                                                <td className="px-3 py-2.5 text-slate-600">{student.studType || '—'}</td>
                                                                <td className="px-3 py-2.5 font-bold text-indigo-700">{formatYearLabel(student.targetYear)}</td>
                                                                <td className="px-3 py-2.5">
                                                                    {releaseStatus === 'full' ? (
                                                                        <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-bold text-[10px] border border-emerald-100" title={`Released ${formatAnalyticsAmount(student.releasedAmount)} / Eligible ${formatAnalyticsAmount(student.eligibleAmount)}`}>
                                                                            Full
                                                                        </span>
                                                                    ) : releaseStatus === 'partial' ? (
                                                                        <span className="inline-flex px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 font-bold text-[10px] border border-violet-100" title={`Released ${formatAnalyticsAmount(student.releasedAmount)} · Pending ${formatAnalyticsAmount(student.pendingAmount)}`}>
                                                                            Partial
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-bold text-[10px] border border-amber-100">
                                                                            Pending
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-center">
                                                                    {hasApps ? (
                                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[10px] border border-blue-100">
                                                                            {yearGroups.length} yr
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-300">0</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                            {isOpen && hasApps && (
                                                                <tr className="bg-slate-50/50">
                                                                    <td colSpan={10} className="px-3 py-3">
                                                                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                                                            <table className="w-full text-[11px]">
                                                                                <thead className="bg-slate-100 text-[9px] font-bold text-slate-500 uppercase">
                                                                                    <tr>
                                                                                        <th className="px-2 py-2">Year</th>
                                                                                        <th className="px-2 py-2">Application ID</th>
                                                                                        <th className="px-2 py-2">Eligible</th>
                                                                                        <th className="px-2 py-2">SDMS Sanctioned</th>
                                                                                        <th className="px-2 py-2">Proc. Released</th>
                                                                                        <th className="px-2 py-2">Pending</th>
                                                                                        <th className="px-2 py-2">Scholarship Fee</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody className="divide-y divide-slate-100">
                                                                                    {yearGroups.map(yearRow => {
                                                                                        const feeInfo = student.scholarshipFeeByYear?.[String(yearRow.studentYear)];
                                                                                        return (
                                                                                        <tr key={`${rowKey}_${yearRow.studentYear}`} className="hover:bg-slate-50 bg-white">
                                                                                            <td className="px-2 py-2 font-bold text-slate-800">{yearRow.yearLabel}</td>
                                                                                            <td className="px-2 py-2 font-mono font-semibold text-indigo-700">{yearRow.applicationId}</td>
                                                                                            <td className="px-2 py-2">{renderEligibleBadge(yearRow.eligible)}</td>
                                                                                            <td className="px-2 py-2 whitespace-nowrap font-semibold text-slate-800">{formatAnalyticsAmount(yearRow.sanctionedAmount)}</td>
                                                                                            <td className="px-2 py-2 whitespace-nowrap font-semibold text-emerald-700">{formatAnalyticsAmount(student.releasedAmount)}</td>
                                                                                            <td className="px-2 py-2 whitespace-nowrap font-semibold text-amber-700">{formatAnalyticsAmount(student.pendingAmount)}</td>
                                                                                            <td className="px-2 py-2">{renderScholarshipFeeCell(feeInfo)}</td>
                                                                                        </tr>
                                                                                        );
                                                                                    })}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination Footer */}
                                    {analyticsData.pagination && (
                                        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                                            <div className="text-slate-500 font-medium">
                                                Showing <span className="font-bold text-slate-800">{((analyticsData.pagination.page - 1) * analyticsData.pagination.limit) + (analyticsData.pagination.totalStudents > 0 ? 1 : 0)}</span> to <span className="font-bold text-slate-800">{Math.min(analyticsData.pagination.page * analyticsData.pagination.limit, analyticsData.pagination.totalStudents)}</span> of <span className="font-bold text-slate-800">{analyticsData.pagination.totalStudents}</span> students
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-500 font-medium">Rows per page:</span>
                                                    <select
                                                        value={analyticsLimit}
                                                        onChange={(e) => handleLimitChange(e.target.value)}
                                                        className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-100"
                                                    >
                                                        <option value={10}>10</option>
                                                        <option value={20}>20</option>
                                                        <option value={50}>50</option>
                                                        <option value={100}>100</option>
                                                    </select>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => fetchScholarshipAnalytics(analyticsPage - 1)}
                                                        disabled={analyticsPage <= 1 || analyticsLoading}
                                                        className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                                        title="Previous page"
                                                    >
                                                        <ChevronLeft size={16} />
                                                    </button>
                                                    <span className="px-3 text-xs font-bold text-slate-700">
                                                        Page {analyticsData.pagination.page} of {analyticsData.pagination.totalPages || 1}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => fetchScholarshipAnalytics(analyticsPage + 1)}
                                                        disabled={analyticsPage >= (analyticsData.pagination.totalPages || 1) || analyticsLoading}
                                                        className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                                                        title="Next page"
                                                    >
                                                        <ChevronRight size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {!analyticsData && !analyticsLoading && (
                                <div className="bg-white rounded-xl border border-dashed border-slate-200 p-10 text-center">
                                    <BarChart3 size={32} className="mx-auto text-slate-300 mb-3" />
                                    <p className="text-sm font-semibold text-slate-600">Select College, Course and Academic Year, then click Get Data</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Stats and the student list load together from the same filters.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ GUIDE TAB ═══ */}
                    {activeTab === 'guide' && (
                        <div className="w-full space-y-4 sm:space-y-5">
                            <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-6 lg:p-8">
                                <h2 className="text-base sm:text-lg font-bold text-slate-800 mb-1">Proceedings workflow</h2>
                                <p className="text-xs sm:text-sm text-slate-500 mb-4 sm:mb-6 leading-relaxed">
                                    Follow these steps end-to-end. Flow:{' '}
                                    <span className="font-semibold text-slate-700">Create → Verify → Approve → Transactions (now or nightly)</span>
                                </p>

                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
                                    {[
                                        {
                                            step: 1,
                                            title: 'Create Proceeding',
                                            who: 'User with Create / Edit permission',
                                            color: 'blue',
                                            points: [
                                                'Open Create Proceeding and enter Proceeding Number, Date, Academic Year, and Proceeding Amount (fixed at top).',
                                                'Select College / Course via multi-select checkboxes for normal Load Students, or Load by File (Excel/PDF — auto-checks matched courses/batches).',
                                                'File columns/fields: Student ID / Application ID and optional Released Amount — matches across courses & batches into one proceeding.',
                                                'Students are not selected by default when using Load Students — filter by quota and select manually.',
                                                'Click Confirm Selection & Enter Amounts to lock the list.',
                                                'Enter a share amount for every student (must be greater than zero).',
                                                'Balance = Proceeding Amount − Allocated shares. Create is allowed only when Balance is ₹0.',
                                                'Proceeding Year is calculated from Batch + Academic Year (e.g. batch 2024 + AY 2025-2026 = 2nd Year).',
                                                'Draft is auto-saved; after refresh use Restore Draft to continue.',
                                                'On success the proceeding is saved as Pending.'
                                            ]
                                        },
                                        {
                                            step: 2,
                                            title: 'Verify Proceeding',
                                            who: 'User with Verify permission',
                                            color: 'indigo',
                                            points: [
                                                'Open Pending Queue and find proceedings with status Pending.',
                                                'Review details and mapped students.',
                                                'Click Verify — status becomes Verified.',
                                                'Only Pending proceedings can be edited or deleted.'
                                            ]
                                        },
                                        {
                                            step: 3,
                                            title: 'Approve Proceeding',
                                            who: 'User with Approve permission',
                                            color: 'emerald',
                                            points: [
                                                'Only Verified proceedings can be approved.',
                                                'Enter Bank Account, Bank Credited Date, Bank Credited Amount, and Fee Head.',
                                                'Bank credited amount must exactly match the proceeding amount.',
                                                'Sum of student shares must equal the proceeding amount (edit while Pending if needed).',
                                                'Choose Approve & Create Transactions Now or Approve for Nightly Run.',
                                                'Or check “Skip transactions and mark as completed” — then Approve and Mark as Completed (no RTF txns; students stay mapped; status Completed).'
                                            ]
                                        },
                                        {
                                            step: 4,
                                            title: 'Transactions (Bank → RTF)',
                                            who: 'System (on approve or nightly job)',
                                            color: 'violet',
                                            points: [
                                                'Transactions are created like Fee Collection: Mode Bank / Online, Instrument RTF (paymentMode = RTF).',
                                                'Type: DEBIT · Linked to proceeding · Fee head from approval.',
                                                'Collected by = Approver name · Transaction date = Approval date.',
                                                'Students skipped when share exceeds fee-head demand — collect via Fee Collection.',
                                                'Immediate: created right away. Nightly: status Active with transactionsGenerated = false, then created at 3:00 AM IST by the scheduler.'
                                            ]
                                        },
                                        {
                                            step: 5,
                                            title: 'Auto-Complete',
                                            who: 'System',
                                            color: 'slate',
                                            points: [
                                                'When total RTF collections reach the proceeding limit (REM ₹0), status moves from Active to Completed automatically.',
                                                'Completed proceedings no longer appear in Fee Collection RTF selection.',
                                                'If a linked transaction is cancelled and balance returns, status reopens to Active.'
                                            ]
                                        },
                                        {
                                            step: 6,
                                            title: 'Reports',
                                            who: 'Anyone with report access',
                                            color: 'amber',
                                            points: [
                                                'RTF / proceeding transactions appear in a separate table in College, Account, Cashier, and Daily report templates.',
                                                'That table shows Proceeding Number and Approved By.',
                                                'They are not mixed into the normal Bank / Online list.'
                                            ]
                                        }
                                    ].map((block) => (
                                        <div
                                            key={block.step}
                                            className={`rounded-xl sm:rounded-2xl border border-slate-100 overflow-hidden h-full flex flex-col ${
                                                block.step === 5 ? 'xl:col-span-2' : ''
                                            }`}
                                        >
                                            <div className={`px-3 sm:px-4 py-3 flex items-start gap-3 ${
                                                block.color === 'blue' ? 'bg-blue-50' :
                                                block.color === 'indigo' ? 'bg-indigo-50' :
                                                block.color === 'emerald' ? 'bg-emerald-50' :
                                                block.color === 'violet' ? 'bg-violet-50' : 'bg-amber-50'
                                            }`}>
                                                <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 ${
                                                    block.color === 'blue' ? 'bg-blue-600' :
                                                    block.color === 'indigo' ? 'bg-indigo-600' :
                                                    block.color === 'emerald' ? 'bg-emerald-600' :
                                                    block.color === 'violet' ? 'bg-violet-600' : 'bg-amber-600'
                                                }`}>
                                                    {block.step}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-bold text-slate-800 text-sm sm:text-base">{block.title}</div>
                                                    <div className="text-[11px] sm:text-xs text-slate-500 mt-0.5">{block.who}</div>
                                                </div>
                                            </div>
                                            <ul className="px-3 sm:px-5 py-3 sm:py-4 space-y-2 bg-white flex-1">
                                                {block.points.map((p, i) => (
                                                    <li key={i} className="text-xs sm:text-sm text-slate-600 flex gap-2 leading-relaxed">
                                                        <span className="text-slate-300 font-bold shrink-0 mt-0.5">•</span>
                                                        <span className="min-w-0 break-words">{p}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="bg-slate-900 text-slate-100 rounded-xl sm:rounded-2xl p-4 sm:p-5 text-sm leading-relaxed">
                                <div className="font-bold mb-3 text-white text-sm sm:text-base">Quick status path</div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs font-semibold">
                                    <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-200 border border-amber-400/30">Pending</span>
                                    <span className="text-slate-500 hidden sm:inline">→</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">Verified</span>
                                    <span className="text-slate-500 hidden sm:inline">→</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-400/30">Active</span>
                                    <span className="text-slate-500">→</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-slate-500/20 text-slate-200 border border-slate-400/30">Completed</span>
                                    <span className="text-slate-500 hidden sm:inline">→</span>
                                    <span className="px-2.5 py-1 rounded-lg bg-violet-500/20 text-violet-200 border border-violet-400/30">RTF Transactions</span>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ EDIT MODAL (from Pending Queue only) ═══ */}
            {showEditModal && isEditing && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeEditModal}></div>
                    <div className="relative bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
                        <ModalHeader
                            title="Edit Proceeding"
                            subtitle={formData.proceedingNumber || 'Update pending proceeding details'}
                            onClose={closeEditModal}
                        />

                        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-600">Proceeding Number *</label>
                                    <input type="text" name="proceedingNumber" value={formData.proceedingNumber} onChange={handleInputChange} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm hover:border-slate-300 transition-all" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-600">Proceeding Nature *</label>
                                    <div className="relative">
                                        <select name="proceedingNature" value={formData.proceedingNature || 'College Account'} onChange={handleInputChange} required className="w-full px-3 py-2 pr-8 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm appearance-none cursor-pointer hover:border-slate-300 transition-all">
                                            <option value="College Account">College Account</option>
                                            <option value="Student Account">Student Account</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-600">Proceeding Date *</label>
                                    <input type="date" name="proceedingDate" value={formData.proceedingDate} onChange={handleInputChange} required className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm hover:border-slate-300 transition-all" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-600">Academic Year *</label>
                                    <div className="relative">
                                        <select name="academicYear" value={formData.academicYear} onChange={handleInputChange} required className="w-full px-3 py-2 pr-8 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm appearance-none cursor-pointer hover:border-slate-300 transition-all">
                                            <option value="">Select</option>
                                            {getAcademicYears().map(y => <option key={y} value={y}>{y}</option>)}
                                        </select>
                                        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-slate-600">Proceeding Amount *</label>
                                    <input
                                        type="number"
                                        name="amount"
                                        value={formData.amount}
                                        onChange={handleInputChange}
                                        required
                                        min="0"
                                        step="0.01"
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:bg-white font-medium text-slate-700 text-sm font-mono hover:border-slate-300 transition-all"
                                    />
                                </div>
                            </div>

                            <div className="mb-6 rounded-xl border border-slate-100 bg-slate-50/80 p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    <div className="min-w-0 flex-1">
                                        <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                                            <Paperclip size={13} className="text-slate-400" />
                                            Attachment <span className="font-semibold text-slate-400">(optional)</span>
                                        </label>
                                        <p className="text-[11px] text-slate-500 mt-0.5">
                                            Upload or replace the related proceeding file.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <input
                                            ref={attachmentInputRef}
                                            type="file"
                                            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                                            className="hidden"
                                            onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => attachmentInputRef.current?.click()}
                                            className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl flex items-center gap-1.5"
                                        >
                                            <Upload size={14} />
                                            {attachmentFile ? 'Change File' : 'Choose File'}
                                        </button>
                                        {attachmentFile && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setAttachmentFile(null);
                                                    if (attachmentInputRef.current) attachmentInputRef.current.value = '';
                                                }}
                                                className="px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-xl"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {attachmentFile ? (
                                    <div className="mt-2 text-xs font-semibold text-indigo-700 truncate">
                                        Selected: {attachmentFile.name}
                                    </div>
                                ) : formData.attachmentUrl ? (
                                    <a
                                        href={formData.attachmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline"
                                    >
                                        <Paperclip size={12} />
                                        {formData.attachmentName || 'View current attachment'}
                                    </a>
                                ) : null}
                            </div>

                            <div className="bg-slate-50 rounded-xl p-4 mb-4">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">
                                    Student Filters
                                    <span className="normal-case font-semibold text-slate-400"> · multi-select · Excel auto-checks matched courses/batches</span>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
                                    <MultiCheckDropdown
                                        label="College"
                                        required
                                        options={availableCollegeOptions}
                                        selected={formData.colleges || []}
                                        onChange={(vals) => setScopeField('colleges', vals)}
                                        placeholder="Select college(s)"
                                        readOnly={studentsLocked}
                                    />
                                    <MultiCheckDropdown
                                        label="Course"
                                        required
                                        options={availableCourseOptions}
                                        selected={formData.courses || []}
                                        onChange={(vals) => setScopeField('courses', vals)}
                                        placeholder={(formData.colleges || []).length ? 'Select course(s)' : 'Select college first'}
                                        disabled={!(formData.colleges || []).length && !studentsLocked}
                                        readOnly={studentsLocked}
                                    />
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-slate-600">Caste</label>
                                        <div className="relative">
                                            <select name="caste" value={formData.caste || ''} onChange={handleInputChange} disabled={studentsLocked} className="w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm appearance-none cursor-pointer disabled:opacity-60">
                                                <option value="">All Castes</option>
                                                {metadata.castes?.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                        </div>
                                    </div>
                                    <MultiCheckDropdown
                                        label="Batch"
                                        options={availableBatchOptions}
                                        selected={formData.batches || []}
                                        onChange={(vals) => setScopeField('batches', vals)}
                                        placeholder="All batches"
                                        readOnly={studentsLocked}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleLoadStudents()}
                                        disabled={!canLoadStudentsActions || loadingStudents || studentsLocked}
                                        title={loadStudentsDisabledReason || undefined}
                                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {loadingStudents ? <><Loader2 size={16} className="animate-spin" /> Loading...</> : <><Users size={16} /> Load Students</>}
                                    </button>
                                    <input ref={applicationExcelRef} type="file" accept=".xlsx,.xls,.pdf" className="hidden" onChange={handleApplicationExcelUpload} />
                                    <button
                                        type="button"
                                        onClick={() => applicationExcelRef.current?.click()}
                                        disabled={!canLoadStudentsActions || loadingStudents || studentsLocked}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm flex items-center gap-2 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={loadStudentsDisabledReason || 'Upload Excel or PDF: Student ID + optional Released Amount'}
                                    >
                                        {loadingStudents ? <Loader2 size={16} className="animate-spin" /> : <><Upload size={16} /> Load by File</>}
                                    </button>
                                </div>
                                {((formData.colleges || []).length > 1 || (formData.courses || []).length > 1 || (formData.batches || []).length > 1) && (
                                    <div className="mt-3 text-[11px] text-indigo-700 font-semibold bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                                        Multi-scope: {(formData.colleges || []).join(', ') || '—'}
                                        {(formData.courses || []).length ? ` · ${(formData.courses || []).join(', ')}` : ''}
                                        {(formData.batches || []).length ? ` · Batch ${(formData.batches || []).join(', ')}` : ''}
                                    </div>
                                )}
                            </div>

                            {renderExcelImportSummaryPanel()}

                            {loadedStudents.length > 0 && (
                                <>
                                {!studentsLocked ? (
                                <div className="border border-slate-200 rounded-xl overflow-hidden">
                                    <div className="bg-slate-50 p-3 flex items-center justify-between border-b border-slate-200 flex-wrap gap-2">
                                        <div className="flex items-center gap-3">
                                            <label className="flex items-center gap-2 cursor-pointer">
                                                <input type="checkbox" checked={filteredLoadedStudents.length > 0 && filteredLoadedStudents.every(s => studentChecks[s.studentId])} onChange={(e) => toggleAllStudents(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                                                <span className="text-xs font-bold text-slate-600">Select All (filtered)</span>
                                            </label>
                                            <span className="text-xs font-bold text-blue-600">{selectedCount} / {loadedStudents.length} selected</span>
                                        </div>
                                        <div className="relative">
                                            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input type="text" value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} placeholder="Search students..." className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-blue-100 w-48" />
                                        </div>
                                    </div>
                                    <div className="max-h-[280px] overflow-y-auto">
                                        <table className="w-full text-left">
                                            <thead className="sticky top-0 bg-white border-b">
                                                <tr>
                                                    <th className="p-2 w-10"></th>
                                                    {renderStudentSortTh('Name', 'studentName')}
                                                    {renderStudentSortTh('Adm No', 'admissionNumber')}
                                                    {renderStudentSortTh('PIN', 'pinNo')}
                                                    {renderStudentSortTh('Application ID', 'applicationId')}
                                                    {renderStudentSortTh('Course', 'course')}
                                                    {renderStudentSortTh('Batch', 'batch')}
                                                    {renderStudentSortTh('Quota', 'studType')}
                                                    {renderStudentSortTh('Caste', 'caste')}
                                                    {renderStudentSortTh('Year', 'studentYear')}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {filteredLoadedStudents.map(s => (
                                                    <tr key={s.studentId} className={`hover:bg-blue-50/30 transition-colors ${studentChecks[s.studentId] ? '' : 'opacity-50'}`}>
                                                        <td className="p-2">
                                                            <input type="checkbox" checked={!!studentChecks[s.studentId]} onChange={(e) => setStudentChecks(prev => ({ ...prev, [s.studentId]: e.target.checked }))} className="rounded text-blue-600 focus:ring-blue-500" />
                                                        </td>
                                                        <td className="p-2 text-xs font-bold text-slate-800">{s.studentName}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-600">{s.admissionNumber}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-500">{s.pinNo || '-'}</td>
                                                        <td className="p-2 text-xs font-mono font-semibold text-indigo-700">{getStudentApplicationId(s, formData.academicYear)}</td>
                                                        <td className="p-2 text-xs text-slate-600">{s.course || '-'}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-600">{s.batch || '-'}</td>
                                                        <td className="p-2 text-xs text-slate-500">{s.studType || '-'}</td>
                                                        <td className="p-2 text-xs text-slate-500">{s.caste || '-'}</td>
                                                        <td className="p-2 text-xs text-slate-500">{s.studentYear || '-'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="p-3 border-t border-slate-200 bg-white flex justify-end">
                                        <button type="button" onClick={lockSelectedStudents} disabled={selectedCount === 0} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm disabled:opacity-50">
                                            Confirm Selection ({selectedCount}) & Enter Amounts
                                        </button>
                                    </div>
                                </div>
                                ) : (
                                <div className="border border-indigo-200 rounded-xl overflow-hidden">
                                    <div className="bg-indigo-50 p-3 flex items-center justify-between border-b border-indigo-100 flex-wrap gap-2">
                                        <div>
                                            <div className="text-xs font-bold text-indigo-800">Locked students — enter share for each</div>
                                            <div className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                                                {lockedStudents.length} students · Allocated ₹{sharesTotal.toLocaleString('en-IN')}
                                                {formData.academicYear ? ` · AY ${formData.academicYear}` : ''}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <div className={`text-sm font-bold ${remainingBalance < 0 ? 'text-red-600' : remainingBalance === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                Balance ₹{remainingBalance.toLocaleString('en-IN')}
                                            </div>
                                            <div className="text-[10px] text-indigo-500 font-semibold">of ₹{proceedingAmountNum.toLocaleString('en-IN')}</div>
                                        </div>
                                        <button type="button" onClick={unlockStudents} className="text-xs font-bold text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg">
                                            Change Selection
                                        </button>
                                    </div>
                                    <div className="max-h-[280px] overflow-y-auto">
                                        <table className="w-full text-left">
                                            <thead className="sticky top-0 bg-white border-b">
                                                <tr>
                                                    {renderStudentSortTh('Name', 'studentName')}
                                                    {renderStudentSortTh('Adm No', 'admissionNumber')}
                                                    {renderStudentSortTh('PIN', 'pinNo')}
                                                    {renderStudentSortTh('Application ID', 'applicationId')}
                                                    {renderStudentSortTh('Quota', 'studType')}
                                                    {renderStudentSortTh('Batch', 'batch')}
                                                    {renderStudentSortTh('Current Yr', 'studentYear')}
                                                    {renderStudentSortTh('Proc. Yr', 'proceedingYear')}
                                                    {renderStudentSortTh('Share Amount *', 'shareAmount', 'w-36')}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50">
                                                {lockedStudents.map(s => {
                                                    const procYear = computeProceedingYear(s.batch, formData.academicYear)
                                                        ?? (Number(s.proceedingYear) > 0 ? Number(s.proceedingYear) : null);
                                                    return (
                                                    <tr key={s.studentId} className="hover:bg-indigo-50/30">
                                                        <td className="p-2 text-xs font-bold text-slate-800">{s.studentName}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-600">{s.admissionNumber}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-500">{s.pinNo || '-'}</td>
                                                        <td className="p-2 text-xs font-mono font-semibold text-indigo-700">{getStudentApplicationId(s, formData.academicYear)}</td>
                                                        <td className="p-2 text-xs text-slate-500">{s.studType || '-'}</td>
                                                        <td className="p-2 text-xs font-mono text-slate-600">{s.batch || '-'}</td>
                                                        <td className="p-2 text-xs text-slate-600">{formatYearLabel(s.studentYear)}</td>
                                                        <td className="p-2 text-xs font-bold text-indigo-700">{formatYearLabel(procYear)}</td>
                                                        <td className="p-2">
                                                            <input
                                                                type="number"
                                                                min="0.01"
                                                                step="0.01"
                                                                value={studentShareAmounts[s.studentId] ?? ''}
                                                                onChange={(e) => handleStudentShareChange(s.studentId, e.target.value)}
                                                                placeholder="0.00"
                                                                className={`w-full px-2 py-1.5 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-100 ${
                                                                    !(Number(studentShareAmounts[s.studentId]) > 0)
                                                                        ? 'bg-red-50 border border-red-300'
                                                                        : 'bg-slate-50 border border-slate-200'
                                                                }`}
                                                            />
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="p-3 border-t border-indigo-100 bg-indigo-50 flex items-center justify-between gap-3 flex-wrap text-xs font-bold">
                                        <span className="text-indigo-800">Proceeding Amount: ₹{proceedingAmountNum.toLocaleString('en-IN')}</span>
                                        <span className="text-indigo-700">Allocated: ₹{sharesTotal.toLocaleString('en-IN')}</span>
                                        <span className={remainingBalance < 0 ? 'text-red-600' : remainingBalance === 0 ? 'text-emerald-700' : 'text-amber-600'}>
                                            Balance: ₹{remainingBalance.toLocaleString('en-IN')}
                                        </span>
                                    </div>
                                </div>
                                )}
                                </>
                            )}

                            <div className="mt-6 flex justify-end gap-3">
                                <button type="button" onClick={closeEditModal} className="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100">Cancel</button>
                                <button type="submit" disabled={!canSubmitProceeding || isSaving} className="px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                                    {isSaving ? <><Loader2 size={18} className="animate-spin" /> Updating...</> : 'Update Proceeding'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ═══ PROCEEDING DETAIL MODAL (All Proceedings list) ═══ */}
            {detailModal?.proc && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={closeDetailModal}></div>
                    <div className="relative bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
                        <ModalHeader
                            title={detailModal.proc.proceedingNumber}
                            subtitle={(() => {
                                const scope = formatProceedingScope(detailModal.proc, detailModal.mappedStudents);
                                return `${scope.collegeLabel} / ${scope.courseLabel}${scope.batchLabel ? ` (${scope.batchLabel})` : ''}${detailModal.proc.academicYear ? ` · AY ${detailModal.proc.academicYear}` : ''}`;
                            })()}
                            onClose={closeDetailModal}
                        >
                            <div className="flex flex-wrap gap-2 mt-2">
                                <span className={`px-2 py-0.5 text-[10px] uppercase font-bold rounded-md border ${STATUS_BADGE[detailModal.proc.status] || STATUS_BADGE.Active}`}>
                                    {detailModal.proc.status || 'Active'}
                                </span>
                                {detailModal.proc.proceedingNature === 'Student Account' && (
                                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-md border bg-purple-50 text-purple-700 border-purple-200">
                                        Student Account
                                    </span>
                                )}
                                <span className="text-xs text-slate-500">
                                    {new Date(detailModal.proc.proceedingDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                            </div>
                        </ModalHeader>

                        <div className="p-6 overflow-y-auto flex-1">
                            {renderAuditBlock(detailModal.proc)}

                            <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                                    <div className="min-w-0 flex-1 flex items-start gap-2">
                                        <Paperclip size={14} className="text-slate-500 shrink-0 mt-0.5" />
                                        <div className="min-w-0">
                                            <div className="text-xs font-bold text-slate-700">Attachment</div>
                                            {detailModal.proc.attachmentUrl ? (
                                                <a
                                                    href={detailModal.proc.attachmentUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs font-semibold text-indigo-700 hover:underline truncate block"
                                                >
                                                    {detailModal.proc.attachmentName || 'View attachment'}
                                                </a>
                                            ) : (
                                                <div className="text-[11px] text-slate-500">No file attached yet</div>
                                            )}
                                        </div>
                                    </div>
                                    {canAttachProceedingFile && detailModal.proc.status !== 'Cancelled' && (
                                        <div className="shrink-0">
                                            <input
                                                ref={detailAttachmentInputRef}
                                                type="file"
                                                accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.doc,.docx"
                                                className="hidden"
                                                onChange={handleDetailAttachmentUpload}
                                            />
                                            <button
                                                type="button"
                                                disabled={detailAttachmentUploading}
                                                onClick={() => detailAttachmentInputRef.current?.click()}
                                                className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-50"
                                            >
                                                {detailAttachmentUploading
                                                    ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
                                                    : <><Upload size={13} /> {detailModal.proc.attachmentUrl ? 'Replace File' : 'Attach File'}</>}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {detailModal.loading ? (
                                <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-blue-600" /></div>
                            ) : (
                                <>
                                    {detailModal.mappedStudents.length > 0 && (
                                        <div className="mb-6">
                                            <h4 className="font-bold text-slate-800 flex items-center gap-2 uppercase text-xs tracking-widest mb-3">
                                                <Users size={14} className="text-slate-500" /> Mapped Students ({detailModal.mappedStudents.length})
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                {detailModal.mappedStudents.map((s) => renderMappedStudentCard(s))}
                                            </div>
                                        </div>
                                    )}

                                    <h4 className="font-bold text-slate-800 flex items-center gap-2 uppercase text-xs tracking-widest mb-3">
                                        <User size={14} className="text-slate-500" /> Transactions ({detailModal.transactions.length})
                                    </h4>
                                    {detailModal.transactions.length === 0 ? (
                                        <div className="py-6 text-center text-slate-400 italic text-sm">No transactions linked yet.</div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {detailModal.transactions.map((txn, tidx) => (
                                                <div key={tidx} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm hover:border-slate-300 transition-colors flex justify-between items-start gap-3">
                                                    <div className="flex items-start gap-3 min-w-0">
                                                        <div className="h-8 w-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-500 font-bold text-xs uppercase shrink-0">{txn.studentName?.charAt(0)}</div>
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-bold text-slate-800 truncate">{txn.studentName}</div>
                                                            <div className="text-[10px] text-slate-400 font-mono truncate">{txn.studentId}</div>
                                                            <div className="text-[10px] text-slate-600 font-semibold mt-1 truncate" title={resolveTxnFeeHeadName(txn, detailModal.proc)}>
                                                                Fee Head: {resolveTxnFeeHeadName(txn, detailModal.proc)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <div className="text-xs font-bold text-slate-800">₹{txn.amount.toLocaleString('en-IN')}</div>
                                                        <div className="text-[9px] text-slate-400 font-bold uppercase">{new Date(txn.paymentDate || txn.createdAt).toLocaleDateString()}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {detailModal.proc.amount > 0 && (
                                        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Limit</div>
                                                    <div className="text-sm font-bold text-slate-600">₹{detailModal.proc.amount?.toLocaleString('en-IN')}</div>
                                                </div>
                                                <div className="w-px h-8 bg-slate-200"></div>
                                                <div className="text-right">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Utilized</div>
                                                    <div className="text-sm font-bold text-slate-700">₹{detailModal.totalUsed.toLocaleString('en-IN')}</div>
                                                </div>
                                                <div className="w-px h-8 bg-slate-200"></div>
                                                <div className="text-right">
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase">Remaining</div>
                                                    <div className="text-sm font-bold text-slate-800">₹{Math.max(0, detailModal.proc.amount - detailModal.totalUsed).toLocaleString('en-IN')}</div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
                            <div className="flex flex-wrap items-center gap-2">
                                {/* Verify Action (Pending status) */}
                                {detailModal?.proc?.status === 'Pending' && canVerify && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const p = detailModal.proc;
                                            closeDetailModal();
                                            handleVerify(p);
                                        }}
                                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-md shadow-indigo-100 flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <ShieldCheck size={15} /> Verify Proceeding
                                    </button>
                                )}

                                {/* Approve Action (Verified status) */}
                                {detailModal?.proc?.status === 'Verified' && canApprove && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const p = detailModal.proc;
                                            closeDetailModal();
                                            openApproveModal(p);
                                        }}
                                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md shadow-emerald-100 flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <CheckCircle size={15} /> Approve Proceeding
                                    </button>
                                )}

                                {/* Edit Action (Pending status) */}
                                {detailModal?.proc?.status === 'Pending' && canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const p = detailModal.proc;
                                            closeDetailModal();
                                            handleEdit(p);
                                        }}
                                        className="px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-100 font-bold text-slate-700 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <Edit2 size={14} /> Edit
                                    </button>
                                )}

                                {/* Cancel Action (Pending, Verified, Active status) */}
                                {detailModal?.proc?.status !== 'Cancelled' && detailModal?.proc?.status !== 'Completed' && (canEdit || canApprove || canVerify) && (
                                    <button
                                        type="button"
                                        onClick={() => handleCancel(detailModal.proc)}
                                        className="px-3.5 py-2 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
                                    >
                                        <X size={15} /> Cancel Proceeding
                                    </button>
                                )}

                                {/* Mark as Inactive / Reactivate Action */}
                                {detailModal?.proc?.status !== 'Cancelled' && (canEdit || canApprove || canVerify) && (
                                    <button
                                        type="button"
                                        onClick={() => handleToggleActive(detailModal.proc)}
                                        className={`px-3.5 py-2 border font-bold rounded-xl text-xs flex items-center gap-1.5 cursor-pointer ${
                                            detailModal?.proc?.isActive === false
                                                ? 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700'
                                                : 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700'
                                        }`}
                                    >
                                        {detailModal?.proc?.isActive === false ? (
                                            <><CheckCircle size={15} /> Reactivate Proceeding</>
                                        ) : (
                                            <><AlertTriangle size={15} /> Mark as Inactive</>
                                        )}
                                    </button>
                                )}

                                {/* Delete Action (Pending status) */}
                                {detailModal?.proc?.status === 'Pending' && canEdit && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const id = detailModal.proc._id;
                                            closeDetailModal();
                                            handleDelete(id);
                                        }}
                                        className="px-3 py-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors font-bold text-xs flex items-center gap-1 cursor-pointer"
                                        title="Delete proceeding"
                                    >
                                        <Trash2 size={14} /> Delete
                                    </button>
                                )}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => handlePrintSingle(detailModal.proc)}
                                    className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 flex items-center gap-2 cursor-pointer"
                                >
                                    <Printer size={15} /> Print
                                </button>
                                <button
                                    type="button"
                                    onClick={closeDetailModal}
                                    className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold cursor-pointer"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ APPROVE MODAL ═══ */}
            {showApproveModal && approvingProc && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowApproveModal(false)}></div>
                    <div className="relative bg-white w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[90vh]">
                        <ModalHeader
                            title={`Approve Proceeding — ${approvingProc.proceedingNumber} (₹${(approvingProc.amount || 0).toLocaleString('en-IN')})`}
                            subtitle={`${approvingProc.college} / ${approvingProc.course}${approvingProc.academicYear ? ` · AY ${approvingProc.academicYear}` : ''}`}
                            onClose={() => setShowApproveModal(false)}
                        />

                        <div className="p-6 overflow-y-auto flex-1">
                            {approvingProc.proceedingNature === 'Student Account' ? (
                                <div className="mb-6 p-4 rounded-xl border border-indigo-200 bg-indigo-50/80 text-indigo-900">
                                    <div className="flex items-center gap-2 font-bold text-sm text-indigo-900 mb-1">
                                        <GraduationCap size={18} className="text-indigo-700" />
                                        Proceeding Nature: Student Account (Direct Student Bank Transfer)
                                    </div>
                                    <p className="text-xs text-indigo-800/90 leading-relaxed">
                                        Funds for this proceeding are deposited directly into individual student bank accounts by government. No bank account, credited date, or fee head details are required, and no internal RTF transactions will be generated. Approving will mark this proceeding as <strong>Completed</strong> while retaining mapped students.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-slate-600">Bank Account * <span className="text-slate-400 font-normal">(Fee Collection deposit account)</span></label>
                                            <div className="relative">
                                                <select value={approveData.bankAccount} onChange={(e) => setApproveData(prev => ({ ...prev, bankAccount: e.target.value }))} required className="w-full px-3 py-2 pr-8 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm appearance-none cursor-pointer">
                                                    <option value="">Select Account</option>
                                                    {paymentConfigs.map(c => <option key={c._id} value={c.account_name}>{c.account_name} ({c.bank_name})</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-slate-600">Bank Credited Date * <span className="text-slate-400 font-normal">(instrument / payment date)</span></label>
                                            <input type="date" value={approveData.bankCreditedDate} onChange={(e) => setApproveData(prev => ({ ...prev, bankCreditedDate: e.target.value }))} required className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-slate-600">Bank Credited Amount * <span className="text-slate-400 font-normal">(must match proceeding amount)</span></label>
                                            <input type="number" value={approveData.bankCreditedAmount} onChange={(e) => setApproveData(prev => ({ ...prev, bankCreditedAmount: e.target.value }))} required placeholder="0.00" className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm font-mono" />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-xs font-bold text-slate-600">Fee Head * <span className="text-slate-400 font-normal">(Bank → RTF instrument)</span></label>
                                            <div className="relative">
                                                <select value={approveData.feeHead} onChange={(e) => setApproveData(prev => ({ ...prev, feeHead: e.target.value }))} required className="w-full px-3 py-2 pr-8 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-100 font-medium text-slate-700 text-sm appearance-none cursor-pointer">
                                                    <option value="">Select Fee Head</option>
                                                    {feeHeads.map(fh => <option key={fh._id} value={fh._id}>{fh.name}</option>)}
                                                </select>
                                                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            </div>
                                        </div>
                                    </div>

                                    <label className="mb-3 flex items-start gap-3 p-3 rounded-xl border border-amber-200 bg-amber-50 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={approveSkipTransactions}
                                            onChange={(e) => setApproveSkipTransactions(e.target.checked)}
                                            className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-700 focus:ring-amber-200"
                                        />
                                        <span className="min-w-0">
                                            <span className="block text-sm font-bold text-amber-900">Skip transactions and mark as completed</span>
                                            <span className="block text-[11px] text-amber-800/80 mt-0.5 leading-relaxed">
                                                No Bank/RTF transactions will be created. Students stay mapped; status becomes Completed (not offered in Fee Collection RTF / nightly auto-txn).
                                            </span>
                                        </span>
                                    </label>

                                    {!approveSkipTransactions && (
                                        <div className="mb-4 p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-xs font-semibold">
                                            Transactions will be created like Fee Collection: <span className="font-bold text-slate-800">Mode Bank / Online · Instrument RTF</span>
                                            {' '}(paymentMode = RTF, deposited to selected bank account, date = bank credited date).
                                        </div>
                                    )}

                                    {approveSkipTransactions && (
                                        <div className="mb-4 p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-semibold">
                                            Transactions will be skipped. Proceeding will be approved and marked <span className="font-bold">Completed</span> with students still mapped.
                                        </div>
                                    )}
                                </>
                            )}

                            {!approveBankMatchesProceeding && approveBankAmount > 0 && (
                                <div className="mb-4 p-3 rounded-xl border border-red-300 bg-red-50 text-red-800 text-xs font-semibold">
                                    Bank credited amount (₹{approveBankAmount.toLocaleString('en-IN')}) must exactly match proceeding amount (₹{approveProceedingAmount.toLocaleString('en-IN')}).
                                </div>
                            )}

                            {!approveSharesMatchProceeding && approveProceedingAmount > 0 && (
                                <div className="mb-4 p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold">
                                    Sum of student shares (₹{approveSharesTotal.toLocaleString('en-IN')}) must equal proceeding amount (₹{approveProceedingAmount.toLocaleString('en-IN')}). Edit the proceeding while Pending if shares need correction.
                                </div>
                            )}

                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mapped Students & Shares ({approveStudents.length})</div>
                                    <div className="text-xs font-bold text-slate-600">
                                        Shares ₹{approveSharesTotal.toLocaleString('en-IN')}
                                        {approveProceedingAmount > 0 && (
                                            <span className={`ml-2 ${approveSharesMatchProceeding ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                · Proceeding ₹{approveProceedingAmount.toLocaleString('en-IN')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="bg-slate-50 rounded-xl p-3 max-h-[280px] overflow-y-auto border border-slate-100">
                                    {approveStudents.length === 0 ? (
                                        <div className="text-xs text-slate-400 italic text-center py-4">Loading students...</div>
                                    ) : (
                                        <table className="w-full text-left">
                                            <thead className="sticky top-0 bg-slate-50">
                                                <tr>
                                                    <th className="pb-2 text-[10px] font-bold text-slate-500 uppercase">Student</th>
                                                    <th className="pb-2 text-[10px] font-bold text-slate-500 uppercase">Adm No</th>
                                                    <th className="pb-2 text-[10px] font-bold text-slate-500 uppercase">PIN</th>
                                                    <th className="pb-2 text-[10px] font-bold text-slate-500 uppercase">Proc. Yr</th>
                                                    <th className="pb-2 text-[10px] font-bold text-slate-500 uppercase text-right">Share</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {approveStudents.map((s) => {
                                                    const procYear = Number(s.proceedingYear) > 0
                                                        ? Number(s.proceedingYear)
                                                        : computeProceedingYear(s.batch, approvingProc.academicYear);
                                                    return (
                                                    <tr key={s.studentId}>
                                                        <td className="py-1.5 text-xs font-medium text-slate-700">{s.studentName}</td>
                                                        <td className="py-1.5 text-xs font-mono text-slate-500">{s.admissionNumber}</td>
                                                        <td className="py-1.5 text-xs font-mono text-slate-500">{s.pinNo || '-'}</td>
                                                        <td className="py-1.5 text-xs font-bold text-indigo-700">{formatYearLabel(procYear)}</td>
                                                        <td className="py-1.5 text-xs font-bold text-right font-mono text-indigo-700">
                                                            ₹{Number(s.shareAmount || 0).toLocaleString('en-IN')}
                                                        </td>
                                                    </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 text-xs font-bold text-slate-600 text-center">
                                {approveTxnCount} mapped student(s)
                                {approveSkipTransactions
                                    ? ' · no transactions will be created'
                                    : ' · transactions created where fee demand allows'}
                            </div>

                            <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowApproveModal(false);
                                        setApproveSkipTransactions(false);
                                    }}
                                    className="px-6 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 text-sm"
                                >
                                    Cancel
                                </button>
                                {approvingProc.proceedingNature === 'Student Account' ? (
                                    <button
                                        type="button"
                                        onClick={() => handleApproveSubmit('skip')}
                                        disabled={!canSubmitApprove}
                                        className="flex-1 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm shadow-md"
                                    >
                                        <CheckCircle size={18} /> Approve & Mark Completed (Student Account)
                                    </button>
                                ) : approveSkipTransactions ? (
                                    <button
                                        type="button"
                                        onClick={() => handleApproveSubmit('skip')}
                                        disabled={!canSubmitApprove}
                                        className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                                    >
                                        <CheckCircle size={18} /> Approve and Mark as Completed
                                    </button>
                                ) : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => handleApproveSubmit('nightly')}
                                            disabled={!canSubmitApprove}
                                            className="flex-1 px-6 py-3 bg-white hover:bg-slate-50 text-slate-800 font-semibold rounded-xl border border-slate-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                                        >
                                            <Calendar size={18} /> Approve for Nightly Run
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleApproveSubmit('now')}
                                            disabled={!canSubmitApprove}
                                            className="flex-1 px-6 py-3 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-sm"
                                        >
                                            <CheckCircle size={18} /> Approve & Create Transactions Now
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══ PRINT MODAL ═══ */}
            {showPrintModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden">
                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-3 bg-slate-100 text-slate-600 rounded-xl"><Printer size={24} /></div>
                                <div>
                                    <h3 className="text-base font-bold text-gray-900">Print Proceedings Report</h3>
                                    <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">Configure report printout</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                    <input type="checkbox" id="printSummaryOpt" checked={printOptions.abstract} onChange={e => setPrintOptions(prev => ({ ...prev, abstract: e.target.checked }))} className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer" />
                                    <label htmlFor="printSummaryOpt" className="cursor-pointer flex-1">
                                        <p className="text-xs font-bold text-gray-800">Summary Abstract</p>
                                        <p className="text-[9px] text-gray-500">Include overall summary table</p>
                                    </label>
                                </div>
                                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                    <input type="checkbox" id="printDetailsOpt" checked={printOptions.detailed} onChange={e => setPrintOptions(prev => ({ ...prev, detailed: e.target.checked }))} className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer" />
                                    <label htmlFor="printDetailsOpt" className="cursor-pointer flex-1">
                                        <p className="text-xs font-bold text-gray-800">Detailed View</p>
                                        <p className="text-[9px] text-gray-500">Include student lists for each proceeding</p>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
                            <button onClick={() => setShowPrintModal(false)} className="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-gray-600 hover:bg-white border border-gray-200">Cancel</button>
                            <button onClick={executePrint} disabled={!printOptions.abstract && !printOptions.detailed} className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 ${(!printOptions.abstract && !printOptions.detailed) ? 'bg-gray-400 cursor-not-allowed' : 'bg-gray-900 hover:bg-black shadow-lg shadow-gray-200'}`}>
                                <Printer size={16} /> Generate Print
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Proceedings;
