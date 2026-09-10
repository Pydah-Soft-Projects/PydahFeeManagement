import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../lib/api';
import Sidebar from './Sidebar';
import { Search, Filter, Trash2, Plus, User, Award, ShieldAlert, Check, Eye, Clock, CheckCircle, XCircle, Send, X, Pencil, Save, BookOpen, Printer, ChevronDown, ChevronUp, LayoutGrid } from 'lucide-react';
import { printHtmlDocument } from '../utils/printService';

// ─── Status badge helper ───────────────────────────────────────────────────
const requestRecency = (req) => {
    const created = new Date(req?.createdAt || 0).getTime();
    const updated = new Date(req?.updatedAt || 0).getTime();
    return Number.isFinite(updated) && updated > created ? updated : created;
};

const compareRequestsNewestFirst = (a, b) => requestRecency(b) - requestRecency(a);

const concessionEntryKey = (entry) => {
    const fhId = String(entry?.feeHeadId ?? '').trim();
    const year = Number(entry?.studentYear);
    const sem = entry?.semester === undefined || entry?.semester === null || entry?.semester === ''
        ? 'null'
        : Number(entry.semester);
    return `${fhId}_${year}_${sem}`;
};

/** One row per student: latest request metadata, latest value wins for the same fee head/year. */
const mergeRequestsByStudent = (list) => {
    const groups = new Map();
    (list || []).forEach((req) => {
        const key = String(req.admissionNumber || '').trim().toLowerCase() || `__id_${req._id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(req);
    });

    const merged = [];
    groups.forEach((items) => {
        const sorted = [...items].sort(compareRequestsNewestFirst);
        const nonRejected = sorted.filter((r) => r.status !== 'REJECTED');
        const pool = nonRejected.length > 0 ? nonRejected : sorted;
        const pending = pool.filter((r) => r.status === 'PENDING');
        const primary = pending[0] || pool[0];

        if (sorted.length === 1) {
            merged.push({
                ...primary,
                mergedRequestCount: 1,
                editableConcessions: primary.concessions || []
            });
            return;
        }

        const concessionMap = new Map();
        [...pool].reverse().forEach((req) => {
            (req.concessions || []).forEach((entry) => {
                concessionMap.set(concessionEntryKey(entry), { ...entry });
            });
        });

        merged.push({
            ...primary,
            concessions: [...concessionMap.values()],
            editableConcessions: primary.concessions || [],
            mergedRequestCount: sorted.length,
            mergedSources: sorted.map((r) => ({
                _id: r._id,
                status: r.status,
                createdAt: r.createdAt,
                requestedByName: r.requestedByName || r.requestedBy
            }))
        });
    });

    return merged.sort(compareRequestsNewestFirst);
};

const StatusBadge = ({ status }) => {
    const map = {
        PENDING:  { cls: 'bg-amber-50 text-amber-700 border-amber-200',   icon: <Clock size={11} />,        label: 'Pending'  },
        APPROVED: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle size={11} />, label: 'Approved' },
        REJECTED: { cls: 'bg-rose-50 text-rose-700 border-rose-200',      icon: <XCircle size={11} />,      label: 'Rejected' }
    };
    const { cls, icon, label } = map[status] || map.PENDING;
    return (
        <span className={`inline-flex items-center gap-1 border px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cls}`}>
            {icon}{label}
        </span>
    );
};

const OverallConcession = () => {
    const user        = JSON.parse(localStorage.getItem('user')) || {};
    const permissions = user.permissions || [];
    const role        = user.role;
    const isAdminRole = role === 'superadmin' || role === 'admin';
    // Page path alone must NOT unlock all tabs. Only grant full legacy access when
    // the role has `/overall-concessions` and no tab-level sub-permissions yet.
    const OVERALL_CONC_SUBS = [
        'overall_concession_add',
        'overall_concession_view',
        'overall_concession_bulk',
        'overall_concession_requests_read',
        'overall_concession_requests_write',
        'overall_concession_requests', // legacy full requests access
    ];
    const hasPagePath = permissions.includes('/overall-concessions');
    const hasAnySub = OVERALL_CONC_SUBS.some(p => permissions.includes(p));
    const hasLegacyFull = hasPagePath && !hasAnySub;
    const canAdd = isAdminRole || hasLegacyFull || permissions.includes('overall_concession_add');
    const canView = isAdminRole || hasLegacyFull || hasPagePath || permissions.includes('overall_concession_view');
    const canBulk = isAdminRole || hasLegacyFull || permissions.includes('overall_concession_bulk');
    // Requests: write = all ops; read = view only (no approve/reject/edit)
    const canRequestsWrite = isAdminRole || hasLegacyFull
        || permissions.includes('overall_concession_requests_write')
        || permissions.includes('overall_concession_requests'); // legacy = write
    const canRequestsRead = canRequestsWrite
        || permissions.includes('overall_concession_requests_read');
    const canRequests = canRequestsRead;
    const hasPageAccess = isAdminRole || hasPagePath || canAdd || canView || canBulk || canRequests;

    const getFirstAllowedTab = () => {
        if (canAdd) return 'add';
        if (canView) return 'view';
        if (canBulk) return 'bulk';
        if (canRequests) return 'requests';
        return 'view';
    };

    // ── filter metadata ──────────────────────────────────────────────────
    const [metadata,    setMetadata]    = useState({});
    const [colleges,    setColleges]    = useState([]);
    const [courses,     setCourses]     = useState([]);
    const [branches,    setBranches]    = useState([]);
    const [batches,     setBatches]     = useState([]);
    const [feeHeads,    setFeeHeads]    = useState([]);
    const [courseYears, setCourseYears] = useState({});
    // ── filters & student list ───────────────────────────────────────────
    const [filters,     setFilters]     = useState({ college: '', course: '', branch: '', batch: '' });
    const [searchTerm,  setSearchTerm]  = useState('');
    const [students,    setStudents]    = useState([]);
    const [loading,     setLoading]     = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    // ── selected student & form state ────────────────────────────────────
    const [selectedStudent,  setSelectedStudent]  = useState(null);
    const [activeEditHeads,  setActiveEditHeads]  = useState([]);
    const [draftAmounts,     setDraftAmounts]     = useState({});
    const [concessionTypes,  setConcessionTypes]  = useState({});
    const [yearRemarks,      setYearRemarks]      = useState({});
    const [selectedNewHead,  setSelectedNewHead]  = useState('');
    const [isSaving,         setIsSaving]         = useState(false);

    // ── sorting states ────────────────────────────────────────────────────
    const [viewSortField, setViewSortField] = useState(''); // 'student_name' | 'admission_number' | 'pin_no'
    const [viewSortDir, setViewSortDir] = useState('asc'); // 'asc' | 'desc'
    const [bulkSortField, setBulkSortField] = useState(''); // 'student_name' | 'admission_number' | 'pin_no'
    const [bulkSortDir, setBulkSortDir] = useState('asc'); // 'asc' | 'desc'

    // ── bulk load options ─────────────────────────────────────────────────
    const [bulkApplyMode, setBulkApplyMode] = useState({}); // { [fhId]: 'single' | 'year' | 'all' }
    const [bulkRemarks, setBulkRemarks] = useState({}); // { [admissionNumber_yr]: string }
    const [bulkQuotaFilter, setBulkQuotaFilter] = useState(''); // stud_type filter for bulk load
    const [quotaOptions,   setQuotaOptions]   = useState([]); // distinct quota codes from student_quotas table

    const [successMessage,   setSuccessMessage]   = useState('');
    const [errorMessage,     setErrorMessage]     = useState('');
    const [isFormDirty,      setIsFormDirty]      = useState(false);
    const formDirtyRef = useRef(false);
    const bulkHeadDropRef = useRef(null);

    // ── tabs ─────────────────────────────────────────────────────────────
    const [activeTab, setActiveTab] = useState(getFirstAllowedTab);

    // ── requests tab state ───────────────────────────────────────────────
    const [requests,          setRequests]          = useState([]);
    const [requestsLoading,   setRequestsLoading]   = useState(false);
    const [reqStatusFilter,   setReqStatusFilter]   = useState('PENDING');
    const [reqFilters,        setReqFilters]        = useState({ college: '', course: '', branch: '', batch: '', quota: '' });
    const [reqCourses,        setReqCourses]        = useState([]);
    const [reqBranches,       setReqBranches]       = useState([]);
    const [reqSearchTerm,     setReqSearchTerm]     = useState('');
    const [selectedRequest,   setSelectedRequest]   = useState(null);
    const [approveBusy,       setApproveBusy]       = useState(false);
    const [rejectReason,      setRejectReason]      = useState('');
    const [rejectBusy,        setRejectBusy]        = useState(false);
    const [modalMode,         setModalMode]         = useState('view'); // 'view' | 'reject'
    const [modalTab,          setModalTab]          = useState('request'); // 'request' | 'structure'
    const [modalStructures,   setModalStructures]   = useState([]);
    const [modalStructuresLoading, setModalStructuresLoading] = useState(false);
    // editing the pending request entries inside the modal
    const [isEditingRequest,  setIsEditingRequest]  = useState(false);
    const [editRows,          setEditRows]          = useState([]); // [{ key, feeHeadId, concessionType, amounts: { year: value } }]
    const [editSaveBusy,      setEditSaveBusy]      = useState(false);
    const [editNewHeadId,     setEditNewHeadId]     = useState('');
    const [approveSuccess,    setApproveSuccess]    = useState(null); // { studentName, admissionNumber } | null
    // Reference editor (HRMS employees) inside request modal
    const [referenceDraft,       setReferenceDraft]       = useState('');
    const [refSearchTerm,        setRefSearchTerm]        = useState('');
    const [refSearchResults,     setRefSearchResults]     = useState([]);
    const [refSearchLoading,     setRefSearchLoading]     = useState(false);
    const [savedReferenceNames,  setSavedReferenceNames]  = useState([]);
    const [savedReferencesLoading, setSavedReferencesLoading] = useState(false);
    const [refDropdownOpen,      setRefDropdownOpen]      = useState(false);
    const [referenceSaveBusy,    setReferenceSaveBusy]    = useState(false);
    const [isEditingReference,   setIsEditingReference]   = useState(false);
    const refSearchTimerRef = useRef(null);
    const refDropdownRef = useRef(null);
    const savedRefsCacheRef = useRef({ at: 0, names: [] });

    // Pagination for Concession Requests Tab
    const [reqCurrentPage, setReqCurrentPage] = useState(1);
    const [reqPerPage, setReqPerPage] = useState(10);

    useEffect(() => {
        setReqCurrentPage(1);
    }, [reqSearchTerm, reqStatusFilter, reqFilters]);

    // ── register tab state ────────────────────────────────────────────────
    const [regRequests,        setRegRequests]        = useState([]);
    const [regLoading,         setRegLoading]         = useState(false);
    const [regStatusFilter] = useState('APPROVED');
    const [regFilters,         setRegFilters]         = useState({ college: '', course: '', branch: '', batch: '' });
    const [regCourses,         setRegCourses]         = useState([]);
    const [regBranches,        setRegBranches]        = useState([]);
    const [regSearchTerm,      setRegSearchTerm]      = useState('');
    const [regExpandedId,      setRegExpandedId]      = useState(null);
    const [regPrintSingleBusy, setRegPrintSingleBusy] = useState(null);
    const [regPrintAllBusy,    setRegPrintAllBusy]    = useState(false);

    // ── bulk load tab state ────────────────────────────────────────────────
    const [bulkSelectedHeads,  setBulkSelectedHeads]  = useState([]);
    const [bulkStudents,       setBulkStudents]       = useState([]);
    const [bulkAmounts,        setBulkAmounts]        = useState({});
    const [bulkConcTypes,      setBulkConcTypes]      = useState({});
    const [bulkSaving,         setBulkSaving]         = useState(false);
    const [bulkLoaded,         setBulkLoaded]         = useState(false);
    const [bulkSuccess,        setBulkSuccess]        = useState('');
    const [bulkError,          setBulkError]          = useState('');
    const [bulkHeadDropOpen,   setBulkHeadDropOpen]   = useState(false);

    // ── view overview list filter + print ─────────────────────────────────
    const [viewListMode,      setViewListMode]      = useState('all'); // 'all' | 'revised'
    const [viewQuotaFilter,   setViewQuotaFilter]    = useState('');
    const [viewPrintBusy,     setViewPrintBusy]     = useState(false);

    // ── pending requests map (admissionNumber → true) for badge ──────────
    const [pendingAdmSet, setPendingAdmSet] = useState(new Set());

    // ── helpers ──────────────────────────────────────────────────────────
    const markFormDirty = () => { formDirtyRef.current = true;  setIsFormDirty(true);  };
    const markFormClean = () => { formDirtyRef.current = false; setIsFormDirty(false); };

    const normalizeConcessionType = (type) =>
        String(type ?? 'REVISED').trim().toUpperCase() === 'CONCESSION' ? 'CONCESSION' : 'REVISED';
    const normalizeFeeHeadId = (id) => String(id ?? '').trim();
    const getRowConcessionType = (fhId) =>
        normalizeConcessionType(concessionTypes[normalizeFeeHeadId(fhId)] || 'REVISED');

    const resolveRevisedFeeHeadId = useCallback((rf) => {
        // Prefer feeHeadCode (business id) over Mongo ObjectId when both exist
        const code = (rf.feeHeadCode || '').trim().toUpperCase();
        if (code) {
            const byCode = feeHeads.find(h => (h.code || '').trim().toUpperCase() === code);
            if (byCode) return normalizeFeeHeadId(byCode._id);
        }
        const directId = normalizeFeeHeadId(rf.feeHeadId);
        if (directId) {
            const matched = feeHeads.find(h => normalizeFeeHeadId(h._id) === directId);
            return matched ? normalizeFeeHeadId(matched._id) : directId;
        }
        return '';
    }, [feeHeads]);

    const buildDraftKey = (feeHeadId, studentYear) =>
        `${normalizeFeeHeadId(feeHeadId)}_${Number(studentYear)}`;

    const getConcessionDisplayAmount = (rf) => {
        const raw = rf?.amount ?? rf?.revisedAmount;
        if (raw === undefined || raw === null || raw === '') return '';
        return String(raw);
    };

    const getFeeHeadName = (id, code = '') => {
        // Prefer code (business fee-head id) over ObjectId
        if (code) {
            const byCode = feeHeads.find(h => String(h.code || '').trim().toUpperCase() === String(code).trim().toUpperCase());
            if (byCode) return byCode.name;
        }
        let fh = feeHeads.find(h => normalizeFeeHeadId(h._id) === normalizeFeeHeadId(id));
        return fh ? fh.name : (code || 'Unknown Fee Component');
    };

    /** Prefer feeHeadCode (business id, e.g. OTH1) over feeHeadId (Mongo ObjectId). */
    const resolveFeeHeadDisplay = (entry) => {
        const storedCode = String(entry?.feeHeadCode || '').trim();
        const byCode = storedCode
            ? feeHeads.find(h => String(h.code || '').trim().toUpperCase() === storedCode.toUpperCase())
            : null;
        if (byCode) {
            return {
                feeHeadId: normalizeFeeHeadId(byCode._id),
                name: byCode.name || storedCode,
                code: byCode.code || storedCode
            };
        }
        const id = normalizeFeeHeadId(entry?.feeHeadId);
        const matched = id
            ? feeHeads.find(h => normalizeFeeHeadId(h._id) === id)
            : null;
        if (matched) {
            return {
                feeHeadId: id,
                name: matched.name || entry?.feeHeadName || matched.code || id,
                code: matched.code || ''
            };
        }
        return {
            feeHeadId: id || storedCode || '',
            name: entry?.feeHeadName || storedCode || id || 'Unknown Fee Component',
            code: storedCode
        };
    };

    const getYearSuffix = (yr) => {
        if (yr === 1) return '1st'; if (yr === 2) return '2nd';
        if (yr === 3) return '3rd'; return `${yr}th`;
    };

    const applyStudentConcessionsToForm = useCallback((student) => {
        if (!student) return;
        const revisedFees = student.revisedFees || [];
        const headIds = []; const initialDrafts = {}; const initialTypes = {}; const initialRemarks = {};
        revisedFees.forEach(rf => {
            const fhId = resolveRevisedFeeHeadId(rf);
            if (!fhId) return;
            if (!headIds.includes(fhId)) headIds.push(fhId);
            initialTypes[fhId] = normalizeConcessionType(rf.concessionType);
            const amountStr = getConcessionDisplayAmount(rf);
            if (amountStr !== '') initialDrafts[buildDraftKey(fhId, rf.studentYear)] = amountStr;
            if (rf.remarks) initialRemarks[rf.studentYear] = rf.remarks;
        });
        setActiveEditHeads(headIds);
        setDraftAmounts(initialDrafts);
        setConcessionTypes(initialTypes);
        setYearRemarks(initialRemarks);
        markFormClean();
    }, [resolveRevisedFeeHeadId]);

    useEffect(() => {
        const allowed = { add: canAdd, view: canView, bulk: canBulk, requests: canRequests, register: canRequests };
        if (!allowed[activeTab]) setActiveTab(getFirstAllowedTab());
    }, [canAdd, canView, canBulk, canRequests, activeTab]);

    // ── initial data load ────────────────────────────────────────────────
    useEffect(() => {
        if (!hasPageAccess) return;
        const fetchInitialData = async () => {
            try {
                const calls = [api.get('/students/metadata'), api.get('/fee-heads?all=true')];
                const [metaRes, headsRes] = await Promise.all(calls);
                const meta = metaRes.data.hierarchy || metaRes.data;
                setMetadata(meta);
                setColleges(Object.keys(meta || {}));
                setBatches(metaRes.data.batches || []);
                setFeeHeads(headsRes.data || []);
                setCourseYears(metaRes.data.courseYears || {});
                setQuotaOptions(metaRes.data.categories || []);} catch (err) { console.error('Error fetching initial data', err); }
        };
        fetchInitialData();
    }, [hasPageAccess]);

    useEffect(() => {
        if (!selectedStudent || formDirtyRef.current) return;
        applyStudentConcessionsToForm(selectedStudent);
    }, [selectedStudent?.admission_number, selectedStudent?.revisedFees, feeHeads.length, applyStudentConcessionsToForm]);

    useEffect(() => {
        const handleOutsideClick = (e) => {
            if (bulkHeadDropRef.current && !bulkHeadDropRef.current.contains(e.target)) {
                setBulkHeadDropOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutsideClick);
        return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, []);

    const fetchRequests = useCallback(async () => {
        if (!canRequests) return;
        setRequestsLoading(true);
        try {
            const baseParams = {
                    status: reqStatusFilter || undefined,
                    college: reqFilters.college || undefined,
                    course: reqFilters.course || undefined,
                    branch: reqFilters.branch || undefined,
                    batch: reqFilters.batch || undefined,
                    category: reqFilters.quota || undefined
            };

            // 1. Fast load: first 50 requests
            const firstRes = await api.get('/overall-concessions/requests', {
                params: { ...baseParams, limit: 50 }
            });
            setRequests(firstRes.data);
            setRequestsLoading(false); // Turn off main spinner immediately

            // 2. Background load: fetch the rest
            const fullRes = await api.get('/overall-concessions/requests', {
                params: baseParams
            });
            setRequests(fullRes.data);
        } catch (err) {
            console.error('Error fetching requests', err);
            setRequestsLoading(false);
        }
    }, [canRequests, reqStatusFilter, reqFilters]);

    const filteredRequests = (() => {
        const q = reqSearchTerm.trim().toLowerCase();
        const clean = q.replace(/[^a-z0-9]/g, '');
        const searched = !q ? requests : requests.filter(r => {
            const name = String(r.studentName || '').toLowerCase();
            const adm = String(r.admissionNumber || '').toLowerCase();
            const pin = String(r.pinNo || '').toLowerCase();
            const cleanAdm = adm.replace(/[^a-z0-9]/g, '');
            const cleanPin = pin.replace(/[^a-z0-9]/g, '');
            return name.includes(q)
                || adm.includes(q)
                || pin.includes(q)
                || (clean && cleanAdm.includes(clean))
                || (clean && cleanPin.includes(clean));
        });
        return mergeRequestsByStudent(searched);
    })();

    const totalRequestsCount = filteredRequests.length;
    const totalPagesCount = Math.ceil(totalRequestsCount / reqPerPage) || 1;
    const paginatedRequests = filteredRequests.slice((reqCurrentPage - 1) * reqPerPage, reqCurrentPage * reqPerPage);

    useEffect(() => {
        if (activeTab === 'requests') fetchRequests();
    }, [activeTab, fetchRequests]);

    // ── register tab: fetch ───────────────────────────────────────────────
    const fetchRegisterRequests = useCallback(async () => {
        setRegLoading(true);
        try {
            const res = await api.get('/overall-concessions/requests', {
                params: {
                    status:  regStatusFilter || undefined,
                    college: regFilters.college || undefined,
                    course:  regFilters.course  || undefined,
                    branch:  regFilters.branch  || undefined,
                    batch:   regFilters.batch   || undefined,
                    search:  regSearchTerm.trim() || undefined
                }
            });
            setRegRequests(res.data);
        } catch (err) { console.error('Error fetching register', err); }
        finally { setRegLoading(false); }
    }, [regStatusFilter, regFilters, regSearchTerm]);

    useEffect(() => {
        if (activeTab === 'register') fetchRegisterRequests();
    }, [activeTab, fetchRegisterRequests]);

    const handleRegCollegeChange = (e) => {
        const college = e.target.value;
        setRegFilters({ college, course: '', branch: '', batch: regFilters.batch });
        setRegCourses(college ? Object.keys(metadata[college] || {}) : []);
        setRegBranches([]);
    };
    const handleRegCourseChange = (e) => {
        const course = e.target.value;
        setRegFilters(f => ({ ...f, course, branch: '' }));
        if (course && regFilters.college) setRegBranches(metadata[regFilters.college][course]?.branches || []);
        else setRegBranches([]);
    };

    const handleRegPrintSingle = async (req, e) => {
        e.stopPropagation();
        setRegPrintSingleBusy(req._id);
        try {
            const res = await api.post('/print', {
                template: 'overall-concession-register',
                data: { request: req, generatedOn: new Date().toLocaleString('en-IN') }
            });
            printHtmlDocument(res.data);
        } catch (err) { alert('Print failed: ' + (err.response?.data?.message || err.message)); }
        finally { setRegPrintSingleBusy(null); }
    };

    const handleRegPrintAll = async () => {
        if (regRequests.length === 0) { alert('No records to print.'); return; }
        setRegPrintAllBusy(true);
        try {
            const res = await api.post('/print', {
                template: 'overall-concession-list',
                data: { requests: regRequests, filters: regFilters, generatedOn: new Date().toLocaleString('en-IN') }
            });
            printHtmlDocument(res.data);
        } catch (err) { alert('Print failed: ' + (err.response?.data?.message || err.message)); }
        finally { setRegPrintAllBusy(false); }
    };

    // ── View Overview print (All loaded students vs Revised-fees only) ──
    const getViewQuotaFilteredStudents = useCallback((list) => {
        if (!viewQuotaFilter) return list;
        const q = viewQuotaFilter.trim().toUpperCase();
        return list.filter((s) => String(s.stud_type || '').trim().toUpperCase() === q);
    }, [viewQuotaFilter]);

    const handleViewPrint = async (mode) => {
        const includeAll = mode === 'all';
        const quotaFiltered = getViewQuotaFilteredStudents(students);

        const selectedStudents = includeAll
            ? quotaFiltered
            : quotaFiltered.filter(s => (s.revisedFees || []).length > 0);

        if (selectedStudents.length === 0) {
            alert(includeAll ? 'No students loaded to print.' : 'No revised-fee students to print.');
            return;
        }

        // Convert the GET /overall-concessions student shape into the shape
        // expected by the print template (overall-concession-list).
        const requests = selectedStudents.map(s => ({
            _id: s.admission_number,
            studentName: s.student_name,
            admissionNumber: s.admission_number,
            pinNo: s.pin_no,
            college: s.college,
            course: s.course,
            branch: s.branch,
            batch: s.batch,
            concessions: (s.revisedFees || [])
                .map(rf => {
                    const fhId = resolveRevisedFeeHeadId(rf) || normalizeFeeHeadId(rf.feeHeadId);
                    const amt = Number(rf.amount ?? rf.revisedAmount ?? 0);
                    return {
                        feeHeadId: fhId,
                        feeHeadCode: rf.feeHeadCode || '',
                        feeHeadName: getFeeHeadName(fhId, rf.feeHeadCode),
                        studentYear: rf.studentYear,
                        semester: rf.semester ?? null,
                        amount: amt,
                        concessionType: normalizeConcessionType(rf.concessionType),
                        remarks: rf.remarks || ''
                    };
                })
                // Avoid printing empty/0 concessions. The report grid will show dashes anyway.
                .filter(c => Number.isFinite(c.amount) && c.amount >= 0)
        }));

        setViewPrintBusy(true);
        try {
            const res = await api.post('/print', {
                template: 'overall-concession-list',
                data: {
                    requests,
                    filters: {
                        ...filters,
                        quota: viewQuotaFilter || undefined,
                        courseYears: courseYears[filters.course] || undefined
                    },
                    generatedOn: new Date().toLocaleString('en-IN')
                }
            });
            printHtmlDocument(res.data);
        } catch (err) {
            alert('Print failed: ' + (err.response?.data?.message || err.message));
        } finally {
            setViewPrintBusy(false);
        }
    };

    const closeRequestModal = () => {
        setSelectedRequest(null);
        setModalMode('view');
        setModalTab('request');
        setRejectReason('');
        setModalStructures([]);
        setIsEditingRequest(false);
        setEditRows([]);
        setEditNewHeadId('');
        setReferenceDraft('');
        setRefSearchTerm('');
        setRefSearchResults([]);
        setRefDropdownOpen(false);
        setReferenceSaveBusy(false);
        setIsEditingReference(false);
        if (refSearchTimerRef.current) clearTimeout(refSearchTimerRef.current);
    };

    const fetchModalFeeStructures = async (req) => {
        if (!req) return;
        setModalStructuresLoading(true);
        try {
            const res = await api.get('/fee-structures', {
                params: {
                    college: req.college || undefined,
                    course: req.course || undefined,
                    branch: req.branch || undefined,
                    batch: req.batch || undefined,
                    category: req.studentQuota || undefined
                }
            });
            setModalStructures(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Error fetching fee structures for modal', err);
            setModalStructures([]);
        } finally {
            setModalStructuresLoading(false);
        }
    };

    const loadSavedReferenceNames = useCallback(async () => {
        const now = Date.now();
        if (now - savedRefsCacheRef.current.at < 60000 && savedRefsCacheRef.current.names.length > 0) {
            setSavedReferenceNames(savedRefsCacheRef.current.names);
            return;
        }
        setSavedReferencesLoading(true);
        try {
            const res = await api.get('/admissions/reference-names');
            const names = Array.isArray(res.data?.data?.names)
                ? res.data.data.names
                : (Array.isArray(res.data?.names) ? res.data.names : []);
            savedRefsCacheRef.current = { at: now, names };
            setSavedReferenceNames(names);
        } catch (err) {
            console.error('Saved reference names load failed', err);
            setSavedReferenceNames([]);
        } finally {
            setSavedReferencesLoading(false);
        }
    }, []);

    const loadReferenceEmployees = useCallback(async (term = '') => {
        const q = String(term || '').trim();
        if (q.length < 2) {
            setRefSearchResults([]);
            setRefSearchLoading(false);
            return;
        }
        setRefSearchLoading(true);
        try {
            const res = await api.get('/employees/search', { params: { name: q } });
            setRefSearchResults(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            console.error('Employee search failed', err);
            setRefSearchResults([]);
        } finally {
            setRefSearchLoading(false);
        }
    }, []);

    const handleReferenceSearchChange = (value) => {
        setRefSearchTerm(value);
        setRefDropdownOpen(true);
        if (refSearchTimerRef.current) clearTimeout(refSearchTimerRef.current);
        if (String(value || '').trim().length >= 2) {
            refSearchTimerRef.current = setTimeout(() => {
                void loadReferenceEmployees(value);
            }, 250);
        } else {
            setRefSearchResults([]);
            setRefSearchLoading(false);
        }
    };

    const selectReferenceEmployee = (emp) => {
        const name = String(emp?.employee_name || '').trim();
        if (!name) return;
        setReferenceDraft(name);
        setRefSearchTerm('');
        setRefDropdownOpen(false);
    };

    const selectSavedReference = (name) => {
        setReferenceDraft(String(name || '').trim());
        setRefSearchTerm('');
        setRefDropdownOpen(false);
    };

    const filteredSavedReferenceNames = useMemo(() => {
        const q = refSearchTerm.trim().toLowerCase();
        if (!q) return savedReferenceNames;
        return savedReferenceNames.filter((name) => name.toLowerCase().includes(q));
    }, [savedReferenceNames, refSearchTerm]);

    const saveRequestReference = async () => {
        if (!selectedRequest?._id) return;
        const next = String(referenceDraft || '').trim();
        const current = String(selectedRequest.referenceName || '').trim();
        if (next === current) return;
        setReferenceSaveBusy(true);
        setErrorMessage('');
        try {
            const res = await api.put(`/overall-concessions/requests/${selectedRequest._id}/reference`, {
                referenceName: next
            });
            const savedName = String(res.data?.referenceName ?? next).trim();
            setSelectedRequest((prev) => (prev ? { ...prev, referenceName: savedName } : prev));
            setRequests((prev) => prev.map((r) => (
                String(r.admissionNumber || '').trim() === String(selectedRequest.admissionNumber || '').trim()
                    ? { ...r, referenceName: savedName }
                    : r
            )));
            setReferenceDraft(savedName);
            setIsEditingReference(false);
            setRefDropdownOpen(false);
            setRefSearchTerm('');
        } catch (err) {
            console.error('Failed to update reference', err);
            setErrorMessage(err.response?.data?.message || 'Failed to update reference');
        } finally {
            setReferenceSaveBusy(false);
        }
    };

    useEffect(() => {
        const onDocClick = (e) => {
            if (!refDropdownRef.current) return;
            if (!refDropdownRef.current.contains(e.target)) {
                setRefDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, []);

    const openRequestModal = (req) => {
        setSelectedRequest(req);
        setModalMode('view');
        setModalTab('request');
        setRejectReason('');
        setErrorMessage('');
        setIsEditingRequest(false);
        setEditRows([]);
        setEditNewHeadId('');
        setReferenceDraft(String(req?.referenceName || '').trim());
        setRefSearchTerm('');
        setRefSearchResults([]);
        setRefDropdownOpen(false);
        setIsEditingReference(false);
        fetchModalFeeStructures(req);
    };

    const startEditingReference = () => {
        setReferenceDraft(String(selectedRequest?.referenceName || '').trim());
        setRefSearchTerm('');
        setRefSearchResults([]);
        setIsEditingReference(true);
        setRefDropdownOpen(true);
        void loadSavedReferenceNames();
    };

    const cancelEditingReference = () => {
        setReferenceDraft(String(selectedRequest?.referenceName || '').trim());
        setRefSearchTerm('');
        setRefSearchResults([]);
        setRefDropdownOpen(false);
        setIsEditingReference(false);
        if (refSearchTimerRef.current) clearTimeout(refSearchTimerRef.current);
    };

    // ── edit request entries inside the modal ─────────────────────────────
    const buildEditRowsFromRequest = (req) => {
        const grouped = new Map();
        (req.editableConcessions || req.concessions || []).forEach(c => {
            const fhId = normalizeFeeHeadId(c.feeHeadId);
            if (!grouped.has(fhId)) {
                grouped.set(fhId, {
                    key: `${fhId}_${grouped.size}`,
                    feeHeadId: fhId,
                    concessionType: normalizeConcessionType(c.concessionType || 'REVISED'),
                    years: {}
                });
            }
            const row = grouped.get(fhId);
            row.years[Number(c.studentYear)] = String(c.amount ?? '');
            row.concessionType = normalizeConcessionType(c.concessionType || row.concessionType);
        });
        return [...grouped.values()];
    };

    const startEditingRequest = () => {
        if (!selectedRequest) return;
        setEditRows(buildEditRowsFromRequest(selectedRequest));
        setEditNewHeadId('');
        setIsEditingRequest(true);
        setModalMode('view');
        setModalTab('request');
        setRejectReason('');
        setErrorMessage('');
    };

    const cancelEditingRequest = () => {
        setIsEditingRequest(false);
        setEditRows([]);
        setEditNewHeadId('');
    };

    const updateEditRow = (key, patch) => {
        setEditRows(rows => rows.map(r => (r.key === key ? { ...r, ...patch } : r)));
    };

    const updateEditAmount = (key, year, value) => {
        setEditRows(rows => rows.map(r => (
            r.key === key ? { ...r, years: { ...r.years, [year]: value } } : r
        )));
    };

    const removeEditRow = (key) => setEditRows(rows => rows.filter(r => r.key !== key));

    const addEditRow = () => {
        if (!editNewHeadId) return;
        if (editRows.some(r => r.feeHeadId === normalizeFeeHeadId(editNewHeadId))) return;
        setEditRows(rows => [...rows, {
            key: `${editNewHeadId}_${Date.now()}`,
            feeHeadId: normalizeFeeHeadId(editNewHeadId),
            concessionType: 'REVISED',
            years: {}
        }]);
        setEditNewHeadId('');
    };

    const saveEditedRequest = async () => {
        if (!selectedRequest) return;
        const payload = [];
        editRows.forEach(row => {
            const fh = feeHeads.find(h => normalizeFeeHeadId(h._id) === row.feeHeadId);
            Object.entries(row.years).forEach(([yr, val]) => {
                if (val === undefined || val === null || String(val).trim() === '') return;
                payload.push({
                    feeHeadId: row.feeHeadId,
                    feeHeadCode: fh?.code || '',
                    studentYear: Number(yr),
                    semester: null,
                    amount: Number(val),
                    concessionType: normalizeConcessionType(row.concessionType)
                });
            });
        });

        if (payload.length === 0) {
            setErrorMessage('Enter at least one amount before saving.');
            setTimeout(() => setErrorMessage(''), 5000);
            return;
        }

        setEditSaveBusy(true);
        try {
            const res = await api.put(`/overall-concessions/requests/${selectedRequest._id}`, { concessions: payload });
            const updated = res.data.request;
            setSelectedRequest(prev => ({ ...prev, ...updated, studentQuota: updated.studentQuota || prev.studentQuota }));
            setRequests(list => list.map(r => (r._id === updated._id
                ? { ...r, ...updated, studentQuota: updated.studentQuota || r.studentQuota }
                : r)));
            setIsEditingRequest(false);
            setEditRows([]);
            setSuccessMessage('Request updated successfully.');
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch (err) {
            const data = err.response?.data;
            const warningText = Array.isArray(data?.warnings) && data.warnings.length ? data.warnings.join(' ') : '';
            setErrorMessage(warningText || data?.message || 'Failed to update request.');
            setTimeout(() => setErrorMessage(''), 8000);
        } finally { setEditSaveBusy(false); }
    };

    const handleReqCollegeChange = (e) => {
        const college = e.target.value;
        setReqFilters({ ...reqFilters, college, course: '', branch: '' });
        setReqCourses(college ? Object.keys(metadata[college] || {}) : []);
        setReqBranches([]);
    };

    const handleReqCourseChange = (e) => {
        const course = e.target.value;
        setReqFilters({ ...reqFilters, course, branch: '' });
        if (course && reqFilters.college) {
            setReqBranches(metadata[reqFilters.college][course]?.branches || []);
        } else {
            setReqBranches([]);
        }
    };

    // also load pending set on mount for badge in Add/Manage tab
    useEffect(() => {
        if (!canRequests) return;
        api.get('/overall-concessions/requests', { params: { status: 'PENDING' } })
            .then(res => setPendingAdmSet(new Set(res.data.map(r => r.admissionNumber))))
            .catch(() => {});
    }, [canRequests]);

    // ── access denied screen ─────────────────────────────────────────────
    if (!hasPageAccess) {
        return (
            <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
                <Sidebar />
                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="bg-white p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center">
                        <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
                            <ShieldAlert size={40} className="text-red-500" />
                        </div>
                        <h2 className="text-2xl font-black text-slate-800 mb-2">Access Denied</h2>
                        <p className="text-slate-500 font-medium leading-relaxed">
                            You don't have the required permissions to view or manage Overall Concessions.
                        </p>
                        <button onClick={() => window.history.back()}
                            className="mt-8 w-full py-3 px-6 bg-slate-800 text-white font-bold rounded-2xl hover:bg-slate-900 transition-all shadow-lg cursor-pointer">
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── filter cascade ───────────────────────────────────────────────────
    const handleCollegeChange = (e) => {
        const college = e.target.value;
        setFilters({ ...filters, college, course: '', branch: '' });
        setCourses(college ? Object.keys(metadata[college] || {}) : []);
        setBranches([]);
    };
    const handleCourseChange = (e) => {
        const course = e.target.value;
        setFilters({ ...filters, course, branch: '' });
        if (course && filters.college) setBranches(metadata[filters.college][course]?.branches || []);
        else setBranches([]);
    };

    // ── fetch students ───────────────────────────────────────────────────
    const fetchStudents = async () => {
        const hasFilters = filters.college && filters.course && filters.batch;
        if (!hasFilters && !searchTerm.trim()) {
            alert('Please select all filters or enter a search query.');
            return;
        }
        setLoading(true); setHasSearched(true); setSelectedStudent(null);
        try {
            const res = await api.get('/overall-concessions', { params: { ...filters, search: searchTerm } });
            setStudents(res.data);
        } catch { alert('Failed to load students.'); }
        finally { setLoading(false); }
    };

    // ── bulk load helpers ────────────────────────────────────────────────
    const handleBulkLoad = async () => {
        if (!filters.college || !filters.course || !filters.branch || !filters.batch) {
            setBulkError('Please select all filters (College, Course, Branch, Batch).');
            return;
        }
        if (bulkSelectedHeads.length === 0) {
            setBulkError('Please select at least one fee head column.');
            return;
        }
        setBulkError(''); setBulkSuccess(''); setBulkLoaded(false);
        setLoading(true);
        try {
            const res = await api.get('/overall-concessions', { params: { ...filters } });
            // Apply quota filter client-side (stud_type match, case-insensitive)
            const allStudents = res.data || [];
            const loadedStudents = bulkQuotaFilter
                ? allStudents.filter(s => String(s.stud_type || '').trim().toUpperCase() === bulkQuotaFilter.trim().toUpperCase())
                : allStudents;
            setBulkStudents(loadedStudents);

            const amounts = {};
            const types = {};
            const remarks = {};
            const selectedIds = new Set(bulkSelectedHeads);
            loadedStudents.forEach(s => {
                (s.revisedFees || []).forEach(rf => {
                    if (selectedIds.has(rf.feeHeadId)) {
                        const key = `${s.admission_number}_${rf.studentYear}_${rf.feeHeadId}`;
                        amounts[key] = String(rf.amount ?? rf.revisedAmount ?? '');
                        types[`${s.admission_number}_${rf.feeHeadId}`] = rf.concessionType || 'REVISED';
                        if (rf.remarks) {
                            remarks[`${s.admission_number}_${rf.studentYear}`] = rf.remarks;
                        }
                    }
                });
            });
            setBulkAmounts(amounts);
            setBulkConcTypes(types);
            setBulkRemarks(remarks);
            setBulkLoaded(true);
        } catch { setBulkError('Failed to load students.'); }
        finally { setLoading(false); }
    };

    const handleBulkAmountChange = (admNo, yr, fhId, value) => {
        setBulkAmounts(prev => {
            const next = { ...prev };
            const mode = bulkApplyMode[fhId] || 'single';
            const numYears = courseYears[filters.course] || 4;

            if (mode === 'year') {
                bulkStudents.forEach(s => {
                    next[`${s.admission_number}_${yr}_${fhId}`] = value;
                });
            } else if (mode === 'all') {
                bulkStudents.forEach(s => {
                    for (let y = 1; y <= numYears; y++) {
                        next[`${s.admission_number}_${y}_${fhId}`] = value;
                    }
                });
            } else if (mode === 'student') {
                for (let y = 1; y <= numYears; y++) {
                    next[`${admNo}_${y}_${fhId}`] = value;
                }
            } else {
                next[`${admNo}_${yr}_${fhId}`] = value;
            }
            return next;
        });
    };

    const handleBulkSaveAll = async () => {
        setBulkSaving(true); setBulkError(''); setBulkSuccess('');
        try {
            const numYears = courseYears[filters.course] || 4;
            const studentsPayload = bulkStudents.map(s => {
                const concessions = [];
                for (let yr = 1; yr <= numYears; yr++) {
                    bulkSelectedHeads.forEach(fhId => {
                        const key = `${s.admission_number}_${yr}_${fhId}`;
                        const val = bulkAmounts[key];
                        const concType = bulkConcTypes[`${s.admission_number}_${fhId}`] || 'REVISED';

                        // Null/blank → skip (preserve existing, don't modify)
                        if (val === undefined || val === null || String(val).trim() === '') return;

                        const num = Number(val);
                        if (!Number.isFinite(num)) return;

                        // Zero + REVISED → include with amount=0 so backend resolves full demand as concession
                        // Zero + CONCESSION → skip (0 concession means no change)
                        if (num === 0 && concType !== 'REVISED') return;

                        const fh = feeHeads.find(h => h._id === fhId);
                        concessions.push({
                            feeHeadId: fhId,
                            feeHeadCode: fh?.code || '',
                            studentYear: yr,
                            semester: null,
                            amount: num,
                            concessionType: concType,
                            remarks: bulkRemarks[`${s.admission_number}_${yr}`] || ''
                        });
                    });
                }
                return {
                    admissionNumber: s.admission_number,
                    pinNo: s.pin_no,
                    studentName: s.student_name,
                    college: s.college,
                    course: s.course,
                    branch: s.branch,
                    batch: s.batch,
                    category: s.stud_type || 'Regular',
                    concessions
                };
            }).filter(s => s.concessions.length > 0);

            if (studentsPayload.length === 0) {
                setBulkError('No amounts entered for any student.');
                setBulkSaving(false);
                return;
            }

            const res = await api.post('/overall-concessions/bulk-multi', { students: studentsPayload });
            const d = res.data;
            setBulkSuccess(`Saved ${d.saved} of ${d.total} students successfully.${d.errors?.length ? ` ${d.errors.length} errors.` : ''}`);
            if (d.errors?.length) setBulkError(d.errors.map(e => `${e.admissionNumber}: ${e.message}`).join('; '));
        } catch (err) {
            setBulkError(err.response?.data?.message || 'Failed to save.');
        } finally { setBulkSaving(false); }
    };

    // ── select a student ─────────────────────────────────────────────────
    const handleSelectStudent = (student) => {
        markFormClean();
        setSelectedStudent(student);
        setSuccessMessage(''); setErrorMessage(''); setSelectedNewHead('');
        applyStudentConcessionsToForm(student);
    };

    // ── form interactions ────────────────────────────────────────────────
    const handleAddEditHead = () => {
        if (!selectedNewHead) return;
        const fhId = normalizeFeeHeadId(selectedNewHead);
        if (!activeEditHeads.includes(fhId)) {
            setActiveEditHeads([...activeEditHeads, fhId]);
            setConcessionTypes(prev => ({ ...prev, [fhId]: 'REVISED' }));
        }
        markFormDirty(); setSelectedNewHead('');
    };

    const handleConcessionTypeChange = (fhId, type) => {
        markFormDirty();
        setConcessionTypes(prev => ({ ...prev, [normalizeFeeHeadId(fhId)]: normalizeConcessionType(type) }));
    };

    const handleAmountChange = (feeHeadId, year, val) => {
        markFormDirty();
        setDraftAmounts({ ...draftAmounts, [buildDraftKey(feeHeadId, year)]: val });
    };

    const duration   = (selectedStudent?.course && courseYears[selectedStudent.course]) || 4;
    const isLateralStudent = ['LATER', 'LSPOT'].includes(String(selectedStudent?.stud_type || '').trim().toUpperCase());
    const yearsArray = Array.from({ length: duration }, (_, i) => i + 1).filter(yr => !(isLateralStudent && yr === 1));

    const buildConcessionsPayload = (heads, drafts, types) => {
        const payload = [];
        heads.forEach(fhId => {
            const fh    = feeHeads.find(h => normalizeFeeHeadId(h._id) === normalizeFeeHeadId(fhId));
            const fhCode = fh ? fh.code : '';
            const cType  = normalizeConcessionType(types[normalizeFeeHeadId(fhId)] || 'REVISED');
            yearsArray.forEach(yr => {
                const val = drafts[buildDraftKey(fhId, yr)];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    payload.push({
                        feeHeadId: fhId,
                        feeHeadCode: fhCode,
                        studentYear: yr,
                        semester: null,
                        amount: Number(val),
                        concessionType: cType,
                        remarks: yearRemarks[yr] || ''
                    });
                }
            });
        });
        return payload;
    };

    // ── submit for approval (replaces direct bulk save) ──────────────────
    const handleSubmitForApproval = async () => {
        if (!selectedStudent) return;
        const payload = buildConcessionsPayload(activeEditHeads, draftAmounts, concessionTypes);
        if (payload.length === 0) {
            setErrorMessage('Add at least one fee component with an amount before submitting.');
            return;
        }
        setIsSaving(true); setSuccessMessage(''); setErrorMessage('');
        try {
            await api.post('/overall-concessions/request', {
                admissionNumber: selectedStudent.admission_number,
                pinNo:           selectedStudent.pin_no,
                studentName:     selectedStudent.student_name,
                college:         selectedStudent.college,
                course:          selectedStudent.course,
                branch:          selectedStudent.branch,
                batch:           selectedStudent.batch,
                category:        selectedStudent.stud_type,
                concessions:     payload
            });
            setSuccessMessage('Request submitted for approval successfully!');
            markFormClean();
            // update pending badge set
            setPendingAdmSet(prev => new Set([...prev, selectedStudent.admission_number]));
            setTimeout(() => setSuccessMessage(''), 4000);
        } catch (err) {
            setErrorMessage(err.response?.data?.message || 'Failed to submit request.');
        } finally {
            setIsSaving(false);
        }
    };

    // ── remove a fee head (still calls bulk directly to restore standard) ─
    const handleRemoveEditHead = async (fhId) => {
        if (!selectedStudent) return;
        if (!window.confirm('Remove this fee component and restore its standard fee amounts?')) return;
        const normalizedId = normalizeFeeHeadId(fhId);
        const nextHeads    = activeEditHeads.filter(id => normalizeFeeHeadId(id) !== normalizedId);
        const updatedDrafts = { ...draftAmounts };
        Object.keys(updatedDrafts).forEach(k => { if (k.startsWith(`${normalizedId}_`)) delete updatedDrafts[k]; });
        const nextTypes = { ...concessionTypes }; delete nextTypes[normalizedId];
        setActiveEditHeads(nextHeads); setDraftAmounts(updatedDrafts); setConcessionTypes(nextTypes);
        setIsSaving(true); setSuccessMessage(''); setErrorMessage('');
        try {
            const res = await api.post('/overall-concessions/bulk', {
                admissionNumber: selectedStudent.admission_number,
                pinNo: selectedStudent.pin_no, studentName: selectedStudent.student_name,
                college: selectedStudent.college, course: selectedStudent.course,
                branch: selectedStudent.branch,  batch: selectedStudent.batch,
                category: selectedStudent.stud_type,
                concessions: buildConcessionsPayload(nextHeads, updatedDrafts, nextTypes)
            });
            const updated = { ...selectedStudent, revisedFees: res.data.revisedFees };
            setSelectedStudent(updated); markFormClean(); applyStudentConcessionsToForm(updated);
            setStudents(students.map(s => s.admission_number === selectedStudent.admission_number ? updated : s));
            setSuccessMessage('Fee component removed and standard fees restored.');
            setTimeout(() => setSuccessMessage(''), 3000);
        } catch (err) {
            setErrorMessage(err.response?.data?.message || 'Failed to remove fee component.');
            applyStudentConcessionsToForm(selectedStudent);
        } finally { setIsSaving(false); }
    };

    // ── approve a request ─────────────────────────────────────────────────
    const handleApprove = async (requestId) => {
        setApproveBusy(true);
        try {
            const snapshot = selectedRequest
                ? {
                    studentName: selectedRequest.studentName,
                    admissionNumber: selectedRequest.admissionNumber,
                    pinNo: selectedRequest.pinNo,
                    college: selectedRequest.college,
                    course: selectedRequest.course,
                    branch: selectedRequest.branch,
                    batch: selectedRequest.batch,
                    entryCount: Array.isArray(selectedRequest.concessions) ? selectedRequest.concessions.length : 0
                }
                : null;
            await api.put(`/overall-concessions/requests/${requestId}/approve`, {});
            closeRequestModal();
            await fetchRequests();
            api.get('/overall-concessions/requests', { params: { status: 'PENDING' } })
                .then(res => setPendingAdmSet(new Set(res.data.map(r => r.admissionNumber))))
                .catch(() => {});
            setApproveSuccess(snapshot || { studentName: 'Student', admissionNumber: '', entryCount: 0 });
        } catch (err) {
            const data = err.response?.data;
            const warningText = Array.isArray(data?.warnings) && data.warnings.length
                ? data.warnings.join(' ')
                : '';
            setErrorMessage(warningText || data?.message || 'Failed to approve request.');
            setTimeout(() => setErrorMessage(''), 8000);
        } finally { setApproveBusy(false); }
    };

    // ── reject a request ──────────────────────────────────────────────────
    const handleReject = async (requestId) => {
        if (!rejectReason.trim()) { alert('Please enter a rejection reason.'); return; }
        setRejectBusy(true);
        try {
            await api.put(`/overall-concessions/requests/${requestId}/reject`, { rejectionReason: rejectReason });
            closeRequestModal();
            await fetchRequests();
            api.get('/overall-concessions/requests', { params: { status: 'PENDING' } })
                .then(res => setPendingAdmSet(new Set(res.data.map(r => r.admissionNumber))))
                .catch(() => {});
            setSuccessMessage('Request rejected.');
            setTimeout(() => setSuccessMessage(''), 4000);
        } catch (err) {
            setErrorMessage(err.response?.data?.message || 'Failed to reject request.');
        } finally { setRejectBusy(false); }
    };

    // ════════════════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════════════════
    return (
        <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
            <Sidebar />
            <div className="flex-1 flex flex-col h-full overflow-hidden">
                <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">

                    {/* ── Header ── */}
                    <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                                <Award className="text-blue-600" size={26} /> Overall Concessions (Revised Fees)
                            </h1>
                            <p className="text-sm text-gray-500 mt-1">Set year-wise revised fee structures directly for specific students.</p>
                        </div>

                        {/* Tabs */}
                        <div className="flex bg-slate-200/80 p-1 rounded-xl border border-slate-300/40 shrink-0">
                            {canAdd && (
                            <button onClick={() => setActiveTab('add')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${activeTab === 'add' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                <Plus size={14} /> Add / Manage
                            </button>
                            )}
                            {canView && (
                            <button onClick={() => setActiveTab('view')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${activeTab === 'view' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                <Eye size={14} /> View Overview
                            </button>
                            )}
                            {canBulk && (
                            <button onClick={() => setActiveTab('bulk')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${activeTab === 'bulk' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                <LayoutGrid size={14} /> Bulk Load
                            </button>
                            )}
                            {canRequests && (
                                <button onClick={() => setActiveTab('requests')}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${activeTab === 'requests' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                    <Clock size={14} /> Requests
                                    {pendingAdmSet.size > 0 && (
                                        <span className="bg-amber-500 text-white text-[9px] font-black rounded-full px-1.5 py-0.5 leading-none">
                                            {pendingAdmSet.size}
                                        </span>
                                    )}
                                </button>
                            )}
                        </div>
                    </header>

                    {/* ── Filter Bar (shown on add + view tabs only) ── */}
                    {activeTab !== 'requests' && activeTab !== 'bulk' && (
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-6">
                            <div className="flex flex-wrap lg:flex-nowrap items-end gap-3 w-full">
                                <div className="min-w-[130px] flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">College</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.college} onChange={handleCollegeChange}>
                                            <option value="">Select College</option>
                                            {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                <div className="min-w-[120px] flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Course</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.course} onChange={handleCourseChange} disabled={!filters.college}>
                                            <option value="">Select Course</option>
                                            {courses.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                <div className="min-w-[100px] flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Batch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.batch} onChange={e => setFilters({ ...filters, batch: e.target.value })}>
                                            <option value="">Select Batch</option>
                                            {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                <div className="min-w-[120px] flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Branch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.branch} onChange={e => setFilters({ ...filters, branch: e.target.value })} disabled={!filters.course}>
                                        <option value="">All Branches</option>
                                            {branches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                {activeTab === 'view' && (
                                    <div className="min-w-[110px] flex-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Quota</label>
                                        <select
                                            className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={viewQuotaFilter}
                                            onChange={(e) => setViewQuotaFilter(e.target.value)}
                                        >
                                            <option value="">All Quotas</option>
                                            {(students.length > 0
                                                ? [...new Set(students.map(s => s.stud_type).filter(Boolean))].sort()
                                                : quotaOptions
                                            ).map(q => <option key={q} value={q}>{q}</option>)}
                                        </select>
                                </div>
                                )}
                                <div className="relative min-w-[180px] flex-1 lg:max-w-[220px]">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Search</label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <Search size={14} className="text-slate-400" />
                                        </div>
                                        <input type="text"
                                            className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-9 p-2.5"
                                            placeholder="Name / Adm / Pin"
                                            value={searchTerm}
                                            onChange={e => setSearchTerm(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && fetchStudents()} />
                                    </div>
                                    </div>
                                    <button onClick={fetchStudents} disabled={loading}
                                    className="text-white bg-blue-600 hover:bg-blue-700 font-bold rounded-lg text-xs px-5 py-2.5 transition flex items-center justify-center gap-2 whitespace-nowrap shadow-sm shrink-0">
                                        <Filter size={14} /> {loading ? 'Searching...' : 'Load Students'}
                                    </button>
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════
                        ADD / MANAGE TAB
                    ══════════════════════════════════════════════════ */}
                    {activeTab === 'add' && canAdd && (
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">

                            {/* Student Roster */}
                            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[500px]">
                                <div className="bg-slate-50 border-b border-slate-200 px-4 py-3">
                                    <h2 className="text-sm font-bold text-slate-800">Matching Students</h2>
                                </div>
                                <div className="overflow-y-auto flex-1 max-h-[600px] divide-y divide-slate-100">
                                    {loading ? (
                                        <div className="text-center py-20 text-slate-400 italic">Querying SQL database...</div>
                                    ) : students.length === 0 ? (
                                        <div className="text-center py-24 text-slate-400 p-6">
                                            {hasSearched ? 'No active regular students found matching criteria.' : 'Select filters and click Load Students.'}
                                        </div>
                                    ) : (
                                        students.map(s => {
                                            const isSelected = selectedStudent?.admission_number === s.admission_number;
                                            const hasPending  = pendingAdmSet.has(s.admission_number);
                                            return (
                                                <div key={s.admission_number} onClick={() => handleSelectStudent(s)}
                                                    className={`p-4 hover:bg-blue-50/50 cursor-pointer transition-all duration-150 flex items-start gap-3 ${isSelected ? 'bg-blue-50 border-l-4 border-blue-600 pl-3' : ''}`}>
                                                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold shrink-0">
                                                        {s.student_name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-slate-900 text-sm truncate">{s.student_name}</div>
                                                        <div className="text-xs text-slate-500 flex flex-wrap gap-x-2 mt-0.5">
                                                            <span>Pin: <b>{s.pin_no}</b></span>
                                                            <span>•</span>
                                                            <span>Adm: {s.admission_number}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                                            <span className="bg-blue-50 text-blue-700 border border-blue-100 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">{s.course}</span>
                                                            <span className="bg-slate-50 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5 text-[10px] font-semibold truncate max-w-[100px]">{s.branch}</span>
                                                            {s.revisedFees?.length > 0 && (
                                                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded px-1.5 py-0.5 text-[10px] font-extrabold">{s.revisedFees.length} Revised</span>
                                                            )}
                                                            {hasPending && (
                                                                <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5 text-[10px] font-extrabold flex items-center gap-0.5">
                                                                    <Clock size={9} /> Pending
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Right panel: concession editor */}
                            <div className="lg:col-span-3 space-y-6">
                                {selectedStudent ? (
                                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 space-y-6 animate-fadeIn">

                                        {/* Student card */}
                                        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50 border border-slate-200 rounded-xl p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center text-white shadow-sm">
                                                    <User size={20} />
                                                </div>
                                                <div>
                                                    <h2 className="text-lg font-bold text-slate-900">{selectedStudent.student_name}</h2>
                                                    <p className="text-xs text-slate-500">
                                                        PIN: <span className="font-semibold text-slate-700 mr-2">{selectedStudent.pin_no}</span>
                                                        Adm No: <span className="font-semibold text-slate-700">{selectedStudent.admission_number}</span>
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2 text-xs">
                                                <span className="bg-slate-200 text-slate-800 px-2 py-1 rounded font-bold uppercase">{selectedStudent.batch} Batch</span>
                                                <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold uppercase">{selectedStudent.course}</span>
                                                <span className="bg-purple-100 text-purple-800 px-2 py-1 rounded font-bold uppercase">
                                                    Quota: {selectedStudent.stud_type || '—'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Alerts */}
                                        {successMessage && (
                                            <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 flex items-center gap-2 text-sm font-semibold">
                                                <Check size={16} /> {successMessage}
                                            </div>
                                        )}
                                        {errorMessage && (
                                            <div className="p-3 bg-rose-50 text-rose-700 rounded-lg border border-rose-200 flex items-center gap-2 text-sm font-semibold">
                                                <ShieldAlert size={16} /> {errorMessage}
                                            </div>
                                        )}

                                        {/* Fee component editor */}
                                        <div className="border-t border-slate-100 pt-6 space-y-6">
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                                <h3 className="text-sm font-bold text-slate-800">Set Revised Fee (Concession)</h3>
                                                <div className="flex items-center gap-2 text-xs">
                                                    <select className="border border-slate-300 rounded-lg p-2 bg-slate-50 focus:ring-blue-500 focus:border-blue-500"
                                                        value={selectedNewHead} onChange={e => setSelectedNewHead(e.target.value)}>
                                                        <option value="">Select Fee Component to Add...</option>
                                                        {feeHeads.filter(fh => !activeEditHeads.includes(normalizeFeeHeadId(fh._id))).map(fh => (
                                                            <option key={fh._id} value={normalizeFeeHeadId(fh._id)}>{fh.name} ({fh.code || 'N/A'})</option>
                                                        ))}
                                                    </select>
                                                    <button type="button" onClick={handleAddEditHead} disabled={!selectedNewHead}
                                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-2 rounded-lg transition disabled:opacity-50 flex items-center gap-1 shadow-sm shrink-0">
                                                        <Plus size={14} /> Add Component
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                {activeEditHeads.length === 0 ? (
                                                    <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs italic bg-white">
                                                        No fee components added yet. Select a component above and click "Add Component".
                                                    </div>
                                                ) : (
                                                    <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-white">
                                                        <div className="overflow-x-auto w-full">
                                                            <table className="w-full text-xs text-left border-collapse table-fixed">
                                                                <colgroup>
                                                                    <col className="w-[168px]" /><col className="w-[118px]" />
                                                                    {yearsArray.map(yr => <col key={yr} />)}
                                                                    <col className="w-12" />
                                                                </colgroup>
                                                                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold text-[10px] uppercase">
                                                                    <tr>
                                                                        <th className="px-3 py-3 text-left">Fee Component</th>
                                                                        <th className="px-2 py-3 text-center">Type</th>
                                                                        {yearsArray.map(yr => <th key={yr} className="px-2 py-3 text-center">{getYearSuffix(yr)} Year (₹)</th>)}
                                                                        <th className="px-2 py-3 text-center">Action</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-100 text-slate-700">
                                                                    {activeEditHeads.map(fhId => {
                                                                        const matchingFee = selectedStudent?.revisedFees?.find(rf => resolveRevisedFeeHeadId(rf) === normalizeFeeHeadId(fhId));
                                                                        const headCode = matchingFee ? matchingFee.feeHeadCode : '';
                                                                        const headName = getFeeHeadName(fhId, headCode);
                                                                        const rowType  = getRowConcessionType(fhId);
                                                                        return (
                                                                            <tr key={fhId} className="hover:bg-slate-50/20">
                                                                                <td className="px-3 py-3 font-bold text-slate-900 whitespace-nowrap">{headName}</td>
                                                                                <td className="px-2 py-3">
                                                                                    <div className="flex justify-center">
                                                                                        <select value={rowType} onChange={e => handleConcessionTypeChange(fhId, e.target.value)}
                                                                                            className="w-[112px] border border-slate-300 rounded-lg p-1.5 bg-slate-50 text-xs font-semibold">
                                                                                            <option value="REVISED">Revised Fee</option>
                                                                                            <option value="CONCESSION">Concession</option>
                                                                                        </select>
                                                                                    </div>
                                                                                </td>
                                                                                {yearsArray.map(yr => (
                                                                                    <td key={yr} className="px-2 py-3 text-center">
                                                                                        <div className="relative w-full max-w-[120px] mx-auto">
                                                                                            <span className="absolute left-2.5 top-2 text-slate-400 font-medium">₹</span>
                                                                                            <input type="number" placeholder={rowType === 'CONCESSION' ? 'Deduction' : 'Revised fee'}
                                                                                                value={draftAmounts[buildDraftKey(fhId, yr)] || ''}
                                                                                                onChange={e => handleAmountChange(fhId, yr, e.target.value)}
                                                                                                onWheel={e => e.target.blur()}
                                                                                                className="w-full border border-slate-300 pl-6 pr-2 py-1.5 rounded-lg text-slate-800 focus:ring-1 focus:ring-blue-500 text-xs font-semibold" />
                                                                                        </div>
                                                                                    </td>
                                                                                ))}
                                                                                <td className="px-2 py-3 text-center">
                                                                                    <button type="button" onClick={() => handleRemoveEditHead(fhId)} disabled={isSaving}
                                                                                        className="text-rose-600 hover:bg-rose-50 p-2 rounded-lg transition disabled:opacity-40" title="Remove component">
                                                                                        <Trash2 size={14} />
                                                                                    </button>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Year-wise Remarks */}
                                            {activeEditHeads.length > 0 && (
                                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mt-4 mb-4 space-y-3">
                                                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Year-wise Remarks</h4>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                        {yearsArray.map(yr => (
                                                            <div key={yr}>
                                                                <label className="text-[10px] font-bold text-slate-500 block mb-1">
                                                                    {getYearSuffix(yr)} Year Remarks
                                                                </label>
                                                                <input
                                                                    type="text"
                                                                    placeholder="e.g. Sports concession"
                                                                    value={yearRemarks[yr] || ''}
                                                                    onChange={e => {
                                                                        markFormDirty();
                                                                        setYearRemarks({ ...yearRemarks, [yr]: e.target.value });
                                                                    }}
                                                                    className="w-full border border-slate-300 rounded-lg p-2 text-xs text-slate-800 bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Submit for Approval button */}
                                            {(activeEditHeads.length > 0 || isFormDirty) && (
                                                <div className="flex justify-end pt-4 border-t border-slate-100">
                                                    <button type="button" onClick={handleSubmitForApproval} disabled={isSaving}
                                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-lg transition-all shadow-md flex items-center justify-center gap-2 text-xs">
                                                        <Send size={14} />
                                                        {isSaving ? 'Submitting...' : 'Submit for Approval'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center text-slate-400 min-h-[500px] flex flex-col items-center justify-center space-y-4">
                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center border border-slate-100 shadow-inner">
                                            <User size={32} className="text-slate-300" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-slate-700">No Student Selected</h3>
                                            <p className="text-xs mt-1 max-w-sm mx-auto">Select a student from the left panel to define revised fee components.</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════
                        VIEW OVERVIEW TAB
                    ══════════════════════════════════════════════════ */}
                    {activeTab === 'view' && canView && (() => {
                        const quotaFilteredStudents = getViewQuotaFilteredStudents(students);
                        const revisedCount = quotaFilteredStudents.filter(s => (s.revisedFees || []).length > 0).length;
                        const viewStudents = viewListMode === 'revised'
                            ? quotaFilteredStudents.filter(s => (s.revisedFees || []).length > 0)
                            : quotaFilteredStudents;

                        const sortedViewStudents = [...viewStudents].sort((a, b) => {
                            if (!viewSortField) return 0;
                            let valA = a[viewSortField] || '';
                            let valB = b[viewSortField] || '';
                            if (typeof valA === 'string') {
                                return viewSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                            }
                            return viewSortDir === 'asc' ? (valA > valB ? 1 : -1) : (valB > valA ? 1 : -1);
                        });

                        // Calculate global popularity of fee heads across loaded students
                        const feeHeadPopularity = {};
                        const unionFeeHeads = [];
                        sortedViewStudents.forEach(s => {
                            (s.revisedFees || []).forEach(rf => {
                                const fhId = resolveRevisedFeeHeadId(rf) || normalizeFeeHeadId(rf.feeHeadId);
                                if (fhId) {
                                    feeHeadPopularity[fhId] = (feeHeadPopularity[fhId] || 0) + 1;
                                    if (!unionFeeHeads.includes(fhId)) {
                                        unionFeeHeads.push(fhId);
                                    }
                                }
                            });
                        });

                        unionFeeHeads.sort((a, b) => {
                            const countA = feeHeadPopularity[a] || 0;
                            const countB = feeHeadPopularity[b] || 0;
                            if (countA !== countB) {
                                return countB - countA;
                            }
                            const nameA = getFeeHeadName(a);
                            const nameB = getFeeHeadName(b);
                            return nameA.localeCompare(nameB);
                        });

                        return (
                        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden animate-fadeIn">
                            <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3 flex-wrap">
                                    <h2 className="text-sm font-bold text-slate-800">Concessions Overview Roster</h2>
                                    <span className="text-xs text-slate-500 font-semibold">
                                        {quotaFilteredStudents.length} Students
                                        {viewQuotaFilter ? ` (${viewQuotaFilter} quota)` : ''}
                                        {students.length !== quotaFilteredStudents.length ? ` of ${students.length} loaded` : ' Loaded'}
                                    </span>
                                </div>

                                <div className="flex items-center gap-3 flex-wrap">
                                    {quotaFilteredStudents.length > 0 && (
                                        <div className="flex bg-slate-200/80 p-1 rounded-xl border border-slate-300/40">
                                            <button
                                                type="button"
                                                onClick={() => setViewListMode('all')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                                    viewListMode === 'all'
                                                        ? 'bg-white text-blue-600 shadow-sm'
                                                        : 'text-slate-600 hover:text-slate-800'
                                                }`}
                                            >
                                                All <span className="ml-1 opacity-80">({quotaFilteredStudents.length})</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setViewListMode('revised')}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                                    viewListMode === 'revised'
                                                        ? 'bg-white text-emerald-600 shadow-sm'
                                                        : 'text-slate-600 hover:text-slate-800'
                                                }`}
                                            >
                                                Revised only <span className="ml-1 opacity-80">({revisedCount})</span>
                                            </button>
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => handleViewPrint(viewListMode)}
                                        disabled={loading || viewPrintBusy || viewStudents.length === 0}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                        title={viewStudents.length === 0 ? 'No students to print for this filter.' : `Print ${viewListMode === 'revised' ? 'revised-only' : 'all'} students`}
                                    >
                                        <Printer size={14} />
                                        {viewPrintBusy ? 'Printing...' : `Print (${viewStudents.length})`}
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-x-auto w-full">
                                <table className="w-full text-xs text-left border-collapse min-w-[800px]">
                                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 font-semibold text-[10px] uppercase">
                                        <tr>
                                            <th className="p-4 w-3/12 select-none">
                                                <div className="flex flex-col gap-1">
                                                    <span>Student Info</span>
                                                    <div className="flex items-center gap-2 text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">
                                                        <span>Sort:</span>
                                                        <button type="button"
                                                            onClick={() => {
                                                                const dir = (viewSortField === 'student_name' && viewSortDir === 'asc') ? 'desc' : 'asc';
                                                                setViewSortField('student_name');
                                                                setViewSortDir(dir);
                                                            }}
                                                            className={`hover:text-blue-600 transition flex items-center gap-0.5 cursor-pointer ${viewSortField === 'student_name' ? 'text-blue-600 font-black' : ''}`}>
                                                            Name {viewSortField === 'student_name' ? (viewSortDir === 'asc' ? '▲' : '▼') : ''}
                                                        </button>
                                                        <span>·</span>
                                                        <button type="button"
                                                            onClick={() => {
                                                                const dir = (viewSortField === 'admission_number' && viewSortDir === 'asc') ? 'desc' : 'asc';
                                                                setViewSortField('admission_number');
                                                                setViewSortDir(dir);
                                                            }}
                                                            className={`hover:text-blue-600 transition flex items-center gap-0.5 cursor-pointer ${viewSortField === 'admission_number' ? 'text-blue-600 font-black' : ''}`}>
                                                            Adm {viewSortField === 'admission_number' ? (viewSortDir === 'asc' ? '▲' : '▼') : ''}
                                                        </button>
                                                        <span>·</span>
                                                        <button type="button"
                                                            onClick={() => {
                                                                const dir = (viewSortField === 'pin_no' && viewSortDir === 'asc') ? 'desc' : 'asc';
                                                                setViewSortField('pin_no');
                                                                setViewSortDir(dir);
                                                            }}
                                                            className={`hover:text-blue-600 transition flex items-center gap-0.5 cursor-pointer ${viewSortField === 'pin_no' ? 'text-blue-600 font-black' : ''}`}>
                                                            PIN {viewSortField === 'pin_no' ? (viewSortDir === 'asc' ? '▲' : '▼') : ''}
                                                        </button>
                                                    </div>
                                                </div>
                                            </th>
                                            <th className="p-4 w-9/12">Revised Fees</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700">
                                        {loading ? (
                                            <tr><td colSpan="2" className="text-center py-20 text-slate-400 italic">Querying SQL database...</td></tr>
                                        ) : students.length === 0 ? (
                                            <tr><td colSpan="2" className="text-center py-24 text-slate-400 p-6">
                                                {hasSearched ? 'No active regular students found matching criteria.' : 'Select filters and click Load Students.'}
                                            </td></tr>
                                        ) : quotaFilteredStudents.length === 0 ? (
                                            <tr><td colSpan="2" className="text-center py-24 text-slate-400 p-6">
                                                No students found for the selected quota filter.
                                            </td></tr>
                                        ) : sortedViewStudents.length === 0 ? (
                                            <tr><td colSpan="2" className="text-center py-24 text-slate-400 p-6">
                                                No students with revised fees in the current list.
                                            </td></tr>
                                        ) : (
                                            sortedViewStudents.map(s => {
                                                const byHead = {};
                                                const yearsSet = new Set();
                                                (s.revisedFees || []).forEach(rf => {
                                                    const fhId = resolveRevisedFeeHeadId(rf) || normalizeFeeHeadId(rf.feeHeadId);
                                                    if (!fhId) return;
                                                    const yr = Number(rf.studentYear);
                                                    if (Number.isFinite(yr) && yr > 0) yearsSet.add(yr);
                                                    if (!byHead[fhId]) {
                                                        byHead[fhId] = {
                                                            name: getFeeHeadName(fhId, rf.feeHeadCode),
                                                            type: rf.concessionType || 'REVISED',
                                                            years: {}
                                                        };
                                                    }
                                                    byHead[fhId].years[yr] = {
                                                        amount: Number(rf.amount ?? rf.revisedAmount ?? 0),
                                                        type: rf.concessionType || 'REVISED',
                                                        id: rf.id,
                                                        remarks: rf.remarks || ''
                                                    };
                                                    byHead[fhId].type = rf.concessionType || byHead[fhId].type;
                                                });

                                                const years = [...yearsSet].sort((a, b) => a - b);
                                                const courseDur = courseYears[s.course] || (years.length ? Math.max(...years) : 0);
                                                const displayYears = courseDur > 0
                                                    ? Array.from({ length: courseDur }, (_, i) => i + 1)
                                                    : years;
                                                const hasConcessions = (s.revisedFees || []).length > 0;

                                                return (
                                                    <tr key={s.admission_number} className="hover:bg-slate-50/30 align-top">
                                                        <td className="p-4">
                                                            <div className="font-bold text-slate-900 text-sm">{s.student_name}</div>
                                                            <div className="text-slate-500 mt-0.5 font-medium">Pin: <span className="font-semibold text-slate-700">{s.pin_no}</span> | Adm: {s.admission_number}</div>
                                                        </td>
                                                        <td className="p-4">
                                                            {hasConcessions ? (
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full text-[11px] border-collapse border border-slate-200 rounded-lg overflow-hidden table-fixed min-w-[600px]">
                                                                        <thead>
                                                                            <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                                                                                <th className="px-3 py-2 text-left font-bold border border-slate-200 w-[120px] min-w-[120px]">Academic Year</th>
                                                                                {unionFeeHeads.map(fhId => (
                                                                                    <th key={fhId} className="px-3 py-2 text-center font-bold border border-slate-200 whitespace-nowrap w-[150px] min-w-[150px] truncate" title={getFeeHeadName(fhId)}>
                                                                                        {getFeeHeadName(fhId)}
                                                                                    </th>
                                                                                ))}
                                                                                <th className="px-3 py-2 text-left font-bold border border-slate-200 w-[200px] min-w-[200px]">Remarks</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {displayYears.map(yr => {
                                                                                // Get remarks for this year from concessions by looking at union fee heads
                                                                                const yrRemarks = unionFeeHeads
                                                                                    .map(fhId => byHead[fhId]?.years?.[yr]?.remarks)
                                                                                    .filter(Boolean);
                                                                                const displayRemark = yrRemarks.length > 0 ? yrRemarks[0] : '—';

                                                                                return (
                                                                                    <tr key={yr} className="bg-white">
                                                                                        <td className="px-3 py-2 font-semibold text-slate-800 border border-slate-200 whitespace-nowrap text-left w-[120px] min-w-[120px]">
                                                                                            {getYearSuffix(yr)} Year
                                                                                        </td>
                                                                                        {unionFeeHeads.map(fhId => {
                                                                                            const cell = byHead[fhId]?.years?.[yr];
                                                                                            return (
                                                                                                <td key={fhId} className="px-3 py-2 text-center font-bold border border-slate-200 whitespace-nowrap w-[150px] min-w-[150px]">
                                                                                                    {cell ? (
                                                                                                        <span className={cell.type === 'CONCESSION' ? 'text-amber-700' : 'text-emerald-700'} title={cell.remarks || undefined}>
                                                                                                            {cell.type === 'CONCESSION' ? '-' : ''}₹{Number(cell.amount).toLocaleString('en-IN')}
                                                                                                            <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-bold border ${cell.type === 'CONCESSION' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                                                                                                {cell.type === 'CONCESSION' ? 'Conc.' : 'Rev.'}
                                                                                                            </span>
                                                                                                        </span>
                                                                                                    ) : (
                                                                                                        <span className="text-slate-300 font-normal">—</span>
                                                                                                    )}
                                                                                                </td>
                                                                                            );
                                                                                        })}
                                                                                        <td className="px-3 py-2 text-left text-slate-600 border border-slate-200 max-w-[200px] truncate w-[200px] min-w-[200px]" title={displayRemark}>
                                                                                            {displayRemark}
                                                                                        </td>
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                </div>
                                                            ) : (
                                                                <span className="text-slate-400 font-bold text-sm">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        );
                    })()}

                    {/* ══════════════════════════════════════════════════
                        REQUESTS TAB (admin/superadmin only)
                    ══════════════════════════════════════════════════ */}
                    {activeTab === 'requests' && canRequests && (
                        <div className="space-y-4 animate-fadeIn">

                            {/* alerts inside requests tab */}
                            {successMessage && (
                                <div className="p-3 bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-200 flex items-center gap-2 text-sm font-semibold">
                                    <Check size={16} /> {successMessage}
                                </div>
                            )}
                            {errorMessage && (
                                <div className="p-3 bg-rose-50 text-rose-700 rounded-lg border border-rose-200 flex items-center gap-2 text-sm font-semibold">
                                    <ShieldAlert size={16} /> {errorMessage}
                                </div>
                            )}

                            {/* Filters */}
                            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
                                <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                                    <div className="flex-1 min-w-0">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Search Student</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={reqSearchTerm}
                                                onChange={e => setReqSearchTerm(e.target.value)}
                                                placeholder="Name, admission number, or pin..."
                                                className="w-full bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block pl-3 pr-10 py-2.5"
                                            />
                                            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 pointer-events-none">
                                                <Search size={14} />
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 shrink-0 pb-0.5">
                                        {['PENDING', 'APPROVED', 'REJECTED', ''].map(s => (
                                            <button key={s || 'ALL'} type="button" onClick={() => setReqStatusFilter(s)}
                                                className={`px-3 py-2 rounded-lg text-xs font-bold border transition ${reqStatusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:border-blue-400'}`}>
                                                {s || 'All'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">College</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={reqFilters.college} onChange={handleReqCollegeChange}>
                                            <option value="">All Colleges</option>
                                            {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Batch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={reqFilters.batch} onChange={e => setReqFilters({ ...reqFilters, batch: e.target.value })}>
                                            <option value="">All Batches</option>
                                            {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Course</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={reqFilters.course} onChange={handleReqCourseChange} disabled={!reqFilters.college}>
                                            <option value="">All Courses</option>
                                            {reqCourses.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Branch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={reqFilters.branch} onChange={e => setReqFilters({ ...reqFilters, branch: e.target.value })} disabled={!reqFilters.course}>
                                            <option value="">All Branches</option>
                                            {reqBranches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Quota</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={reqFilters.quota} onChange={e => setReqFilters({ ...reqFilters, quota: e.target.value })}>
                                            <option value="">All Quotas</option>
                                            {quotaOptions.map(q => <option key={q} value={q}>{q}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Requests list */}
                            {requestsLoading ? (
                                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400 italic">Loading requests...</div>
                            ) : filteredRequests.length === 0 ? (
                                <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-slate-400">
                                    No requests found for the selected filters.
                                </div>
                            ) : (
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase border-b border-slate-200">
                                                    <th className="px-4 py-3 text-left">College / Course</th>
                                                    <th className="px-4 py-3 text-left">Student</th>
                                                    <th className="px-4 py-3 text-left">Batch</th>
                                                    <th className="px-4 py-3 text-left">Quota</th>
                                                    <th className="px-4 py-3 text-left">Reference</th>
                                                    <th className="px-4 py-3 text-left">Requested By</th>
                                                    <th className="px-4 py-3 text-left">Approved By</th>
                                                    <th className="px-4 py-3 text-center">Entries</th>
                                                    <th className="px-4 py-3 text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100">
                                                {paginatedRequests.map(req => (
                                                    <tr key={req._id}
                                                        onClick={() => openRequestModal(req)}
                                                        className="hover:bg-blue-50/50 cursor-pointer transition">
                                                        <td className="px-4 py-3 text-slate-700">
                                                            <div>{req.college}</div>
                                                            <div className="text-[10px] text-slate-500">{req.course} — {req.branch}</div>
                                                        </td>
                                                        <td className="px-4 py-3">
                                                            <div className="font-bold text-slate-900">{req.studentName}</div>
                                                            <div className="text-[10px] text-slate-500">Adm: {req.admissionNumber}{req.pinNo ? ` · Pin: ${req.pinNo}` : ''}</div>
                                                        </td>
                                                        <td className="px-4 py-3 font-semibold text-slate-800">{req.batch}</td>
                                                        <td className="px-4 py-3">
                                                            <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold uppercase text-[10px]">
                                                                {req.studentQuota || '—'}
                                                            </span>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-700 font-medium">
                                                            {req.referenceName || <span className="text-slate-300">—</span>}
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-700">
                                                            <div className="font-semibold text-slate-800">{req.requestedByName || req.requestedBy}</div>
                                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                            {new Date(req.createdAt).toLocaleString('en-IN', {
                                                                day: '2-digit', month: 'short', year: 'numeric',
                                                                hour: '2-digit', minute: '2-digit', hour12: true
                                                            })}
                                                            </div>
                                                        </td>
                                                        <td className="px-4 py-3 text-slate-700">
                                                            {req.status === 'PENDING' ? (
                                                                <span className="text-slate-400 italic font-medium">—</span>
                                                             ) : (
                                                                 <>
                                                                     <div className="font-semibold text-slate-800">{req.approvedByName || req.approvedBy || 'System'}</div>
                                                                     <div className="text-[10px] text-slate-400 mt-0.5">
                                                                         {new Date(req.updatedAt || req.createdAt).toLocaleString('en-IN', {
                                                                             day: '2-digit', month: 'short', year: 'numeric',
                                                                             hour: '2-digit', minute: '2-digit', hour12: true
                                                                         })}
                                                                     </div>
                                                                 </>
                                                             )}
                                                        </td>
                                                        <td className="px-4 py-3 text-center font-bold text-slate-800">
                                                            {req.concessions?.length || 0}
                                                            {req.mergedRequestCount > 1 && (
                                                                <div className="text-[10px] font-medium text-slate-400">{req.mergedRequestCount} requests</div>
                                                            )}
                                                        </td>
                                                        <td className="px-4 py-3 text-center"><StatusBadge status={req.status} /></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pagination Controls */}
                                    <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-500 select-none">
                                        <div className="flex items-center gap-1.5">
                                            <span>Show</span>
                                            <select
                                                value={reqPerPage}
                                                onChange={e => {
                                                    setReqPerPage(Number(e.target.value));
                                                    setReqCurrentPage(1);
                                                }}
                                                className="border border-slate-300 rounded-lg p-1.5 bg-white font-bold text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            >
                                                <option value="5">5</option>
                                                <option value="10">10</option>
                                                <option value="25">25</option>
                                                <option value="50">50</option>
                                            </select>
                                            <span>entries per page</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            <span>
                                                Showing {totalRequestsCount === 0 ? 0 : (reqCurrentPage - 1) * reqPerPage + 1} to{' '}
                                                {Math.min(reqCurrentPage * reqPerPage, totalRequestsCount)} of {totalRequestsCount} entries
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                disabled={reqCurrentPage === 1}
                                                onClick={() => setReqCurrentPage(1)}
                                                className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
                                                title="First Page"
                                            >
                                                First
                                            </button>
                                            <button
                                                type="button"
                                                disabled={reqCurrentPage === 1}
                                                onClick={() => setReqCurrentPage(prev => Math.max(prev - 1, 1))}
                                                className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition flex items-center justify-center"
                                                title="Previous Page"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
                                            </button>

                                            <span className="px-3.5 py-1.5 bg-blue-50 text-blue-600 border border-blue-100 rounded-lg font-extrabold font-mono">
                                                Page {reqCurrentPage} of {totalPagesCount}
                                            </span>

                                            <button
                                                type="button"
                                                disabled={reqCurrentPage === totalPagesCount}
                                                onClick={() => setReqCurrentPage(prev => Math.min(prev + 1, totalPagesCount))}
                                                className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition flex items-center justify-center"
                                                title="Next Page"
                                            >
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                                            </button>
                                            <button
                                                type="button"
                                                disabled={reqCurrentPage === totalPagesCount}
                                                onClick={() => setReqCurrentPage(totalPagesCount)}
                                                className="p-2 border border-slate-300 rounded-lg bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition"
                                                title="Last Page"
                                            >
                                                Last
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Request detail modal */}
                            {selectedRequest && (() => {
                                const req = selectedRequest;
                                const reqYears = [...new Set(req.concessions.map(c => c.studentYear))].sort((a, b) => a - b);
                                const byHead = {};
                                req.concessions.forEach(c => {
                                    const resolved = resolveFeeHeadDisplay(c);
                                    const key = resolved.feeHeadId || normalizeFeeHeadId(c.feeHeadId);
                                    if (!byHead[key]) {
                                        byHead[key] = {
                                            name: resolved.name,
                                            code: resolved.code,
                                            concessionType: c.concessionType,
                                            years: {}
                                        };
                                    }
                                    byHead[key].years[c.studentYear] = c.amount;
                                    byHead[key].concessionType = c.concessionType;
                                    // Keep ObjectId-resolved catalog fields; do not let stale stored code overwrite
                                    byHead[key].name = resolved.name;
                                    byHead[key].code = resolved.code;
                                });

                                const structureYears = [...new Set(modalStructures.map(s => Number(s.studentYear)).filter(Boolean))]
                                    .sort((a, b) => a - b);
                                const structureByHead = {};
                                modalStructures.forEach(s => {
                                    const fhId = s.feeHead?._id?.toString?.() || s.feeHead?.toString?.() || String(s.feeHead || '');
                                    if (!fhId) return;
                                    if (!structureByHead[fhId]) {
                                        structureByHead[fhId] = {
                                            name: s.feeHead?.name || s.feeHead?.code || 'Fee Component',
                                            code: s.feeHead?.code || '',
                                            years: {}
                                        };
                                    }
                                    const yr = Number(s.studentYear);
                                    structureByHead[fhId].years[yr] = Number(s.amount) || 0;
                                });

                                const getYrSfx = yr => yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : `${yr}th`;

                                // Year columns available while editing: request years + structure years + any added
                                const editYears = [...new Set([
                                    ...reqYears,
                                    ...structureYears,
                                    ...editRows.flatMap(r => Object.keys(r.years).map(Number))
                                ])].filter(Boolean).sort((a, b) => a - b);
                                const usedEditHeadIds = new Set(editRows.map(r => r.feeHeadId));
                                const availableEditHeads = feeHeads.filter(h => !usedEditHeadIds.has(normalizeFeeHeadId(h._id)));
                                const structureAmountFor = (fhId, yr) =>
                                    structureByHead[normalizeFeeHeadId(fhId)]?.years?.[yr];

                                return (
                                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
                                        onClick={() => { if (!isEditingRequest) closeRequestModal(); }}>
                                        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
                                            onClick={e => e.stopPropagation()}>

                                            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
                                                <div>
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-base font-bold text-slate-900">{req.studentName}</h3>
                                                        <StatusBadge status={req.status} />
                                                    </div>
                                                    <p className="text-xs text-slate-500 mt-1">
                                                        Adm: <b>{req.admissionNumber}</b> &nbsp;|&nbsp;
                                                        Pin: <b>{req.pinNo}</b> &nbsp;|&nbsp;
                                                        {req.college} — {req.course} / {req.branch} &nbsp;|&nbsp;
                                                        Batch: <b>{req.batch}</b> &nbsp;|&nbsp;
                                                        {(() => {
                                                            const firstMerit = Array.isArray(req.meritStatusRecords) && req.meritStatusRecords.length > 0
                                                                ? (req.meritStatusRecords.find(m => Number(m.student_year) === 1) || req.meritStatusRecords[0])
                                                                : null;
                                                            const meritVal = (firstMerit ? firstMerit.merit_status : (req.meritStatus || req.merit_status || '')).toString().trim();
                                                            const isYes = meritVal.toLowerCase() === 'yes';
                                                            return (
                                                                <>
                                                                    Quota: <b className="uppercase">{req.studentQuota || '—'}</b> &nbsp;|&nbsp;
                                                                    Merit: <b className={`uppercase ${isYes ? 'text-emerald-700 font-bold' : ''}`}>{meritVal ? meritVal.toUpperCase() : '—'}</b>
                                                                </>
                                                            );
                                                        })()}
                                                    </p>
                                                    <div className="mt-2.5 max-w-md" ref={refDropdownRef}>
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                                                            Reference
                                                        </label>
                                                        {!isEditingReference ? (
                                                            <div className="flex items-center gap-2">
                                                                <div className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-800">
                                                                    {req.referenceName || <span className="text-slate-400">No reference set</span>}
                                                                </div>
                                                                {canRequestsWrite && (
                                                                <button
                                                                    type="button"
                                                                    onClick={startEditingReference}
                                                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition"
                                                                >
                                                                    <Pencil size={13} />
                                                                    Edit
                                                                </button>
                                                                )}
                                                            </div>
                                                        ) : canRequestsWrite ? (
                                                            <div className="flex items-center gap-2">
                                                                <div className="relative flex-1 min-w-0">
                                                                    <div className="flex items-center gap-1.5 border border-slate-200 rounded-lg bg-white px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-300">
                                                                        <Search size={14} className="text-slate-400 shrink-0" />
                                                                        <input
                                                                            type="text"
                                                                            value={refDropdownOpen ? refSearchTerm : (referenceDraft || '')}
                                                                            onChange={(e) => handleReferenceSearchChange(e.target.value)}
                                                                            onFocus={() => {
                                                                                setRefDropdownOpen(true);
                                                                                setRefSearchTerm('');
                                                                                void loadSavedReferenceNames();
                                                                            }}
                                                                            placeholder={referenceDraft || 'Search by name or employee ID…'}
                                                                            className="w-full text-xs text-slate-800 outline-none bg-transparent placeholder:text-slate-400"
                                                                            disabled={referenceSaveBusy}
                                                                            autoFocus
                                                                        />
                                                                        <ChevronDown size={14} className="text-slate-400 shrink-0" />
                                                                    </div>
                                                                    {refDropdownOpen && (
                                                                        <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                                                                            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
                                                                                Saved references
                                                                            </div>
                                                                            {savedReferencesLoading ? (
                                                                                <div className="p-3 text-center text-slate-500 text-xs">Loading saved names…</div>
                                                                            ) : (
                                                                                <>
                                                                                    <button
                                                                                        type="button"
                                                                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 text-xs text-slate-600"
                                                                                        onClick={() => selectSavedReference('')}
                                                                                    >
                                                                                        No reference
                                                                                    </button>
                                                                                    {filteredSavedReferenceNames.map((name) => (
                                                                                        <button
                                                                                            type="button"
                                                                                            key={name}
                                                                                            className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 last:border-b-0"
                                                                                            onClick={() => selectSavedReference(name)}
                                                                                        >
                                                                                            <p className="text-xs font-bold text-slate-800">{name}</p>
                                                                                            <p className="text-[10px] text-slate-400 mt-0.5">Used on previous admissions</p>
                                                                                        </button>
                                                                                    ))}
                                                                                    {filteredSavedReferenceNames.length === 0 && (
                                                                                        <div className="px-3 py-2 text-[11px] text-slate-400 italic border-b border-slate-100">
                                                                                            {refSearchTerm.trim() ? 'No saved names match your search' : 'No saved reference names yet'}
                                                                                        </div>
                                                                                    )}
                                                                                </>
                                                                            )}

                                                                            {refSearchTerm.trim().length >= 2 && (
                                                                                <>
                                                                                    <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 border-b border-t border-slate-100">
                                                                                        HRMS employees
                                                                                    </div>
                                                                                    {refSearchLoading ? (
                                                                                        <div className="p-3 text-center text-slate-500 text-xs">Searching employees…</div>
                                                                                    ) : refSearchResults.map((emp) => (
                                                                                        <button
                                                                                            type="button"
                                                                                            key={emp._id}
                                                                                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-50 last:border-b-0"
                                                                                            onClick={() => selectReferenceEmployee(emp)}
                                                                                        >
                                                                                            <p className="text-xs font-bold text-slate-800">
                                                                                                {emp.employee_name}{' '}
                                                                                                <span className="font-normal text-slate-500">({emp.emp_no})</span>
                                                                                            </p>
                                                                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                                                                {emp.designation_id?.designation_name || emp.designation_id?.name || 'N/A'}
                                                                                                {' · '}
                                                                                                {emp.department_id?.department_name || emp.department_id?.name || 'N/A'}
                                                                                            </p>
                                                                                        </button>
                                                                                    ))}
                                                                                    {!refSearchLoading && refSearchResults.length === 0 && (
                                                                                        <div className="p-3 text-center text-slate-500 text-xs">No employees found</div>
                                                                                    )}
                                                                                </>
                                                                            )}

                                                                            {referenceDraft ? (
                                                                                <button
                                                                                    type="button"
                                                                                    className="w-full text-left px-3 py-2 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 border-t border-slate-100"
                                                                                    onClick={() => {
                                                                                        setReferenceDraft('');
                                                                                        setRefSearchTerm('');
                                                                                        setRefDropdownOpen(false);
                                                                                    }}
                                                                                >
                                                                                    Clear reference
                                                                                </button>
                                                                            ) : null}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={cancelEditingReference}
                                                                    disabled={referenceSaveBusy}
                                                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={saveRequestReference}
                                                                    disabled={
                                                                        referenceSaveBusy
                                                                        || String(referenceDraft || '').trim() === String(req.referenceName || '').trim()
                                                                    }
                                                                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
                                                                >
                                                                    <Save size={13} />
                                                                    {referenceSaveBusy ? 'Saving…' : 'Save'}
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                    <p className="text-[10px] text-slate-400 mt-1">
                                                        Requested by <b>{req.requestedByName || req.requestedBy}</b> on{' '}
                                                        {new Date(req.createdAt).toLocaleString('en-IN', {
                                                            day: '2-digit', month: 'short', year: 'numeric',
                                                            hour: '2-digit', minute: '2-digit', hour12: true
                                                        })}
                                                        {req.mergedRequestCount > 1 && (
                                                            <> · Combined from {req.mergedRequestCount} requests; latest value kept for the same fee head</>
                                                        )}
                                                    </p>
                                                    {req.status === 'APPROVED' && (
                                                        <p className="text-[10px] text-emerald-600 mt-0.5">
                                                            Approved by <b>{req.approvedByName || req.approvedBy}</b>
                                                        </p>
                                                    )}
                                                    {req.status === 'REJECTED' && (
                                                        <p className="text-[10px] text-rose-600 mt-0.5">
                                                            Rejected by <b>{req.approvedByName || req.approvedBy}</b>
                                                            {req.rejectionReason && <> — "{req.rejectionReason}"</>}
                                                        </p>
                                                    )}
                                                </div>
                                                <button onClick={closeRequestModal}
                                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
                                                    <X size={18} />
                                                </button>
                                            </div>

                                            {/* Tabs */}
                                            <div className="px-5 pt-3 shrink-0 border-b border-slate-100 flex items-center justify-between gap-3">
                                                <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
                                                    <button type="button" onClick={() => setModalTab('request')}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${modalTab === 'request' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                                        Requested Concessions
                                                    </button>
                                                    <button type="button" onClick={() => setModalTab('structure')} disabled={isEditingRequest}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-40 ${modalTab === 'structure' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
                                                        Actual Fee Structure
                                                    </button>
                                                </div>
                                                {req.status === 'PENDING' && modalTab === 'request' && !isEditingRequest && canRequestsWrite && (
                                                    <button type="button" onClick={startEditingRequest}
                                                        className="mb-1 px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 transition flex items-center gap-1">
                                                        <Pencil size={12} /> Edit Entries
                                                    </button>
                                                )}
                                            </div>

                                            <div className="p-5 overflow-y-auto flex-1">
                                                {errorMessage && (
                                                    <div className="mb-3 p-3 bg-rose-50 text-rose-700 rounded-lg border border-rose-200 text-xs font-semibold">
                                                        {errorMessage}
                                                    </div>
                                                )}

                                                {modalTab === 'request' && isEditingRequest && (
                                                    <>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                                            Editing Request Entries · leave a cell blank to drop that year
                                                        </p>
                                                        <div className="overflow-x-auto border border-blue-200 rounded-xl">
                                                            <table className="w-full text-xs border-collapse">
                                                                <thead>
                                                                    <tr className="bg-blue-50/60 text-slate-500 text-[10px] uppercase">
                                                                        <th className="px-3 py-2 text-left">Fee Component</th>
                                                                        <th className="px-3 py-2 text-center">Type</th>
                                                                        {editYears.map(yr => (
                                                                            <th key={yr} className="px-3 py-2 text-right">{getYrSfx(yr)} Yr (₹)</th>
                                                                        ))}
                                                                        <th className="px-3 py-2 text-center w-10"></th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-100">
                                                                    {editRows.length === 0 && (
                                                                        <tr>
                                                                            <td colSpan={editYears.length + 3} className="px-3 py-6 text-center text-slate-400 italic">
                                                                                No fee components. Add one below.
                                                                            </td>
                                                                        </tr>
                                                                    )}
                                                                    {editRows.map(row => {
                                                                        const fh = feeHeads.find(h => normalizeFeeHeadId(h._id) === row.feeHeadId);
                                                                        return (
                                                                            <tr key={row.key} className="bg-white">
                                                                                <td className="px-3 py-2">
                                                                                    <select value={row.feeHeadId}
                                                                                        onChange={e => updateEditRow(row.key, { feeHeadId: normalizeFeeHeadId(e.target.value) })}
                                                                                        className="w-44 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                                                                                        {!fh && <option value={row.feeHeadId}>Unknown ({row.feeHeadId})</option>}
                                                                                        {feeHeads
                                                                                            .filter(h => normalizeFeeHeadId(h._id) === row.feeHeadId || !usedEditHeadIds.has(normalizeFeeHeadId(h._id)))
                                                                                            .map(h => (
                                                                                                <option key={h._id} value={normalizeFeeHeadId(h._id)}>
                                                                                                    {h.name} ({h.code})
                                                                                                </option>
                                                                                            ))}
                                                                                    </select>
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    <select value={row.concessionType}
                                                                                        onChange={e => updateEditRow(row.key, { concessionType: e.target.value })}
                                                                                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-[10px] font-bold bg-white">
                                                                                        <option value="CONCESSION">CONCESSION</option>
                                                                                        <option value="REVISED">REVISED</option>
                                                                                    </select>
                                                                                </td>
                                                                                {editYears.map(yr => {
                                                                                    const structAmt = structureAmountFor(row.feeHeadId, yr);
                                                                                    const val = row.years[yr] ?? '';
                                                                                    const exceeds = row.concessionType === 'REVISED'
                                                                                        && structAmt !== undefined
                                                                                        && String(val).trim() !== ''
                                                                                        && Number(val) > Number(structAmt);
                                                                                    return (
                                                                                        <td key={yr} className="px-2 py-2 text-right">
                                                                                            <input type="number" min="0" value={val}
                                                                                                onChange={e => updateEditAmount(row.key, yr, e.target.value)}
                                                                                                onWheel={e => e.target.blur()}
                                                                                                placeholder="—"
                                                                                                className={`w-24 border rounded-lg px-2 py-1.5 text-xs text-right bg-white ${exceeds ? 'border-rose-400 text-rose-600' : 'border-slate-300'}`} />
                                                                                            {structAmt !== undefined && (
                                                                                                <div className={`text-[9px] mt-0.5 ${exceeds ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>
                                                                                                    Structure ₹{Number(structAmt).toLocaleString()}
                                                                                                </div>
                                                                                            )}
                                                                                        </td>
                                                                                    );
                                                                                })}
                                                                                <td className="px-3 py-2 text-center">
                                                                                    <button type="button" onClick={() => removeEditRow(row.key)}
                                                                                        title="Remove fee component"
                                                                                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition">
                                                                                        <Trash2 size={13} />
                                                                                    </button>
                                                                                </td>
                                                                            </tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                            </table>
                                                        </div>

                                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                                            <select value={editNewHeadId} onChange={e => setEditNewHeadId(e.target.value)}
                                                                className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white">
                                                                <option value="">Add fee component...</option>
                                                                {availableEditHeads.map(h => (
                                                                    <option key={h._id} value={normalizeFeeHeadId(h._id)}>
                                                                        {h.name} ({h.code})
                                                                    </option>
                                                                ))}
                                                            </select>
                                                            <button type="button" onClick={addEditRow} disabled={!editNewHeadId}
                                                                className="px-3 py-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 disabled:opacity-40 transition flex items-center gap-1">
                                                                <Plus size={12} /> Add
                                                            </button>
                                                            <button type="button"
                                                                onClick={() => {
                                                                    const nextYr = (editYears[editYears.length - 1] || 0) + 1;
                                                                    setEditRows(rows => rows.map(r => ({ ...r, years: { ...r.years, [nextYr]: r.years[nextYr] ?? '' } })));
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition flex items-center gap-1">
                                                                <Plus size={12} /> Add Year
                                                            </button>
                                                        </div>
                                                    </>
                                                )}

                                                {modalTab === 'request' && !isEditingRequest && (
                                                    <>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                                            Requested Concessions ({req.concessions.length} entries)
                                                        </p>
                                                        <div className="overflow-x-auto border border-slate-200 rounded-xl">
                                                            <table className="w-full text-xs border-collapse">
                                                                <thead>
                                                                    <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                                                                        <th className="px-3 py-2 text-left">Fee Component</th>
                                                                        <th className="px-3 py-2 text-left">Code</th>
                                                                        <th className="px-3 py-2 text-center">Type</th>
                                                                        {reqYears.map(yr => (
                                                                            <th key={yr} className="px-3 py-2 text-right">{getYrSfx(yr)} Yr (₹)</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-slate-100">
                                                                    {Object.entries(byHead).map(([fhId, row]) => (
                                                                        <tr key={fhId} className="bg-white">
                                                                            <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{row.name}</td>
                                                                            <td className="px-3 py-2 text-slate-500 font-mono text-[10px]">{row.code || '—'}</td>
                                                                            <td className="px-3 py-2 text-center">
                                                                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${row.concessionType === 'CONCESSION' ? 'bg-amber-50 text-amber-700 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                                                                    {row.concessionType}
                                                                                </span>
                                                                            </td>
                                                                            {reqYears.map(yr => (
                                                                                <td key={yr} className="px-3 py-2 text-right font-bold text-slate-900">
                                                                                    {row.years[yr] !== undefined
                                                                                        ? `₹${Number(row.years[yr]).toLocaleString()}`
                                                                                        : <span className="text-slate-300 font-normal">—</span>}
                                                                                </td>
                                                                            ))}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </>
                                                )}

                                                {modalTab === 'structure' && !isEditingRequest && (
                                                    <>
                                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                                            Actual Fee Structure
                                                            {req.studentQuota ? ` · Quota ${req.studentQuota}` : ''}
                                                            {req.batch ? ` · Batch ${req.batch}` : ''}
                                                        </p>
                                                        {modalStructuresLoading ? (
                                                            <div className="border border-slate-200 rounded-xl p-10 text-center text-slate-400 italic text-xs">
                                                                Loading fee structure...
                                                            </div>
                                                        ) : Object.keys(structureByHead).length === 0 ? (
                                                            <div className="border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-xs">
                                                                No fee structure found for this student’s college / course / branch / batch / quota.
                                                            </div>
                                                        ) : (
                                                            <div className="overflow-x-auto border border-slate-200 rounded-xl">
                                                                <table className="w-full text-xs border-collapse">
                                                                    <thead>
                                                                        <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase">
                                                                            <th className="px-3 py-2 text-left">Fee Component</th>
                                                                            <th className="px-3 py-2 text-left">Code</th>
                                                                            {structureYears.map(yr => (
                                                                                <th key={yr} className="px-3 py-2 text-right">{getYrSfx(yr)} Yr (₹)</th>
                                                                            ))}
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100">
                                                                        {Object.entries(structureByHead).map(([fhId, row]) => (
                                                                            <tr key={fhId} className="bg-white">
                                                                                <td className="px-3 py-2 font-semibold text-slate-800 whitespace-nowrap">{row.name}</td>
                                                                                <td className="px-3 py-2 text-slate-500 font-mono text-[10px]">{row.code || '—'}</td>
                                                                                {structureYears.map(yr => (
                                                                                    <td key={yr} className="px-3 py-2 text-right font-bold text-slate-900">
                                                                                        {row.years[yr] !== undefined
                                                                                            ? `₹${Number(row.years[yr]).toLocaleString()}`
                                                                                            : <span className="text-slate-300 font-normal">—</span>}
                                                                                    </td>
                                                                                ))}
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </>
                                                )}

                                                {modalMode === 'reject' && !isEditingRequest && canRequestsWrite && (
                                                    <div className="mt-4 p-3 rounded-xl border border-rose-200 bg-rose-50/60">
                                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                                                            Rejection Reason <span className="text-rose-500">*</span>
                                                        </label>
                                                        <input type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                                                            placeholder="Enter reason for rejection..."
                                                            className="w-full border border-slate-300 rounded-lg p-2.5 text-xs bg-white" />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="px-5 py-4 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 shrink-0 bg-slate-50/50">
                                                {isEditingRequest ? (
                                                    <>
                                                        <button onClick={cancelEditingRequest} disabled={editSaveBusy}
                                                            className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition disabled:opacity-50">
                                                            Cancel
                                                        </button>
                                                        <button onClick={saveEditedRequest} disabled={editSaveBusy}
                                                            className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50 flex items-center gap-1 shadow-sm">
                                                            <Save size={13} /> {editSaveBusy ? 'Saving...' : 'Save Changes'}
                                                        </button>
                                                    </>
                                                ) : (
                                                <button onClick={closeRequestModal}
                                                    className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition">
                                                    Close
                                                </button>
                                                )}
                                                {req.status === 'PENDING' && modalMode === 'view' && !isEditingRequest && canRequestsWrite && (
                                                    <>
                                                        <button onClick={() => setModalMode('reject')}
                                                            className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition flex items-center gap-1 shadow-sm">
                                                            <XCircle size={13} /> Reject
                                                        </button>
                                                        <button onClick={() => handleApprove(req._id)} disabled={approveBusy}
                                                            className="px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition disabled:opacity-50 flex items-center gap-1 shadow-sm">
                                                            <CheckCircle size={13} /> {approveBusy ? 'Approving...' : 'Approve'}
                                                        </button>
                                                    </>
                                                )}
                                                {req.status === 'PENDING' && modalMode === 'reject' && canRequestsWrite && (
                                                    <>
                                                        <button onClick={() => { setModalMode('view'); setRejectReason(''); }}
                                                            className="px-3 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition">
                                                            Back
                                                        </button>
                                                        <button onClick={() => handleReject(req._id)} disabled={rejectBusy || !rejectReason.trim()}
                                                            className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition disabled:opacity-50 flex items-center gap-1 shadow-sm">
                                                            <XCircle size={13} /> {rejectBusy ? 'Rejecting...' : 'Confirm Reject'}
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Approve success modal */}
                            {approveSuccess && (
                                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-[1px]"
                                    onClick={() => setApproveSuccess(null)}>
                                    <div className="bg-white rounded-2xl shadow-2xl border border-emerald-100 w-full max-w-md overflow-hidden"
                                        onClick={e => e.stopPropagation()}>
                                        <div className="px-6 pt-8 pb-4 text-center">
                                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center">
                                                <CheckCircle size={32} className="text-emerald-600" />
                                            </div>
                                            <h3 className="text-lg font-black text-slate-900">Request Approved</h3>
                                            <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                                                Concession request has been approved and fees updated successfully.
                                            </p>
                                        </div>
                                        <div className="mx-6 mb-5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs space-y-1.5">
                                            <p className="font-bold text-slate-800 text-sm">{approveSuccess.studentName}</p>
                                            <p className="text-slate-500">
                                                Adm: <b className="text-slate-700">{approveSuccess.admissionNumber || '—'}</b>
                                                {approveSuccess.pinNo ? <> &nbsp;|&nbsp; Pin: <b className="text-slate-700">{approveSuccess.pinNo}</b></> : null}
                                            </p>
                                            {(approveSuccess.college || approveSuccess.course) && (
                                                <p className="text-slate-500">
                                                    {[approveSuccess.college, approveSuccess.course, approveSuccess.branch]
                                                        .filter(Boolean).join(' — ')}
                                                    {approveSuccess.batch ? <> &nbsp;|&nbsp; Batch <b className="text-slate-700">{approveSuccess.batch}</b></> : null}
                                                </p>
                                            )}
                                            {approveSuccess.entryCount > 0 && (
                                                <p className="text-emerald-700 font-semibold pt-1">
                                                    {approveSuccess.entryCount} concession {approveSuccess.entryCount === 1 ? 'entry' : 'entries'} applied
                                                </p>
                                            )}
                                        </div>
                                        <div className="px-6 pb-6">
                                            <button type="button" onClick={() => setApproveSuccess(null)}
                                                className="w-full py-2.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition shadow-sm">
                                                Done
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════
                        REPORTS TAB
                    ══════════════════════════════════════════════════ */}
                    {activeTab === 'register' && canRequests && (
                        <div className="space-y-4 animate-fadeIn">

                            {/* Controls row: filters + print all */}
                            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-3">
                                {/* Status pills */}
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="flex flex-wrap gap-2 items-center">
                                        <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase">
                                            Approved only
                                        </span>
                                    </div>
                                    <button
                                        onClick={handleRegPrintAll}
                                        disabled={regPrintAllBusy || regRequests.length === 0 || !regFilters.college || !regFilters.course || !regFilters.branch || !regFilters.batch}
                                        title={(!regFilters.college || !regFilters.course || !regFilters.branch || !regFilters.batch) ? 'Please select all filters (College, Course, Branch, Batch) to enable Print All' : 'Print all approved records'}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0">
                                        <Printer size={14} />
                                        {regPrintAllBusy ? 'Printing...' : `Print All (${regRequests.length})`}
                                    </button>
                                </div>

                                {/* Filter dropdowns + search */}
                                <div className="flex flex-col xl:flex-row gap-3 items-end">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">College</label>
                                            <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                                value={regFilters.college} onChange={handleRegCollegeChange}>
                                                <option value="">All Colleges</option>
                                                {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Batch</label>
                                            <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                                value={regFilters.batch} onChange={e => setRegFilters(f => ({ ...f, batch: e.target.value }))}>
                                                <option value="">All Batches</option>
                                                {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Course</label>
                                            <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                                value={regFilters.course} onChange={handleRegCourseChange} disabled={!regFilters.college}>
                                                <option value="">All Courses</option>
                                                {regCourses.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Branch</label>
                                            <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                                value={regFilters.branch} onChange={e => setRegFilters(f => ({ ...f, branch: e.target.value }))} disabled={!regFilters.course}>
                                                <option value="">All Branches</option>
                                                {regBranches.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 items-center xl:w-auto w-full">
                                        <div className="relative flex-1 xl:w-60">
                                            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                            <input type="text" value={regSearchTerm}
                                                onChange={e => setRegSearchTerm(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && fetchRegisterRequests()}
                                                placeholder="Name / Adm No / Pin..."
                                                className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full pl-8 p-2.5" />
                                        </div>
                                        <button onClick={fetchRegisterRequests} disabled={regLoading}
                                            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-60 cursor-pointer shrink-0">
                                            <Filter size={13} /> {regLoading ? 'Loading...' : 'Search'}
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                {regLoading ? (
                                    <div className="text-center py-16 text-slate-400 italic text-sm">Loading...</div>
                                ) : regRequests.length === 0 ? (
                                    <div className="text-center py-16 text-slate-400 text-sm">No records found for the selected filters.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase border-b border-slate-200">
                                                    <th className="px-4 py-3 text-left">Student</th>
                                                    <th className="px-4 py-3 text-left">College / Course</th>
                                                    <th className="px-4 py-3 text-left">Batch</th>
                                                    <th className="px-4 py-3 text-center">Quota</th>
                                                    <th className="px-4 py-3 text-center">Entries</th>
                                                    <th className="px-4 py-3 text-right">Total (₹)</th>
                                                    <th className="px-4 py-3 text-center">Status</th>
                                                    <th className="px-4 py-3 text-center">Date</th>
                                                    <th className="px-4 py-3 text-center">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {regRequests.map(req => {
                                                    const isExpanded = regExpandedId === req._id;
                                                    const total = (req.concessions || []).reduce((s, c) => s + Number(c.amount ?? 0), 0);
                                                    const concessions = req.concessions || [];
                                                    const years = [...new Set(concessions.map(c => Number(c.studentYear)))].sort((a, b) => a - b);
                                                    const byHead = {};
                                                    concessions.forEach(c => {
                                                        const resolved = resolveFeeHeadDisplay(c);
                                                        const k = resolved.feeHeadId || normalizeFeeHeadId(c.feeHeadId);
                                                        if (!byHead[k]) {
                                                            byHead[k] = {
                                                                name: resolved.name,
                                                                code: resolved.code,
                                                                type: c.concessionType,
                                                                years: {}
                                                            };
                                                        }
                                                        byHead[k].years[Number(c.studentYear)] = Number(c.amount ?? 0);
                                                        byHead[k].type = c.concessionType;
                                                        byHead[k].name = resolved.name;
                                                        byHead[k].code = resolved.code;
                                                    });
                                                    const getYrSfx = yr => yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : `${yr}th`;
                                                    const fmt = n => Number(n ?? 0).toLocaleString('en-IN');
                                                    const dateStr = new Date(req.createdAt).toLocaleString('en-IN', {
                                                        day: '2-digit', month: 'short', year: 'numeric',
                                                        hour: '2-digit', minute: '2-digit', hour12: true
                                                    });
                                                    return (
                                                        <React.Fragment key={req._id}>
                                                            <tr onClick={() => setRegExpandedId(prev => prev === req._id ? null : req._id)}
                                                                className={`border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer transition ${isExpanded ? 'bg-blue-50/30' : ''}`}>
                                                                <td className="px-4 py-3">
                                                                    <div className="font-bold text-slate-900">{req.studentName}</div>
                                                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                                                        Adm: {req.admissionNumber}{req.pinNo ? ` · Pin: ${req.pinNo}` : ''}
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3 text-slate-700">
                                                                    <div className="font-semibold">{req.college}</div>
                                                                    <div className="text-[10px] text-slate-500">{req.course} — {req.branch}</div>
                                                                </td>
                                                                <td className="px-4 py-3 font-semibold text-slate-800">{req.batch}</td>
                                                                <td className="px-4 py-3 text-center">
                                                                    <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold uppercase text-[10px]">
                                                                        {req.category || req.studentQuota || '—'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-3 text-center font-bold text-slate-800">{concessions.length}</td>
                                                                <td className="px-4 py-3 text-right font-extrabold text-slate-900">₹{fmt(total)}</td>
                                                                <td className="px-4 py-3 text-center"><StatusBadge status={req.status} /></td>
                                                                <td className="px-4 py-3 text-center text-slate-500 whitespace-nowrap text-[10px]">{dateStr}</td>
                                                                <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                                                    <div className="flex items-center justify-center gap-1">
                                                                        <button onClick={() => setRegExpandedId(prev => prev === req._id ? null : req._id)}
                                                                            title={isExpanded ? 'Collapse' : 'View Details'}
                                                                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer">
                                                                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                                        </button>
                                                                        <button onClick={e => handleRegPrintSingle(req, e)}
                                                                            disabled={regPrintSingleBusy === req._id}
                                                                            title="Print this student"
                                                                            className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition disabled:opacity-50 cursor-pointer">
                                                                            <Printer size={14} />
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>

                                                            {/* ── Inline expanded detail ── */}
                                                            {isExpanded && (
                                                                <tr>
                                                                    <td colSpan={9} className="p-0">
                                                                        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4">
                                                                            {/* Concession table */}
                                                                            <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
                                                                                <table className="w-full text-xs border-collapse">
                                                                                    <thead>
                                                                                        <tr className="bg-slate-100 text-slate-500 text-[10px] uppercase">
                                                                                            <th className="px-3 py-2 text-left font-bold">Fee Component</th>
                                                                                            <th className="px-3 py-2 text-left font-bold">Code</th>
                                                                                            <th className="px-3 py-2 text-center font-bold">Type</th>
                                                                                            {years.map(yr => (
                                                                                                <th key={yr} className="px-3 py-2 text-right font-bold">{getYrSfx(yr)} Yr (₹)</th>
                                                                                            ))}
                                                                                            <th className="px-3 py-2 text-right font-bold">Total (₹)</th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-slate-100">
                                                                                        {Object.entries(byHead).map(([fhId, row], idx) => {
                                                                                            const rowTotal = Object.values(row.years).reduce((s, v) => s + v, 0);
                                                                                            return (
                                                                                                <tr key={fhId} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                                                                                                    <td className="px-3 py-2 font-semibold text-slate-800">{row.name}</td>
                                                                                                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{row.code || '—'}</td>
                                                                                                    <td className="px-3 py-2 text-center">
                                                                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${row.type === 'REVISED' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                                                                                                            {row.type}
                                                                                                        </span>
                                                                                                    </td>
                                                                                                    {years.map(yr => (
                                                                                                        <td key={yr} className="px-3 py-2 text-right font-bold text-slate-900">
                                                                                                            {row.years[yr] !== undefined ? `₹${fmt(row.years[yr])}` : <span className="text-slate-300 font-normal">—</span>}
                                                                                                        </td>
                                                                                                    ))}
                                                                                                    <td className="px-3 py-2 text-right font-extrabold text-slate-900">₹{fmt(rowTotal)}</td>
                                                                                                </tr>
                                                                                            );
                                                                                        })}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
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
                                )}
                            </div>
                        </div>
                    )}

                    {/* ══════════════════════════════════════════════════
                        BULK LOAD TAB
                    ══════════════════════════════════════════════════ */}
                    {activeTab === 'bulk' && canBulk && (
                        <div className="space-y-4 animate-fadeIn">

                            {/* Config bar */}
                            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 space-y-4">
                                <h3 className="text-sm font-bold text-slate-700">Configure Bulk Load</h3>

                                {/* Filters row */}
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">College</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.college} onChange={e => {
                                                const college = e.target.value;
                                                setFilters({ college, course: '', branch: '', batch: filters.batch });
                                                setCourses(college ? Object.keys(metadata[college] || {}) : []);
                                                setBranches([]);
                                            }}>
                                            <option value="">Select College</option>
                                            {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Batch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.batch} onChange={e => setFilters(f => ({ ...f, batch: e.target.value }))}>
                                            <option value="">Select Batch</option>
                                            {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Course</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.course} onChange={e => {
                                                const course = e.target.value;
                                                setFilters(f => ({ ...f, course, branch: '' }));
                                                if (course && filters.college) setBranches(metadata[filters.college][course]?.branches || []);
                                                else setBranches([]);
                                            }} disabled={!filters.college}>
                                            <option value="">Select Course</option>
                                            {courses.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Branch</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={filters.branch} onChange={e => setFilters(f => ({ ...f, branch: e.target.value }))} disabled={!filters.course}>
                                            <option value="">Select Branch</option>
                                            {branches.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Quota</label>
                                        <select className="bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5"
                                            value={bulkQuotaFilter} onChange={e => setBulkQuotaFilter(e.target.value)}>
                                            <option value="">All Quotas</option>
                                            {(bulkLoaded
                                                ? [...new Set(bulkStudents.map(s => s.stud_type).filter(Boolean))].sort()
                                                : quotaOptions
                                            ).map(q => <option key={q} value={q}>{q}</option>)}
                                        </select>
                                    </div>
                                    {/* Fee head picker */}
                                    <div ref={bulkHeadDropRef}>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Fee Head Columns</label>
                                        <div className="relative">
                                            <button type="button" onClick={() => setBulkHeadDropOpen(v => !v)}
                                                className="w-full bg-slate-50 border border-slate-300 text-slate-800 text-xs rounded-lg p-2.5 text-left flex justify-between items-center cursor-pointer">
                                                <span>{bulkSelectedHeads.length ? `${bulkSelectedHeads.length} selected` : 'Select fee heads...'}</span>
                                                <ChevronDown size={14} className={`transition ${bulkHeadDropOpen ? 'rotate-180' : ''}`} />
                                            </button>
                                            {bulkHeadDropOpen && (
                                                <div className="absolute left-0 right-0 z-20 mt-1 w-full bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                                    {feeHeads.map(fh => (
                                                        <label key={fh._id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs">
                                                            <input type="checkbox"
                                                                checked={bulkSelectedHeads.includes(fh._id)}
                                                                onChange={e => {
                                                                    if (e.target.checked) setBulkSelectedHeads(prev => [...prev, fh._id]);
                                                                    else setBulkSelectedHeads(prev => prev.filter(id => id !== fh._id));
                                                                }}
                                                                className="rounded border-slate-300"
                                                            />
                                                            <span className="font-semibold">{fh.name}</span>
                                                            {fh.code && <span className="text-slate-400">({fh.code})</span>}
                                                        </label>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {bulkSelectedHeads.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {bulkSelectedHeads.map(fhId => {
                                            const fh = feeHeads.find(h => h._id === fhId);
                                            if (!fh) return null;
                                            return (
                                                <span key={fhId} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded text-[10px] font-bold">
                                                    <span>{fh.name}</span>
                                                    <button type="button" onClick={() => setBulkSelectedHeads(prev => prev.filter(id => id !== fhId))}
                                                        className="hover:text-blue-950 hover:bg-blue-100 p-0.5 rounded cursor-pointer transition">
                                                        <X size={10} />
                                                    </button>
                                                </span>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Load button */}
                                <div className="flex items-center gap-3">
                                    <button onClick={handleBulkLoad}
                                        disabled={loading || !filters.college || !filters.course || !filters.branch || !filters.batch || bulkSelectedHeads.length === 0}
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2">
                                        {loading ? <><span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span> Loading...</> : <><Search size={14} /> Load Students</>}
                                    </button>
                                    {bulkSelectedHeads.length > 0 && (
                                        <button onClick={() => { setBulkSelectedHeads([]); setBulkStudents([]); setBulkAmounts({}); setBulkConcTypes({}); setBulkLoaded(false); setBulkSuccess(''); setBulkError(''); setBulkQuotaFilter(''); }}
                                            className="px-3 py-2.5 text-xs text-slate-500 hover:text-slate-700 cursor-pointer">
                                            Clear All
                                        </button>
                                    )}
                                </div>

                                {bulkError && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{bulkError}</div>}
                                {bulkSuccess && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{bulkSuccess}</div>}
                            </div>

                            {/* Editable grid */}
                            {bulkLoaded && bulkStudents.length > 0 && (() => {
                                const numYears = courseYears[filters.course] || 4;
                                const selectedFeeHeadObjs = bulkSelectedHeads.map(id => feeHeads.find(fh => fh._id === id)).filter(Boolean);

                                const sortedBulkStudents = [...bulkStudents].sort((a, b) => {
                                    if (!bulkSortField) return 0;
                                    let valA = a[bulkSortField] || '';
                                    let valB = b[bulkSortField] || '';
                                    if (typeof valA === 'string') {
                                        return bulkSortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                                    }
                                    return bulkSortDir === 'asc' ? (valA > valB ? 1 : -1) : (valB > valA ? 1 : -1);
                                });
                                return (
                                    <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
                                        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                                            <h3 className="text-sm font-bold text-slate-700">{sortedBulkStudents.length} Students × {numYears} Years × {selectedFeeHeadObjs.length} Fee Heads{bulkQuotaFilter ? <span className="ml-2 text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 rounded px-2 py-0.5 uppercase">{bulkQuotaFilter} Quota</span> : null}</h3>
                                        </div>
                                        <div className="overflow-auto max-h-[70vh]">
                                            <table className="w-full text-xs border-collapse">
                                                <thead className="sticky top-0 z-10">
                                                    <tr className="bg-slate-100">
                                                        <th className="px-3 py-2 text-left font-bold text-slate-600 border border-slate-300 whitespace-nowrap">S.No</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-600 border border-slate-300 whitespace-nowrap min-w-[160px] cursor-pointer hover:bg-slate-200 select-none"
                                                            onClick={() => {
                                                                const dir = (bulkSortField === 'student_name' && bulkSortDir === 'asc') ? 'desc' : 'asc';
                                                                setBulkSortField('student_name');
                                                                setBulkSortDir(dir);
                                                            }}>
                                                            <div className="flex items-center gap-1">
                                                                <span>Student Name</span>
                                                                {bulkSortField === 'student_name' ? (
                                                                    bulkSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                                                ) : (
                                                                    <span className="text-slate-300">↕</span>
                                                                )}
                                                            </div>
                                                        </th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-600 border border-slate-300 whitespace-nowrap cursor-pointer hover:bg-slate-200 select-none"
                                                            onClick={() => {
                                                                const dir = (bulkSortField === 'admission_number' && bulkSortDir === 'asc') ? 'desc' : 'asc';
                                                                setBulkSortField('admission_number');
                                                                setBulkSortDir(dir);
                                                            }}>
                                                            <div className="flex items-center gap-1">
                                                                <span>Adm No</span>
                                                                {bulkSortField === 'admission_number' ? (
                                                                    bulkSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                                                ) : (
                                                                    <span className="text-slate-300">↕</span>
                                                                )}
                                                            </div>
                                                        </th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-600 border border-slate-300 whitespace-nowrap cursor-pointer hover:bg-slate-200 select-none"
                                                            onClick={() => {
                                                                const dir = (bulkSortField === 'pin_no' && bulkSortDir === 'asc') ? 'desc' : 'asc';
                                                                setBulkSortField('pin_no');
                                                                setBulkSortDir(dir);
                                                            }}>
                                                            <div className="flex items-center gap-1">
                                                                <span>PIN</span>
                                                                {bulkSortField === 'pin_no' ? (
                                                                    bulkSortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                                                                ) : (
                                                                    <span className="text-slate-300">↕</span>
                                                                )}
                                                            </div>
                                                        </th>
                                                        <th className="px-3 py-2 text-center font-bold text-slate-600 border border-slate-300 whitespace-nowrap">Year</th>
                                                        <th className="px-3 py-2 text-left font-bold text-slate-600 border border-slate-300 whitespace-nowrap min-w-[150px]">Year Remarks</th>
                                                        {selectedFeeHeadObjs.map(fh => (
                                                            <th key={fh._id} className="px-3 py-2 text-center font-bold text-slate-600 border border-slate-300 whitespace-nowrap min-w-[220px]">
                                                                <div>{fh.name}</div>
                                                                <div className="mt-1 flex flex-row gap-1 justify-center items-center">
                                                                    <select
                                                                        className="text-[9px] bg-slate-50 border border-slate-300 rounded px-1 py-0.5 cursor-pointer font-medium w-full max-w-[110px]"
                                                                        value={bulkConcTypes[`_global_${fh._id}`] || 'REVISED'}
                                                                        onChange={e => {
                                                                            const type = e.target.value;
                                                                            setBulkConcTypes(prev => {
                                                                                const next = { ...prev, [`_global_${fh._id}`]: type };
                                                                                bulkStudents.forEach(s => { next[`${s.admission_number}_${fh._id}`] = type; });
                                                                                return next;
                                                                            });
                                                                        }}>
                                                                        <option value="REVISED">Revised</option>
                                                                        <option value="CONCESSION">Concession</option>
                                                                    </select>
                                                                    <select
                                                                        className="text-[9px] bg-slate-50 border border-slate-300 rounded px-1 py-0.5 cursor-pointer font-medium w-full max-w-[110px]"
                                                                        value={bulkApplyMode[fh._id] || 'single'}
                                                                        onChange={e => {
                                                                            const mode = e.target.value;
                                                                            setBulkApplyMode(prev => ({ ...prev, [fh._id]: mode }));
                                                                        }}>
                                                                        <option value="single">Cell Only</option>
                                                                        <option value="student">Apply to Student (All Years)</option>
                                                                        <option value="year">Apply to Year (All)</option>
                                                                        <option value="all">Apply to All Years (All)</option>
                                                                    </select>
                                                                </div>
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {sortedBulkStudents.map((s, sIdx) => (
                                                        Array.from({ length: numYears }, (_, yrIdx) => {
                                                            const yr = yrIdx + 1;
                                                            return (
                                                                <tr key={`${s.admission_number}_${yr}`} className={sIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                                                    {yrIdx === 0 && (
                                                                        <>
                                                                            <td className="px-3 py-2 border border-slate-200 text-center font-bold text-slate-500" rowSpan={numYears}>{sIdx + 1}</td>
                                                                            <td className="px-3 py-2 border border-slate-200 font-semibold text-slate-800" rowSpan={numYears}>
                                                                                <div>{s.student_name}</div>
                                                                                {s.student_status && (
                                                                                    <div className="mt-1">
                                                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                                                                            ['active', 'regular'].includes(String(s.student_status).toLowerCase())
                                                                                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                                                : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                                                        }`}>
                                                                                            {s.student_status}
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                            </td>
                                                                            <td className="px-3 py-2 border border-slate-200 text-slate-600 font-mono" rowSpan={numYears}>{s.admission_number}</td>
                                                                            <td className="px-3 py-2 border border-slate-200 text-slate-600 font-mono" rowSpan={numYears}>{s.pin_no || '-'}</td>
                                                                        </>
                                                                    )}
                                                                    <td className="px-3 py-2 border border-slate-200 text-center font-bold text-slate-600">{yr === 1 ? '1st' : yr === 2 ? '2nd' : yr === 3 ? '3rd' : `${yr}th`} Yr</td>
                                                                    <td className="px-1 py-1 border border-slate-200">
                                                                        <input
                                                                            type="text"
                                                                            placeholder="Remarks"
                                                                            className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                                                            value={bulkRemarks[`${s.admission_number}_${yr}`] || ''}
                                                                            onChange={e => {
                                                                                const val = e.target.value;
                                                                                setBulkRemarks(prev => ({
                                                                                    ...prev,
                                                                                    [`${s.admission_number}_${yr}`]: val
                                                                                }));
                                                                            }}
                                                                        />
                                                                    </td>
                                                                    {selectedFeeHeadObjs.map(fh => {
                                                                        const cellKey = `${s.admission_number}_${yr}_${fh._id}`;
                                                                        return (
                                                                            <td key={cellKey} className="px-1 py-1 border border-slate-200">
                                                                                <input
                                                                                    type="number"
                                                                                    min="0"
                                                                                    className="w-full px-2 py-1.5 text-xs text-right border border-slate-200 rounded focus:ring-1 focus:ring-blue-400 focus:border-blue-400 outline-none"
                                                                                    placeholder="—"
                                                                                    value={bulkAmounts[cellKey] ?? ''}
                                                                                    onChange={e => handleBulkAmountChange(s.admission_number, yr, fh._id, e.target.value)}
                                                                                    onWheel={e => e.target.blur()}
                                                                                />
                                                                            </td>
                                                                        );
                                                                    })}
                                                                </tr>
                                                            );
                                                        })
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Save bar */}
                                        <div className="p-4 border-t border-slate-200 flex items-center justify-between sticky bottom-0 bg-white rounded-b-xl">
                                            <span className="text-xs text-slate-500">{sortedBulkStudents.length} students{bulkQuotaFilter ? ` (${bulkQuotaFilter} quota)` : ''}</span>
                                            <button onClick={handleBulkSaveAll} disabled={bulkSaving}
                                                className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2">
                                                {bulkSaving ? <><span className="animate-spin h-3 w-3 border-2 border-white border-t-transparent rounded-full"></span> Saving...</> : <><Save size={14} /> Save All ({sortedBulkStudents.length} students)</>}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}

                            {bulkLoaded && bulkStudents.length === 0 && (
                                <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-12 text-center">
                                    <User size={40} className="mx-auto text-slate-300 mb-3" />
                                    <p className="text-sm text-slate-500">No students found matching the selected filters.</p>
                                </div>
                            )}
                        </div>
                    )}

                </main>
            </div>
        </div>
    );
};

export default OverallConcession;
