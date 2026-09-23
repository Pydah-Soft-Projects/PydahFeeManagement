import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import api from '../lib/api';
import { useReactToPrint } from 'react-to-print';
import Sidebar from './Sidebar';
import ReceiptTemplate from '../components/ReceiptTemplate';
import { printHtmlDocument } from '../utils/printService';
import { getFeeCollectionCache, setFeeCollectionCache, getOrCreateFeeCollectionFetch } from '../lib/feeCollectionCache';

const fmtAmount = (value) => Number(value ?? 0).toLocaleString('en-IN');

const formatDateDDMonthYYYY = (dateVal) => {
    if (!dateVal) return '-';
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return '-';
    const day = d.getDate();
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
};

const buildStudentsQueryKey = () => {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    const isSuperAdmin = user?.role === 'superadmin';
    const queryParams = [];
    if (!isSuperAdmin) {
        if (user?.colleges && user.colleges.length > 0) {
            queryParams.push(`college=${encodeURIComponent(user.colleges.join(','))}`);
        } else if (user?.college) {
            queryParams.push(`college=${encodeURIComponent(user.college)}`);
        }
        if (user?.courses && user.courses.length > 0) {
            const courseNames = [...new Set(user.courses.map(c => c.split('|')[1]))];
            queryParams.push(`course=${encodeURIComponent(courseNames.join(','))}`);
        }
    }
    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
    return { queryString, cacheKey: `${user?.id || user?.username || 'anon'}|${queryString}` };
};

const FeeCollection = () => {
    // --- SEARCH & DATA STATE ---
    const [allStudents, setAllStudents] = useState([]); // Store ALL students
    const [searchQuery, setSearchQuery] = useState('');
    const [student, setStudent] = useState(null); // Selected Student
    const [loading, setLoading] = useState(false); // General loading (initial fetch)
    const [error, setError] = useState('');
    const [isDashLoading, setIsDashLoading] = useState(false); // Loading for student dashboard data
    const [isSyncingFees, setIsSyncingFees] = useState(false);
    const [expandedFeeRows, setExpandedFeeRows] = useState(new Set());


    // --- FEE & PAYMENT STATE ---
    const [feeDetails, setFeeDetails] = useState([]);
    const [paymentConfigs, setPaymentConfigs] = useState([]);
    const [receiptSettings, setReceiptSettings] = useState(null);
    const [viewFilterYear, setViewFilterYear] = useState('ALL');
    const [viewFilterStatus, setViewFilterStatus] = useState('ACTIVE');
    const [globalFeeHeads, setGlobalFeeHeads] = useState([]);

    // Multi-Select State
    const [feeRows, setFeeRows] = useState([{ id: Date.now(), feeHeadId: '', amount: '' }]);

    // --- EDIT TRANSACTION STATE ---
    const [isEditMode, setIsEditMode] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState(null);

    const [paymentForm, setPaymentForm] = useState({
        paymentMode: 'Cash',
        remarks: '',
        bankName: '',
        instrumentDate: '',
        referenceNo: '',
        referenceDate: '',
        paymentConfigId: '',
        proceedingId: '',
        paymentDate: new Date().toLocaleDateString('en-CA')
    });
    const [paymentCategory, setPaymentCategory] = useState('Cash');
    // perRowSplitCash: { [feeRowId]: cashAmountString }
    const [perRowSplitCash, setPerRowSplitCash] = useState({});
    const [transactions, setTransactions] = useState([]);
    const [recentTransactions, setRecentTransactions] = useState([]);
    const [toast, setToast] = useState(null);
    const [isPrintingStatement, setIsPrintingStatement] = useState(false);

    const showToastMessage = (message, type = 'success') => {
        setToast({ message, type });
    };

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 4000);
            return () => clearTimeout(timer);
        }
    }, [toast]);

    // Modals
    const [showReceiptModal, setShowReceiptModal] = useState(false);
    const [printOrientation, setPrintOrientation] = useState('portrait');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [showPhotoPopup, setShowPhotoPopup] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [txToDelete, setTxToDelete] = useState(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [sequencePreview, setSequencePreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);

    const [lastTransaction, setLastTransaction] = useState(null);
    const [relatedTransactions, setRelatedTransactions] = useState([]);
    const [selectedProceeding, setSelectedProceeding] = useState(null);
    const [availableProceedings, setAvailableProceedings] = useState([]);
    const [isFetchingProceedings, setIsFetchingProceedings] = useState(false);
    const receiptRef = useRef();
    const searchInputRef = useRef(null);

    // --- PERMISSIONS ---
    const user = JSON.parse(localStorage.getItem('user'));
    const isSuperAdmin = user?.role === 'superadmin';
    const permissions = user?.permissions || [];
    const canCollectFee = permissions.includes('fee_collection_pay');
    const canEditTransactionDate = isSuperAdmin || permissions.includes('fee_collection_edit');
    const canTransferFee = isSuperAdmin || permissions.includes('fee_collection_transfer');

    const [actionTab, setActionTab] = useState('collect'); // 'collect' or 'transfer'

    useEffect(() => {
        if (!canCollectFee && !isSuperAdmin && canTransferFee) {
            setActionTab('transfer');
        }
    }, [canCollectFee, isSuperAdmin, canTransferFee]);
    const [transferForm, setTransferForm] = useState({
        sourceTxId: '',
        amount: '',
        sourceFeeHeadName: '',
        remarks: ''
    });

    const [transferRows, setTransferRows] = useState([
        { id: Date.now(), targetFeeHeadId: '', studentYear: '', semester: 'All', amount: '', targetFeeId: '' }
    ]);

    const addTransferRow = () => {
        setTransferRows(prev => [
            ...prev,
            { id: Date.now() + Math.random(), targetFeeHeadId: '', studentYear: '', semester: 'All', amount: '', targetFeeId: '' }
        ]);
    };

    const removeTransferRow = (id) => {
        setTransferRows(prev => prev.filter(r => r.id !== id));
    };

    const updateTransferRow = (id, field, value) => {
        setTransferRows(prev => prev.map(r => {
            if (r.id === id) {
                const updated = { ...r, [field]: value };
                if (field === 'targetFeeId') {
                    // Match displayedFee details
                    const matched = feeDetails.find(f => f._id === value);
                    if (matched) {
                        updated.targetFeeHeadId = matched.feeHeadId;
                        updated.studentYear = matched.studentYear;
                        updated.semester = matched.semester || 'All';
                    } else {
                        // Could be global fee head
                        updated.targetFeeHeadId = value;
                        updated.studentYear = '';
                        updated.semester = 'All';
                    }
                }
                return updated;
            }
            return r;
        }));
    };

    // Reactive paymentAccess — updated after /users/me fetch so the UI re-renders
    const [paymentAccess, setPaymentAccess] = useState(() => {
        const u = JSON.parse(localStorage.getItem('user'));
        return u?.paymentAccess || {};
    });
    // Master kill-switch set by admin on a per-user basis
    const isFeeCollectionDisabled = paymentAccess?.feeCollectionDisabled === true;

    // --- EFFECTIVE PAYMENT METHOD AVAILABILITY ---
    // Merges global settings with per-user overrides stored in localStorage.
    // If user has a non-null override, it takes precedence over the global setting.
    const effectivePaymentAccess = (settingKey) => {
        if (!receiptSettings) return true; // default allow while loading
        const pa = paymentAccess;
        if (pa && pa[settingKey] !== null && pa[settingKey] !== undefined) {
            return pa[settingKey] === true;
        }
        return receiptSettings[settingKey] !== false;
    };

    // --- INITIAL DATA LOADING ---
    useEffect(() => {
        let cancelled = false;

        const fetchInitialData = async () => {
            const { queryString, cacheKey } = buildStudentsQueryKey();
            const cached = getFeeCollectionCache(cacheKey);

            // Hydrate instantly from SPA-session cache (no full students reload)
            if (cached) {
                setAllStudents(cached.students);
                setPaymentConfigs((cached.paymentConfigs || []).filter(c => c.is_active !== false));
                setReceiptSettings(cached.receiptSettings);
                setGlobalFeeHeads(cached.feeHeads || []);
                setLoading(false);

                // Refresh only lightweight / frequently changing data
                try {
                    const [recentRes, meRes, settingsRes] = await Promise.all([
                        api.get(`/transactions/recent`),
                        api.get(`/users/me`),
                        api.get(`/settings`)
                    ]);
                    if (cancelled) return;
                    setRecentTransactions(recentRes.data || []);
                    setReceiptSettings(settingsRes.data);
                    if (meRes.data?.paymentAccess !== undefined) {
                        const storedUser = JSON.parse(localStorage.getItem('user')) || {};
                        localStorage.setItem('user', JSON.stringify({ ...storedUser, paymentAccess: meRes.data.paymentAccess }));
                        setPaymentAccess(meRes.data.paymentAccess);
                    }
                    setFeeCollectionCache(cacheKey, {
                        students: cached.students,
                        paymentConfigs: cached.paymentConfigs,
                        receiptSettings: settingsRes.data,
                        feeHeads: cached.feeHeads
                    });
                } catch (e) {
                    console.error('Error refreshing Fee Collection light data', e);
                }
                return;
            }

            setLoading(true);
            try {
                const data = await getOrCreateFeeCollectionFetch(cacheKey, async () => {
                    const [studentsRes, configsRes, settingsRes, feeHeadsRes, recentRes, meRes] = await Promise.all([
                        api.get(`/students${queryString}`),
                        api.get(`/payment-config`),
                        api.get(`/settings`),
                        api.get(`/fee-heads`),
                        api.get(`/transactions/recent`),
                        api.get(`/users/me`),
                    ]);
                    return {
                        students: studentsRes.data,
                        paymentConfigs: configsRes.data,
                        receiptSettings: settingsRes.data,
                        feeHeads: feeHeadsRes.data,
                        recentTransactions: recentRes.data || [],
                        me: meRes.data
                    };
                });
                if (cancelled) return;

                if (data.me?.paymentAccess !== undefined) {
                    const storedUser = JSON.parse(localStorage.getItem('user')) || {};
                    localStorage.setItem('user', JSON.stringify({ ...storedUser, paymentAccess: data.me.paymentAccess }));
                    setPaymentAccess(data.me.paymentAccess);
                }

                const activeConfigs = (data.paymentConfigs || []).filter(c => c.is_active);
                setAllStudents(data.students);
                setPaymentConfigs(activeConfigs);
                setReceiptSettings(data.receiptSettings);
                setGlobalFeeHeads(data.feeHeads);
                setRecentTransactions(data.recentTransactions || []);
            } catch (e) {
                console.error("Error fetching initial data", e);
                if (!cancelled) setError("Failed to load data. Please refresh.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        fetchInitialData();
        return () => { cancelled = true; };
    }, []);

    // --- CLIENT-SIDE FILTERING (@Students.jsx style) ---
    const filteredStudents = useMemo(() => {
        if (!searchQuery) return [];
        const query = searchQuery.toLowerCase().trim();
        const cleanQuery = query.replace(/[^a-z0-9]/g, '');

        return allStudents.filter(s => {
            const admNum = s.admission_number ? String(s.admission_number).toLowerCase().trim() : '';
            const admNo = s.admission_no ? String(s.admission_no).toLowerCase().trim() : ''; // Handle both keys
            const mobile = s.student_mobile ? String(s.student_mobile).toLowerCase().trim() : '';
            const pin = s.pin_no ? String(s.pin_no).toLowerCase().trim() : '';
            const name = s.student_name ? s.student_name.toLowerCase().trim() : '';

            const cleanAdmNum = admNum.replace(/[^a-z0-9]/g, '');
            const cleanAdmNo = admNo.replace(/[^a-z0-9]/g, '');
            const cleanPin = pin.replace(/[^a-z0-9]/g, '');

            return (
                admNum.includes(query) ||
                admNo.includes(query) ||
                mobile.includes(query) ||
                pin.includes(query) ||
                name.includes(query) ||
                (cleanQuery.length > 0 && cleanAdmNum.includes(cleanQuery)) ||
                (cleanQuery.length > 0 && cleanAdmNo.includes(cleanQuery)) ||
                (cleanQuery.length > 0 && cleanPin.includes(cleanQuery))
            );
        });
    }, [allStudents, searchQuery]);

    // Fetch Proceedings for RTF
    useEffect(() => {
        const fetchRTFProceedings = async () => {
            if (paymentCategory === 'Bank' && paymentForm.paymentMode === 'RTF' && student) {
                setIsFetchingProceedings(true);
                try {
                    const res = await api.get(`/proceedings`, {
                        params: {
                            college: student.college,
                            course: student.course,
                            batch: student.academic_year, // Map to batch
                            caste: student.caste,
                            status: 'Active',
                            studentId: student.admission_number
                        },
                    });
                    setAvailableProceedings(res.data);
                } catch (e) {
                    console.error("Failed to fetch proceedings", e);
                } finally {
                    setIsFetchingProceedings(false);
                }
            } else {
                setAvailableProceedings([]);
                setPaymentForm(prev => ({ ...prev, proceedingId: '' }));
                setSelectedProceeding(null);
            }
        };
        fetchRTFProceedings();
    }, [paymentCategory, paymentForm.paymentMode, student]);

    // Filter Payment Configs (Bank Accounts) by selected student's Course & College
    const relevantConfigs = useMemo(() => {
        if (!student) return [];
        return paymentConfigs.filter(c => 
            c.college === student.college && 
            c.course === student.course
        );
    }, [paymentConfigs, student]);

    const resolveConfigForProceeding = useCallback((proc) => {
        if (!proc?.bankAccount) return null;
        const accountName = String(proc.bankAccount).trim().toLowerCase();
        return paymentConfigs.find(c => String(c.account_name || '').trim().toLowerCase() === accountName)
            || relevantConfigs.find(c => String(c.account_name || '').trim().toLowerCase() === accountName);
    }, [relevantConfigs, paymentConfigs]);

    /** Bank config for submit: proceeding account for RTF, else form selection. */
    const resolvePaymentBankConfig = useCallback(() => {
        if (paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId) {
            const proc = availableProceedings.find(p => p._id === paymentForm.proceedingId);
            const config = proc ? resolveConfigForProceeding(proc) : null;
            if (config) return config;
        }
        return paymentConfigs.find(c => c._id === paymentForm.paymentConfigId) || null;
    }, [paymentForm.paymentMode, paymentForm.proceedingId, paymentForm.paymentConfigId, availableProceedings, paymentConfigs, resolveConfigForProceeding]);

    const applyProceedingBankToForm = useCallback((prev, proceedingId) => {
        if (!proceedingId) {
            return { ...prev, proceedingId: '', paymentConfigId: '', bankName: '' };
        }
        const proc = availableProceedings.find(p => p._id === proceedingId);
        const config = proc ? resolveConfigForProceeding(proc) : null;
        return {
            ...prev,
            proceedingId,
            paymentConfigId: config?._id || '',
            bankName: config?.bank_name || '',
            referenceNo: proc?.proceedingNumber || prev.referenceNo || ''
        };
    }, [availableProceedings, resolveConfigForProceeding]);

    const handleProceedingSelect = (proceedingId) => {
        setPaymentForm(prev => applyProceedingBankToForm(prev, proceedingId));
    };

    useEffect(() => {
        if (paymentForm.paymentMode !== 'RTF' || !paymentForm.proceedingId) return;
        const proc = availableProceedings.find(p => p._id === paymentForm.proceedingId);
        if (!proc?.bankAccount) return;
        const config = resolveConfigForProceeding(proc);
        if (!config || paymentForm.paymentConfigId === config._id) return;
        setPaymentForm(prev => ({
            ...prev,
            paymentConfigId: config._id,
            bankName: config.bank_name || prev.bankName,
            referenceNo: proc.proceedingNumber || prev.referenceNo || ''
        }));
    }, [paymentForm.paymentMode, paymentForm.proceedingId, paymentForm.paymentConfigId, availableProceedings, resolveConfigForProceeding]);

    const isRtfShareLocked = useMemo(() => {
        if (paymentForm.paymentMode !== 'RTF' || !paymentForm.proceedingId || isEditMode) return false;
        const proc = availableProceedings.find(p => p._id === paymentForm.proceedingId);
        return Boolean(proc && proc.studentCount && proc.studentCount > 0);
    }, [paymentForm.paymentMode, paymentForm.proceedingId, isEditMode, availableProceedings]);

    const getRtfProceedingProc = useCallback(() => {
        if (paymentForm.paymentMode !== 'RTF' || !paymentForm.proceedingId) return null;
        return availableProceedings.find(p => p._id === paymentForm.proceedingId) || null;
    }, [paymentForm.paymentMode, paymentForm.proceedingId, availableProceedings]);

    const getRtfShareAmountForRow = useCallback((feeHeadId, proc = getRtfProceedingProc()) => {
        if (!proc) return '';
        const isMapped = Boolean(proc.studentCount && proc.studentCount > 0);
        const existingTxAmount = (isEditMode && editingTransaction && editingTransaction.proceedingId === proc._id)
            ? Number(editingTransaction.amount) : 0;
        const shareRem = isMapped
            ? Math.max(0, (proc.shareRemaining ?? proc.studentShare ?? 0) + existingTxAmount)
            : Math.max(0, (proc.amount || 0) - (proc.totalUsed || 0) + existingTxAmount);
        if (!(shareRem > 0)) return '';
        if (!feeHeadId) return String(Math.round(shareRem * 100) / 100);
        const selectedFee = feeDetails.find(f => f._id === feeHeadId);
        const due = selectedFee ? (Number(selectedFee.dueAmount) || 0) : shareRem;
        return String(Math.round(Math.min(shareRem, due) * 100) / 100);
    }, [feeDetails, getRtfProceedingProc, isEditMode, editingTransaction]);

    const syncRtfShareToFeeRows = useCallback(() => {
        const proc = getRtfProceedingProc();
        if (!proc || isEditMode) return;
        setFeeRows(prev => {
            const base = prev.length > 1 ? [prev[0]] : prev;
            return base.map(row => ({
                ...row,
                amount: getRtfShareAmountForRow(row.feeHeadId, proc)
            }));
        });
    }, [getRtfProceedingProc, getRtfShareAmountForRow, isEditMode]);

    useEffect(() => {
        if (paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId && !isEditMode) {
            syncRtfShareToFeeRows();
        }
    }, [
        paymentForm.paymentMode,
        paymentForm.proceedingId,
        availableProceedings,
        feeDetails,
        isEditMode,
        syncRtfShareToFeeRows
    ]);


    // Print Handler
    const handlePrintReceipt = async () => {
        if (!lastTransaction) return;
        try {
            const response = await api.post('/print', {
                template: 'fee-receipt',
                data: {
                    receiptId: lastTransaction._id
                }
            });
            printHtmlDocument(response.data);
            setShowReceiptModal(false);
        } catch (err) {
            console.error('Print failed:', err);
            alert('Failed to generate print document');
        }
    };

    const handlePrintStatement = async () => {
        if (!student) return;
        setIsPrintingStatement(true);
        try {
            const response = await api.post('/print', {
                template: 'student-statement',
                data: {
                    student,
                    feeDetails,
                    transactions
                }
            });
            printHtmlDocument(response.data);
        } catch (err) {
            console.error('Failed to print statement:', err);
            showToastMessage('Failed to print statement', 'error');
        } finally {
            setIsPrintingStatement(false);
        }
    };

    // Helper: Fetch Student Data (Avoids UI flicker/reset)
    const fetchStudentData = async (selectedStudent) => {
        setIsDashLoading(true);
        const admissionNo = selectedStudent.admission_number;
        try {
            // Parallel: student (no photo) + fee dues + history — was sequential waterfall before
            const [fullStudentRes, feesRes, histRes] = await Promise.all([
                api.get(`/students/${admissionNo}`),
                api.get(`/fee-structures/student/${admissionNo}`, {
                    params: {
                        college: selectedStudent.college,
                        course: selectedStudent.course,
                        branch: selectedStudent.branch,
                        studentYear: selectedStudent.current_year,
                    },
                }),
                api.get(`/transactions/student/${admissionNo}`),
            ]);

            const found = fullStudentRes.data;
            setFeeDetails(feesRes.data);
            setViewFilterYear(String(found.current_year || selectedStudent.current_year || 1));
            setViewFilterStatus('ACTIVE');
            setTransactions(histRes.data);
            setStudent(found);

            // Defer heavy student_photo LONGTEXT so dashboard is usable first
            api.get(`/students/${admissionNo}`, { params: { photoOnly: 1 } })
                .then((photoRes) => {
                    const photo = photoRes.data?.student_photo;
                    if (!photo) return;
                    setStudent((prev) => (
                        prev && String(prev.admission_number) === String(admissionNo)
                            ? { ...prev, student_photo: photo }
                            : prev
                    ));
                })
                .catch(() => {});
        } catch (error) {
            console.error(error);
            setError('Error refreshing student details.');
        } finally {
            setIsDashLoading(false);
        }
    };

    const syncStudentFees = async () => {
        if (!student?.admission_number || isSyncingFees) return;
        setIsSyncingFees(true);
        try {
            const { data } = await api.post(`/students/${student.admission_number}/sync-fees`);
            await fetchStudentData(student);
            const created = (data.standardFeesCreated || 0)
                + (data.clubFeesCreated || 0)
                + (data.transportFeesCreated || 0)
                + (data.hostelFeesCreated || 0);
            const updated = (data.standardFeesUpdated || 0)
                + (data.transportFeesUpdated || 0)
                + (data.hostelFeesUpdated || 0);
            const matched = (data.structuresMatched || 0)
                + (data.transportRequestsMatched || 0)
                + (data.hostelRequestsMatched || 0);

            const detailParts = [];
            if ((data.structuresMatched || 0) > 0) {
                detailParts.push(`Structures: ${data.structuresMatched}`);
            }
            if ((data.transportRequestsMatched || 0) > 0) {
                const years = (data.transportAcademicYears || []).join(', ') || '—';
                detailParts.push(`Transport: ${data.transportRequestsMatched} req (${years})`);
            }
            if ((data.hostelRequestsMatched || 0) > 0) {
                const years = (data.hostelAcademicYears || []).join(', ') || '—';
                detailParts.push(`Hostel: ${data.hostelRequestsMatched} req (${years})`);
            }
            const details = detailParts.length ? ` — ${detailParts.join(' · ')}` : '';

            if (created === 0 && updated === 0) {
                showToastMessage(
                    `Fees already in sync (${matched} structure/request(s) matched)${details}.`,
                    'success'
                );
            } else {
                showToastMessage(
                    `Synced: ${created} created, ${updated} updated (${matched} structure/request(s))${details}.`,
                    'success'
                );
            }
        } catch (err) {
            console.error(err);
            showToastMessage(err.response?.data?.message || 'Failed to sync student fees.', 'error');
        } finally {
            setIsSyncingFees(false);
        }
    };

    const toggleFeeRowExpand = (feeId, e) => {
        e.stopPropagation();
        setExpandedFeeRows(prev => {
            const next = new Set(prev);
            if (next.has(feeId)) next.delete(feeId);
            else next.add(feeId);
            return next;
        });
    };

    const selectStudent = async (selectedStudent) => {
        setSearchQuery(''); // Clear search on select to show student details
        setFeeDetails([]); // Clear previous student's fees
        setTransactions([]); // Clear previous student's transactions
        setStudent(selectedStudent);
        setIsEditMode(false);
        setEditingTransaction(null);
        setFeeRows([{ id: Date.now(), feeHeadId: '', amount: '' }]); // Reset selected fee heads & amounts
        setPaymentForm(prev => ({ 
            ...prev, 
            paymentMode: 'Cash',
            remarks: '',
            bankName: '',
            instrumentDate: '',
            referenceNo: '',
            referenceDate: '',
            paymentConfigId: '',
            proceedingId: '',
            paymentDate: new Date().toLocaleDateString('en-CA')
        })); // Reset form
        setPaymentCategory('Cash');
        setPerRowSplitCash({});
        setSelectedProceeding(null);
        setExpandedFeeRows(new Set());
        setViewFilterStatus('ACTIVE');
        await fetchStudentData(selectedStudent);
    };

    const handleActionOnRecentTransaction = async (tx) => {
        const matchingStudent = allStudents.find(s => String(s.admission_number).trim() === String(tx.studentId).trim());
        if (matchingStudent) {
            selectStudent(matchingStudent);
        } else {
            try {
                const res = await api.get(`/students?admission_number=${tx.studentId}`);
                if (res.data && res.data.length > 0) {
                    selectStudent(res.data[0]);
                }
            } catch (e) {
                console.error("Failed to load student for recent transaction", e);
            }
        }
    };

    const handlePrintRecentReceipt = async (tx) => {
        setLoading(true);
        try {
            let studentData = allStudents.find(s => String(s.admission_number).trim() === String(tx.studentId).trim());
            if (!studentData) {
                const res = await api.get(`/students?admission_number=${tx.studentId}`);
                if (res.data && res.data.length > 0) {
                    studentData = res.data[0];
                }
            }
            
            const relRes = await api.get(`/transactions/student/${tx.studentId}`);
            const related = relRes.data || [];
            
            setLastTransaction(tx);
            const siblingTxns = related.filter(t => t.receiptNumber === tx.receiptNumber);
            const activeSiblings = siblingTxns.filter(t => t.status !== 'transferred');
            setRelatedTransactions(activeSiblings.length > 0 ? activeSiblings : siblingTxns);
            if (studentData) {
                setStudent(studentData);
                setTimeout(() => {
                    setShowReceiptModal(true);
                }, 150);
            }
        } catch (e) {
            console.error("Error preparing print for recent transaction", e);
            showToastMessage("Error preparing receipt print", "error");
        } finally {
            setLoading(false);
        }
    };

    // --- EDIT TRANSACTION LOGIC ---
    const handleEditTransaction = (tx) => {
        setIsEditMode(true);
        setEditingTransaction(tx);

        // Find matching fee structure row _id or fallback to feeHead _id
        const matchedFee = feeDetails.find(f => f.feeHeadId === (tx.feeHead?._id || tx.feeHead));
        const prefillValue = matchedFee ? matchedFee._id : (tx.feeHead?._id || tx.feeHead);

        setFeeRows([{ id: Date.now(), feeHeadId: prefillValue, amount: String(tx.amount) }]);

        const category = tx.paymentMode === 'Cash' ? 'Cash' : 'Bank';
        setPaymentCategory(category);

        setPaymentForm({
            paymentMode: tx.paymentMode || 'Cash',
            remarks: tx.remarks || '',
            bankName: tx.bankName || '',
            instrumentDate: tx.instrumentDate ? tx.instrumentDate.split('T')[0] : '',
            referenceNo: tx.referenceNo || '',
            referenceDate: tx.referenceDate ? tx.referenceDate.split('T')[0] : '',
            paymentConfigId: tx.paymentConfigId || '',
            proceedingId: tx.proceedingId || '',
            paymentDate: (tx.paymentDate || tx.createdAt)
                ? String(tx.paymentDate || tx.createdAt).split('T')[0]
                : new Date().toLocaleDateString('en-CA')
        });

        // Scroll to the fee collection form
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEditMode = () => {
        setIsEditMode(false);
        setEditingTransaction(null);
        setFeeRows([{ id: Date.now(), feeHeadId: '', amount: '' }]);
        setPaymentCategory('Cash');
        setPerRowSplitCash({});
        setPaymentForm({
            paymentMode: 'Cash',
            remarks: '',
            bankName: '',
            instrumentDate: '',
            referenceNo: '',
            referenceDate: '',
            paymentConfigId: '',
            proceedingId: '',
            paymentDate: new Date().toLocaleDateString('en-CA')
        });
    };

    // --- DELETE / CANCEL TRANSACTION LOGIC ---
    const handleDeleteTransaction = (tx) => {
        setTxToDelete(tx);
        setCancelReason('');
        setShowDeleteModal(true);
    };

    const confirmDeleteTransaction = async () => {
        if (!txToDelete) return;
        setIsDeleting(true);
        try {
            // Cancel the transaction (preserve record, keep receipt sequence intact)
            const res = await api.put(`/transactions/${txToDelete._id}/cancel`, {
                cancellationReason: cancelReason || 'Cancelled by user'
            });
            // Update the transaction in-place so UI reflects cancelled status
            setTransactions(prev =>
                prev.map(t => t._id === txToDelete._id ? { ...t, status: 'cancelled', cancelledAt: res.data.transaction?.cancelledAt } : t)
            );
            showToastMessage('Transaction cancelled successfully.', 'success');
            setShowDeleteModal(false);
            setTxToDelete(null);
        } catch (err) {
            showToastMessage(err.response?.data?.message || 'Failed to process transaction.', 'error');
        }
        setIsDeleting(false);
    };

    // --- Dynamic Row Handlers ---
    const addFeeRow = () => {
        setFeeRows([...feeRows, { id: Date.now(), feeHeadId: '', amount: '' }]);
    };

    const removeFeeRow = (id) => {
        if (feeRows.length === 1) return; // Don't remove the last row
        setFeeRows(feeRows.filter(row => row.id !== id));
    };

    const updateFeeRow = (id, field, value) => {
        const newRows = feeRows.map(row => {
            if (row.id === id) {
                const updatedRow = { ...row, [field]: value };
                if (field === 'feeHeadId') {
                    if (isRtfShareLocked) {
                        updatedRow.amount = getRtfShareAmountForRow(value);
                    } else {
                        updatedRow.amount = '';
                    }
                }
                return updatedRow;
            }
            return row;
        });
        setFeeRows(newRows);
    };

    const toggleFeeSelection = (fee) => {
        const isSelected = feeRows.some(row => row.feeHeadId === fee._id);

        if (isSelected) {
            // Remove it
            const newRows = feeRows.filter(row => row.feeHeadId !== fee._id);
            // Ensure at least one row exists
            if (newRows.length === 0) {
                setFeeRows([{ id: Date.now(), feeHeadId: '', amount: '' }]);
            } else {
                setFeeRows(newRows);
            }
        } else {
            // Check if first row is empty
            const firstRowEmpty = feeRows.length === 1 && !feeRows[0].feeHeadId && !feeRows[0].amount;
            const newRow = {
                id: Date.now(),
                feeHeadId: fee._id,
                amount: isRtfShareLocked ? getRtfShareAmountForRow(fee._id) : ''
            };

            if (firstRowEmpty) {
                setFeeRows([newRow]);
            } else {
                setFeeRows([...feeRows, newRow]);
            }
        }
    };

    const getExcessPaymentError = () => {
        const validRows = feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0);
        for (const row of validRows) {
            const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
            if (selectedFee) {
                const due = Number(selectedFee.dueAmount) || 0;
                const entered = Number(row.amount);
                if (entered > due && !receiptSettings?.excessFeeHead) {
                    return `Amount entered for ${selectedFee.feeHeadName} (₹${entered.toLocaleString('en-IN')}) exceeds the remaining due demand of ₹${due.toLocaleString('en-IN')}. Please adjust or select an Excess Fee Head in Settings to allow excess payments.`;
                }
            }
        }
        return null;
    };

    const getExcessPaymentInfo = () => {
        const excessFeeHeadId = receiptSettings?.excessFeeHead;
        if (!excessFeeHeadId) return null;

        const excessHead = globalFeeHeads.find(h => h._id === excessFeeHeadId);
        const excessHeadName = excessHead ? `${excessHead.name}${excessHead.code ? ` (${excessHead.code})` : ''}` : 'Configured Excess Head';

        const validRows = feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0);
        let totalSurplus = 0;
        let details = [];

        for (const row of validRows) {
            const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
            if (selectedFee) {
                const due = Number(selectedFee.dueAmount) || 0;
                const entered = Number(row.amount);
                if (entered > due) {
                    const surplus = entered - due;
                    totalSurplus += surplus;
                    details.push(`₹${surplus.toLocaleString('en-IN')} from ${selectedFee.feeHeadName}`);
                }
            }
        }
        if (totalSurplus > 0) {
            return `₹${totalSurplus.toLocaleString('en-IN')} will be added to ${excessHeadName} as excess payment (${details.join(', ')}).`;
        }
        return null;
    };

    const handleTransferFee = async (e) => {
        e.preventDefault();
        if (!transferForm.sourceTxId || !transferForm.remarks.trim()) {
            showToastMessage('Please select a source transaction and enter remarks.', 'error');
            return;
        }

        const sourceTx = transactions.find(t => t._id === transferForm.sourceTxId);
        if (!sourceTx) {
            showToastMessage('Selected source transaction not found.', 'error');
            return;
        }

        const sourceFeeHeadId = String(sourceTx.feeHead?._id || sourceTx.feeHead || '');
        const sourceFeeHeadName = (sourceTx.feeHeadName || sourceTx.feeHead?.name || '').toLowerCase();
        const configuredExcessHeadId = String(receiptSettings?.excessFeeHead || '');
        const isSourceExcess = (configuredExcessHeadId && sourceFeeHeadId === configuredExcessHeadId) || sourceFeeHeadName.includes('excess');

        // Validate each row
        for (const row of transferRows) {
            if (!row.targetFeeHeadId) {
                showToastMessage('Please select target fee head for all rows.', 'error');
                return;
            }
            if (!row.studentYear) {
                showToastMessage('Please select a student year for all rows.', 'error');
                return;
            }
            if (!row.amount || Number(row.amount) <= 0) {
                showToastMessage('Please enter a valid amount greater than 0 for all rows.', 'error');
                return;
            }

            const isSameHead = sourceFeeHeadId === String(row.targetFeeHeadId);
            const isSameYear = String(sourceTx.studentYear || '') === String(row.studentYear || '');
            const isSameSem  = String(sourceTx.semester || 'All') === String(row.semester || 'All');

            if (isSameHead && isSameYear && isSameSem) {
                showToastMessage(`Cannot transfer to the exact same fee head in the same year and semester.`, 'error');
                return;
            }


        }

        const totalRowAmount = transferRows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
        if (Math.abs(totalRowAmount - Number(transferForm.amount)) > 0.01) {
            showToastMessage(`Total split amount (₹${totalRowAmount.toLocaleString('en-IN')}) must exactly match the source transaction amount (₹${Number(transferForm.amount).toLocaleString('en-IN')}).`, 'error');
            return;
        }

        const confirmTransfer = window.confirm(
            `Are you sure you want to execute this ledger transfer for ₹${Number(transferForm.amount).toLocaleString('en-IN')} divided into ${transferRows.length} target head(s)?`
        );
        
        if (!confirmTransfer) return;

        setIsProcessing(true);
        try {
            const res = await api.post(`/transactions/${transferForm.sourceTxId}/transfer`, {
                targets: transferRows.map(r => ({
                    targetFeeHeadId: r.targetFeeHeadId,
                    studentYear: r.studentYear,
                    semester: r.semester || 'All',
                    amount: Number(r.amount)
                })),
                remarks: transferForm.remarks
            });

            showToastMessage('Payment transferred successfully!', 'success');
            setTransferForm({
                sourceTxId: '',
                amount: '',
                sourceFeeHeadName: '',
                remarks: ''
            });
            setTransferRows([
                { id: Date.now(), targetFeeHeadId: '', studentYear: '', semester: 'All', amount: '', targetFeeId: '' }
            ]);

            if (res.data?.targetTransactions && res.data.targetTransactions.length > 0) {
                setLastTransaction(res.data.targetTransactions[0]);
                setRelatedTransactions(res.data.targetTransactions);
                setShowReceiptModal(true);
            }

            // Refresh student data
            await fetchStudentData(student);
        } catch (err) {
            console.error('Transfer failed:', err);
            showToastMessage(err.response?.data?.message || 'Failed to complete ledger transfer.', 'error');
        } finally {
            setIsProcessing(false);
        }
    };
    // ----------------------------

    // Step 1: Trigger Confirmation
    const handlePrePayment = async (e) => {
        e.preventDefault();

        // Validation
        const validRows = feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0);
        if (validRows.length === 0) {
            showToastMessage('Please select at least one Fee Head and enter a valid amount (0 is accepted).', 'error');
            return;
        }

        if (getExcessPaymentError()) {
            return;
        }

        if (paymentCategory === 'Cash' && !effectivePaymentAccess('enableCashPayment')) {
            showToastMessage('Cash payments are currently disabled.', 'error');
            return;
        }
        if (paymentCategory === 'Bank' && !effectivePaymentAccess('enableBankPayment')) {
            showToastMessage('Bank payments are currently disabled.', 'error');
            return;
        }
        if (paymentCategory === 'Split' && !effectivePaymentAccess('enableSplitPayment')) {
            showToastMessage('Split payments are currently disabled.', 'error');
            return;
        }

        if (paymentCategory === 'Bank' || paymentCategory === 'Split') {
            const isRtfProceedingPay = paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId;
            const selectedProcForBank = isRtfProceedingPay
                ? availableProceedings.find(p => p._id === paymentForm.proceedingId)
                : null;
            const proceedingBankConfig = selectedProcForBank
                ? resolveConfigForProceeding(selectedProcForBank)
                : null;

            if (paymentForm.paymentMode === 'RTF') {
                if (!paymentForm.proceedingId) {
                    showToastMessage('Please select a proceeding for RTF payment.', 'error');
                    return;
                }
                if (!selectedProcForBank) {
                    showToastMessage('Selected proceeding is invalid or not found.', 'error');
                    return;
                }
                if (!proceedingBankConfig) {
                    showToastMessage(`Proceeding bank account "${selectedProcForBank.bankAccount || '—'}" is not configured in Payment Settings.`, 'error');
                    return;
                }
            } else {
                if (relevantConfigs.length === 0) {
                    showToastMessage("No bank accounts are linked to this student's college and course. Cannot process bank payment.", 'error');
                    return;
                }
                if (!paymentForm.paymentConfigId) {
                    showToastMessage('Please select a target account.', 'error');
                    return;
                }
                const configExists = relevantConfigs.some(c => c._id === paymentForm.paymentConfigId);
                if (!configExists) {
                    showToastMessage('Selected target account is invalid for this student.', 'error');
                    return;
                }
            }

            if (paymentForm.paymentMode === 'RTF') {
                const selectedProc = selectedProcForBank;

                const isMappedProc = Boolean(selectedProc.studentCount && selectedProc.studentCount > 0);
                const existingTxAmount = (isEditMode && editingTransaction && editingTransaction.proceedingId === selectedProc._id) ? Number(editingTransaction.amount) : 0;
                const procRem = (selectedProc.amount || 0) - (selectedProc.totalUsed || 0) + existingTxAmount;
                const shareRem = isMappedProc
                    ? ((selectedProc.shareRemaining ?? selectedProc.studentShare ?? 0) + existingTxAmount)
                    : procRem;

                if (procRem <= 0) {
                    showToastMessage(`Selected proceeding '${selectedProc.proceedingNumber}' has been exhausted (₹0 remaining balance).`, 'error');
                    return;
                }
                if (isMappedProc && shareRem <= 0) {
                    showToastMessage(`Your fixed share in proceeding '${selectedProc.proceedingNumber}' is fully utilized.`, 'error');
                    return;
                }

                let rtfPayAmount = 0;
                if (paymentCategory === 'Bank') {
                    rtfPayAmount = validRows.reduce((sum, r) => sum + Number(r.amount), 0);
                } else if (paymentCategory === 'Split') {
                    rtfPayAmount = validRows.reduce((sum, r) => {
                        const rowTotal = Number(r.amount);
                        const cashVal = Number(perRowSplitCash[r.id]) || 0;
                        return sum + Math.max(0, rowTotal - cashVal);
                    }, 0);
                }

                if (rtfPayAmount <= 0) {
                    showToastMessage('Please enter a valid payment amount for RTF collection.', 'error');
                    return;
                }

                const maxRtfAllowed = isMappedProc ? Math.min(procRem, shareRem) : procRem;
                if (rtfPayAmount > maxRtfAllowed) {
                    if (isMappedProc && rtfPayAmount > shareRem) {
                        showToastMessage(`RTF amount ₹${fmtAmount(rtfPayAmount)} exceeds your remaining proceeding share of ₹${fmtAmount(shareRem)} (fixed share ₹${fmtAmount(selectedProc.studentShare || 0)}).`, 'error');
                    } else {
                        showToastMessage(`Selected proceeding '${selectedProc.proceedingNumber}' only has ₹${fmtAmount(procRem)} remaining balance, but requested RTF amount is ₹${fmtAmount(rtfPayAmount)}.`, 'error');
                    }
                    return;
                }

                // Per-row: amount must not exceed selected fee head due (except for RTF payments)
                for (const row of validRows) {
                    const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
                    if (!selectedFee) continue;
                    const due = Number(selectedFee.dueAmount) || 0;
                    const rowAmt = Number(row.amount) || 0;
                    if (paymentForm.paymentMode !== 'RTF' && rowAmt > due + 0.009 && !receiptSettings?.excessFeeHead) {
                        showToastMessage(`Amount for ${selectedFee.feeHeadName} (₹${fmtAmount(rowAmt)}) exceeds remaining demand (₹${fmtAmount(due)}).`, 'error');
                        return;
                    }
                }
            }
        }

        if (isEditMode) {
            setShowConfirmModal(true);
            return;
        }

        setSequencePreview(null);
        setPreviewLoading(true);
        setShowConfirmModal(true);

        try {
            const feeHeadIdsSet = new Set();
            validRows.forEach(row => {
                const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
                const rowTotal = Number(row.amount);
                const due = selectedFee ? (Number(selectedFee.dueAmount) || 0) : Infinity;
                
                feeHeadIdsSet.add(selectedFee ? selectedFee.feeHeadId : row.feeHeadId);
                if (selectedFee && rowTotal > due && receiptSettings?.excessFeeHead) {
                    feeHeadIdsSet.add(receiptSettings.excessFeeHead);
                }
            });
            const feeHeadIds = Array.from(feeHeadIdsSet);

            const res = await api.post('/transactions/preview-sequence', {
                studentId: student.admission_number,
                feeHeadIds
            });
            setSequencePreview(res.data);
        } catch (err) {
            console.error("Failed to fetch sequence preview", err);
        } finally {
            setPreviewLoading(false);
        }
    };

    // Step 2: Actual Submission
    const confirmAndPay = async () => {
        setIsProcessing(true);
        try {
            if (isEditMode) {
                // Build Payload for Update
                const payload = {
                    paymentMode: paymentCategory === 'Cash' ? 'Cash' : paymentForm.paymentMode,
                    remarks: paymentForm.remarks
                };

                if (canEditTransactionDate && paymentForm.paymentDate) {
                    payload.paymentDate = paymentForm.paymentDate;
                }

                if (paymentCategory === 'Bank') {
                    const bankConfig = resolvePaymentBankConfig();
                    payload.instrumentDate = paymentForm.instrumentDate;
                    payload.referenceDate = paymentForm.referenceDate;
                    payload.paymentConfigId = bankConfig?._id || paymentForm.paymentConfigId;
                    if (bankConfig) {
                        payload.depositedToAccount = bankConfig.account_name;
                        payload.bankName = bankConfig.bank_name || paymentForm.bankName;
                    } else {
                        payload.bankName = paymentForm.bankName;
                        const selectedConfig = paymentConfigs.find(c => c._id === paymentForm.paymentConfigId);
                        if (selectedConfig) {
                            payload.depositedToAccount = selectedConfig.account_name;
                        }
                    }
                    payload.referenceNo = paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId
                        ? (paymentForm.referenceNo || availableProceedings.find(p => p._id === paymentForm.proceedingId)?.proceedingNumber || '')
                        : paymentForm.referenceNo;
                    if (paymentForm.paymentMode === 'RTF') {
                        payload.proceedingId = paymentForm.proceedingId;
                    }
                } else if (paymentCategory === 'Cash') {
                    payload.bankName = '';
                    payload.instrumentDate = '';
                    payload.referenceNo = '';
                    payload.referenceDate = '';
                    payload.paymentConfigId = '';
                    payload.depositedToAccount = '';
                    payload.proceedingId = '';
                }

                await api.put(`/transactions/${editingTransaction._id}`, payload);
                
                showToastMessage('Transaction payment details updated successfully!', 'success');
                setShowConfirmModal(false);
                cancelEditMode();
                await fetchStudentData(student);
                setIsProcessing(false);
                return;
            }

            const validRows = feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0);

            // Build Common Data
            const commonData = {
                studentId: student.admission_number,
                studentName: student.student_name,
                semester: student.current_semester,
                studentYear: viewFilterYear !== 'ALL' ? Number(viewFilterYear) : student.current_year,
                transactionType: 'DEBIT',
                remarks: paymentForm.remarks,
                paymentDate: paymentForm.paymentDate || new Date().toLocaleDateString('en-CA'),
                collectedBy: JSON.parse(localStorage.getItem('user'))?.username || 'Unknown',
                collectedByName: JSON.parse(localStorage.getItem('user'))?.name || 'Unknown'
            };

            // Payment Mode Details
            if (paymentCategory === 'Cash') {
                commonData.paymentMode = 'Cash';
            } else if (paymentCategory === 'Bank') {
                commonData.paymentMode = paymentForm.paymentMode;
                commonData.instrumentDate = paymentForm.instrumentDate;
                commonData.referenceDate = paymentForm.referenceDate;
                const bankConfig = resolvePaymentBankConfig();
                if (bankConfig) {
                    commonData.paymentConfigId = bankConfig._id;
                    commonData.depositedToAccount = bankConfig.account_name;
                    commonData.bankName = bankConfig.bank_name || paymentForm.bankName;
                } else {
                    commonData.paymentConfigId = paymentForm.paymentConfigId;
                    commonData.bankName = paymentForm.bankName;
                }
                commonData.referenceNo = paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId
                    ? (paymentForm.referenceNo || availableProceedings.find(p => p._id === paymentForm.proceedingId)?.proceedingNumber || '')
                    : paymentForm.referenceNo;
                if (paymentForm.paymentMode === 'RTF') {
                    commonData.proceedingId = paymentForm.proceedingId;
                }
            } else if (paymentCategory === 'Split') {
                // Split logic handled during batch mapping
            }

            // Create Batch Array
            let batchTransactions = [];
            const excessFeeHeadId = receiptSettings?.excessFeeHead;

            if (paymentCategory === 'Split') {
                // Validate per-row split entries
                const overflowRows = validRows.filter(row => {
                    const cash = Number(perRowSplitCash[row.id]) || 0;
                    return cash > Number(row.amount);
                });
                if (overflowRows.length > 0) {
                    showToastMessage("Cash amount exceeds fee amount in one or more rows. Please correct before proceeding.", 'error');
                    setIsProcessing(false);
                    return;
                }

                const totalCashEntered = validRows.reduce((sum, row) => sum + (Number(perRowSplitCash[row.id]) || 0), 0);
                const totalBankEntered = totalSelectedAmount - totalCashEntered;
                if (totalCashEntered <= 0 || totalBankEntered <= 0) {
                    showToastMessage("Each split must have both a Cash and Bank portion. Enter cash amounts for at least one fee head.", 'error');
                    setIsProcessing(false);
                    return;
                }

                validRows.forEach(row => {
                    const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
                    const rowTotal = Number(row.amount);
                    const rowCashAmount = Number(perRowSplitCash[row.id]) || 0;
                    const rowBankAmount = rowTotal - rowCashAmount;

                    const due = selectedFee ? (Number(selectedFee.dueAmount) || 0) : Infinity;
                    const isExcess = selectedFee && rowTotal > due;
                    const surplus = isExcess ? (rowTotal - due) : 0;

                    let targetCash = rowCashAmount;
                    let targetBank = rowBankAmount;
                    let excessCash = 0;
                    let excessBank = 0;

                    if (isExcess && excessFeeHeadId) {
                        excessCash = Math.min(surplus, rowCashAmount);
                        excessBank = surplus - excessCash;
                        targetCash = rowCashAmount - excessCash;
                        targetBank = rowBankAmount - excessBank;
                    }

                    const baseData = {
                        ...commonData,
                        feeHeadId: selectedFee ? selectedFee.feeHeadId : row.feeHeadId,
                        studentYear: selectedFee ? selectedFee.studentYear : commonData.studentYear,
                        semester: selectedFee ? selectedFee.semester : commonData.semester,
                        remarks: commonData.remarks
                            ? ((selectedFee && selectedFee.remarks) ? `${selectedFee.remarks} - ${commonData.remarks}` : commonData.remarks)
                            : ((selectedFee && selectedFee.remarks) ? selectedFee.remarks : '')
                    };

                    const excessBaseData = (isExcess && excessFeeHeadId) ? {
                        ...commonData,
                        feeHeadId: excessFeeHeadId,
                        remarks: commonData.remarks ? `Excess Payment - ${commonData.remarks}` : 'Excess Payment'
                    } : null;

                    // Push Target Cash transaction if > 0
                    if (targetCash > 0) {
                        batchTransactions.push({
                            ...baseData,
                            amount: targetCash,
                            paymentMode: 'Cash'
                        });
                    }

                    // Push Target Bank transaction if > 0
                    if (targetBank > 0) {
                        const bankConfig = resolvePaymentBankConfig();
                        const bankData = {
                            ...baseData,
                            amount: targetBank,
                            paymentMode: paymentForm.paymentMode,
                            instrumentDate: paymentForm.instrumentDate,
                            referenceDate: paymentForm.referenceDate,
                            paymentConfigId: bankConfig?._id || paymentForm.paymentConfigId,
                            depositedToAccount: bankConfig?.account_name || '',
                            bankName: bankConfig?.bank_name || paymentForm.bankName,
                            referenceNo: paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId
                                ? (paymentForm.referenceNo || availableProceedings.find(p => p._id === paymentForm.proceedingId)?.proceedingNumber || '')
                                : paymentForm.referenceNo
                        };
                        if (paymentForm.paymentMode === 'RTF') {
                            bankData.proceedingId = paymentForm.proceedingId;
                        }
                        batchTransactions.push(bankData);
                    }

                    // Push Excess Cash transaction if > 0
                    if (excessCash > 0 && excessBaseData) {
                        batchTransactions.push({
                            ...excessBaseData,
                            amount: excessCash,
                            paymentMode: 'Cash'
                        });
                    }

                    // Push Excess Bank transaction if > 0
                    if (excessBank > 0 && excessBaseData) {
                        const bankConfig = resolvePaymentBankConfig();
                        const bankData = {
                            ...excessBaseData,
                            amount: excessBank,
                            paymentMode: paymentForm.paymentMode,
                            instrumentDate: paymentForm.instrumentDate,
                            referenceDate: paymentForm.referenceDate,
                            paymentConfigId: bankConfig?._id || paymentForm.paymentConfigId,
                            depositedToAccount: bankConfig?.account_name || '',
                            bankName: bankConfig?.bank_name || paymentForm.bankName,
                            referenceNo: paymentForm.paymentMode === 'RTF' && paymentForm.proceedingId
                                ? (paymentForm.referenceNo || availableProceedings.find(p => p._id === paymentForm.proceedingId)?.proceedingNumber || '')
                                : paymentForm.referenceNo
                        };
                        if (paymentForm.paymentMode === 'RTF') {
                            bankData.proceedingId = paymentForm.proceedingId;
                        }
                        batchTransactions.push(bankData);
                    }
                });
            } else {
                validRows.forEach(row => {
                    const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
                    const rowTotal = Number(row.amount);
                    const due = selectedFee ? (Number(selectedFee.dueAmount) || 0) : Infinity;
                    const isExcess = selectedFee && rowTotal > due;
                    const targetAmount = isExcess ? due : rowTotal;
                    const surplus = isExcess ? (rowTotal - due) : 0;

                    if (targetAmount > 0) {
                        batchTransactions.push({
                            ...commonData,
                            feeHeadId: selectedFee ? selectedFee.feeHeadId : row.feeHeadId,
                            studentYear: selectedFee ? selectedFee.studentYear : commonData.studentYear,
                            semester: selectedFee ? selectedFee.semester : commonData.semester,
                            amount: targetAmount,
                            remarks: commonData.remarks
                                ? ((selectedFee && selectedFee.remarks) ? `${selectedFee.remarks} - ${commonData.remarks}` : commonData.remarks)
                                : ((selectedFee && selectedFee.remarks) ? selectedFee.remarks : '')
                        });
                    }

                    if (surplus > 0 && excessFeeHeadId) {
                        batchTransactions.push({
                            ...commonData,
                            feeHeadId: excessFeeHeadId,
                            amount: surplus,
                            remarks: commonData.remarks ? `Excess Payment - ${commonData.remarks}` : 'Excess Payment'
                        });
                    }
                });
            }

            // Send as { transactions: [...] } to match Backend Batch Interface
            const res = await api.post(`/transactions`, {
                transactions: batchTransactions
            });

            // Success!!
            const responseData = res.data;
            setLastTransaction(responseData);
            setRelatedTransactions(responseData.relatedTransactions || [responseData]);

            setShowConfirmModal(false); // Close Confirm
            setShowReceiptModal(true); // Show Receipt

            // Refresh Data
            await fetchStudentData(student);
            setFeeRows([{ id: Date.now(), feeHeadId: '', amount: '' }]); // Reset to 1 empty row

            // Refresh recent transactions list
            try {
                const recentRes = await api.get(`/transactions/recent`);
                setRecentTransactions(recentRes.data || []);
            } catch (e) {
                console.error("Failed to refresh recent transactions", e);
            }

            setPaymentForm(prev => ({
                ...prev,
                remarks: '',
                amount: '',
                bankName: '', instrumentDate: '', referenceNo: '', referenceDate: '',
                paymentDate: new Date().toLocaleDateString('en-CA')
            }));

        } catch (error) {
            console.error(error);
            const msg = error.response?.data?.message || 'Payment Failed';
            showToastMessage(msg, 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    // Filter Logic — history follows the same year selection as dues (viewFilterYear)
    const [historyFilter, setHistoryFilter] = useState({ mode: '', feeHead: '' });
    const yearScopedTransactions = useMemo(() => {
        const list = viewFilterYear === 'ALL'
            ? transactions
            : transactions.filter((t) => Number(t.studentYear) === Number(viewFilterYear));
        return list.filter((t) => t.status !== 'transferred');
    }, [transactions, viewFilterYear]);
    const uniqueFeeHeads = [...new Set(yearScopedTransactions.map(t => t.feeHead?.name).filter(Boolean))];
    const filteredTransactions = yearScopedTransactions.filter(t => {
        if (historyFilter.mode && t.paymentMode !== historyFilter.mode) return false;
        if (historyFilter.feeHead && t.feeHead?.name !== historyFilter.feeHead) return false;
        return true;
    });

    // Drop fee-head history filter when it no longer exists for the selected year
    useEffect(() => {
        if (historyFilter.feeHead && !uniqueFeeHeads.includes(historyFilter.feeHead)) {
            setHistoryFilter((prev) => ({ ...prev, feeHead: '' }));
        }
    }, [viewFilterYear, uniqueFeeHeads, historyFilter.feeHead]);

    const totalSelectedAmount = feeRows.reduce((acc, curr) => acc + Number(curr.amount || 0), 0);

    // Filter Fee Details for Display — only up to student's current year
    const currentYear = Number(student?.current_year || 0);
    const feeDetailsUpToCurrentYear = feeDetails.filter(f => Number(f.studentYear) <= currentYear);

    const displayedFees = feeDetails.filter(f => {
        // Status filter: ACTIVE, INACTIVE, ALL
        const isFeeActive = f.isActive !== false;
        if (viewFilterStatus === 'ACTIVE' && !isFeeActive) return false;
        if (viewFilterStatus === 'INACTIVE' && isFeeActive) return false;

        // Year filter
        if (viewFilterYear === 'ALL') return true;
        return Number(f.studentYear) === Number(viewFilterYear);
    });

    const uniqueStudentYears = useMemo(() => {
        const years = new Set();
        feeDetails.forEach(f => {
            const y = Number(f.studentYear);
            if (y) years.add(y);
        });
        const current = Number(student?.current_year || 0);
        for (let i = 1; i <= current; i++) years.add(i);
        return [...years].sort((a, b) => a - b);
    }, [feeDetails, student?.current_year]);

    const maxTerms = useMemo(() => {
        // Always show at least T1 — non-divided fee heads are treated as Term 1
        const fromFees = Math.max(0, ...displayedFees.map(f =>
            Math.max(f.terms?.length || 0, f.termBalances?.length || 0)
        ));
        return Math.max(1, fromFees || 0);
    }, [displayedFees]);

    const getFeeTermBalance = (fee, termIndex) => {
        const term = fee.terms?.[termIndex];
        const tb = Array.isArray(fee.termBalances)
            ? (fee.termBalances.find(b => Number(b.termNumber) === Number(term?.termNumber || termIndex + 1))
                || fee.termBalances[termIndex])
            : null;
        if (!term && !tb) return null;
        if (tb) return Number(tb.balance) || 0;

        let remPaid = Number(fee.paidAmount) || 0;
        let remConc = Number(fee.concessionAmount) || 0;
        for (let j = 0; j <= termIndex; j++) {
            const t = fee.terms?.[j];
            if (!t && j > 0) continue;
            const pct = Number(t?.percentage) || (j === 0 ? 100 : 0);
            const target = Math.round((Number(fee.totalAmount || 0) * pct) / 100);
            const conc = Math.min(remConc, target);
            remConc -= conc;
            const afterConc = target - conc;
            const paid = Math.min(remPaid, afterConc);
            remPaid -= paid;
            if (j === termIndex) return afterConc - paid;
        }
        return 0;
    };

    const duesTableRows = displayedFees.filter(f => f.totalAmount > 0 || f.paidAmount > 0 || f.concessionAmount > 0);

    const totalDueAmount = displayedFees.reduce((acc, curr) => {
        const isFeeActive = curr.isActive !== false;
        if (viewFilterStatus === 'ACTIVE' && !isFeeActive) return acc;
        return acc + Number(curr.dueAmount || 0);
    }, 0);

    const globalTotalDue = feeDetails.reduce((acc, curr) => {
        const isFeeActive = curr.isActive !== false;
        return isFeeActive ? acc + Number(curr.dueAmount || 0) : acc;
    }, 0);

    // Calculate Scholarship Amounts (Global & Current View)
    // Criteria: isScholarshipApplicable AND (studentScholarStatus is 'eligible', 'yes', or 'true')
    const isScholarshipEligible = (f) => f.isScholarshipApplicable && ['eligible', 'yes', 'true'].includes(String(f.studentScholarStatus || '').toLowerCase());

    const globalScholarshipAmount = feeDetails.reduce((acc, curr) => {
        const isFeeActive = curr.isActive !== false;
        return (isFeeActive && isScholarshipEligible(curr)) ? acc + Number(curr.dueAmount || 0) : acc;
    }, 0);

    const currentViewScholarshipAmount = displayedFees.reduce((acc, curr) => {
        return isScholarshipEligible(curr) ? acc + Number(curr.dueAmount || 0) : acc;
    }, 0);

    // Auto-focus on mount
    useEffect(() => {
        if (searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [loading]); // Focus once loading is done

    return (
        <div className="flex min-h-screen bg-slate-50 font-sans">
            <Sidebar />
            <div className="flex-1 p-4 md:p-6 relative flex flex-col">

                {/* --- HEADER WITH PERMANENT SEARCH BAR --- */}
                <header className="mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Fee Collection</h1>
                        <p className="text-sm text-gray-500">Search for a student to collect fees.</p>
                    </div>

                    <div className="w-full md:w-auto flex-1 max-w-xl">
                        <div className="relative">
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search Name, Adm No, Mobile..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    if (e.target.value) setStudent(null); // Deselect student when searching
                                }}
                                className="w-full px-4 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm pl-10"
                            />
                            <div className="absolute left-3 top-2.5 text-gray-400">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            </div>
                            {loading && (
                                <div className="absolute right-3 top-2.5">
                                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-500"></div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                {error && <p className="text-red-500 mb-4 bg-red-50 p-2 rounded border border-red-100">{error}</p>}

                {/* --- SEARCH RESULTS GRID --- */}
                {!student && searchQuery && (
                    <div className="mb-8 animate-fadeIn">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-lg font-bold text-gray-700">Search Results</h3>
                            <span className="text-sm text-gray-500">{filteredStudents.length} matches found</span>
                        </div>

                        {filteredStudents.length === 0 ? (
                            <div className="text-center py-10 bg-white rounded-lg border border-gray-200 text-gray-500">
                                No students found matching "{searchQuery}"
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {filteredStudents.slice(0, 12).map((s) => (
                                    <div key={s.id || s.admission_number} onClick={() => selectStudent(s)}
                                        className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 cursor-pointer hover:border-blue-400 hover:shadow-lg transition-all duration-300 group relative overflow-hidden flex flex-col gap-3">
                                        {/* Status Stripe */}
                                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${s.student_status === 'Active' ? 'bg-green-500' : 'bg-gray-300'}`}></div>

                                        <div className="flex justify-between items-start pl-2">
                                            <div className="flex-1 min-w-0">
                                                <h4 className="font-bold text-gray-900 group-hover:text-blue-700 truncate text-lg transition-colors">{s.student_name}</h4>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="bg-blue-600 text-white px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shadow-sm">
                                                        {s.course}
                                                    </span>
                                                    <span className="bg-blue-100 text-blue-800 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-blue-200">
                                                        {s.branch}
                                                    </span>
                                                    <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-200">
                                                        {s.stud_type || 'Regular'}
                                                    </span>
                                                    {s.caste && (
                                                        <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-orange-200">
                                                            {s.caste}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <span className={`px-2 py-1 text-[10px] font-bold rounded-md uppercase tracking-tighter ${s.student_status === 'Active' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-gray-50 text-gray-500 border border-gray-100'}`}>
                                                {s.student_status}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 pl-2 mt-2 pt-3 border-t border-gray-50">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-tight">Admission No</span>
                                                <span className="text-sm font-medium text-gray-700 font-mono">{s.admission_number}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-tight">Pin No</span>
                                                <span className="text-sm font-medium text-gray-700 font-mono">{s.pin_no || '—'}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-tight">Current Year</span>
                                                <span className="text-sm font-medium text-gray-700">Year {s.current_year} (S{s.current_semester})</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-tight">Mobile No</span>
                                                <span className="text-sm font-medium text-gray-700 font-mono">{s.student_mobile}</span>
                                            </div>
                                        </div>

                                        {/* Subtle selection arrow */}
                                        <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0 duration-300">
                                            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {filteredStudents.length > 12 && (
                            <div className="text-center mt-4 text-sm text-gray-500 italic">
                                Showing top 10 results. Keep typing to refine...
                            </div>
                        )}
                    </div>
                )}

                {/* --- INITIAL EMPTY STATE WITH RECENT TRANSACTIONS --- */}
                {!student && !searchQuery && !loading && (
                    <div className="flex-1 flex flex-col min-h-0 space-y-6">
                        {/* Search prompt card */}
                        <div className="bg-white rounded-3xl border border-slate-200/60 p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden shrink-0 shadow-sm">
                            <div className="space-y-2">
                                <h2 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">Search for a Student to Begin</h2>
                                <p className="text-xs md:text-sm text-slate-500 max-w-xl font-medium leading-relaxed">
                                    Use the search bar above to look up student accounts by Name, PIN Number, or Admission ID to collect fees, manage concessions, or view statements.
                                </p>
                            </div>
                            <button 
                                onClick={() => searchInputRef.current?.focus()} 
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md shrink-0 animate-pulse"
                            >
                                Start Search
                            </button>
                        </div>

                        {/* Recent Transactions List */}
                        <div className="flex-1 min-h-0 bg-white rounded-3xl border border-slate-200/60 shadow-sm p-4 sm:p-6 flex flex-col">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4 shrink-0">
                                <div className="flex items-center gap-2">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                    <h3 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                                        Recent Activity (User Collections)
                                    </h3>
                                </div>
                                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-black uppercase">
                                    Live
                                </span>
                            </div>

                            {recentTransactions.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center py-12 text-slate-400 opacity-60">
                                    <svg className="w-12 h-12 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                    <span className="text-xs font-bold uppercase tracking-wider">No recent transactions recorded</span>
                                </div>
                            ) : (
                                <div className="flex-1 overflow-y-auto min-h-0 sidebar-nav-scroll pr-1">
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse text-xs">
                                            <thead>
                                                <tr className="border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                                                    <th className="py-2.5 px-3">Receipt No</th>
                                                    <th className="py-2.5 px-3">Student Name</th>
                                                    <th className="py-2.5 px-3">Admission No</th>
                                                    <th className="py-2.5 px-3">Fee Head</th>
                                                    <th className="py-2.5 px-3 text-right">Amount</th>
                                                    <th className="py-2.5 px-3">Mode</th>
                                                    <th className="py-2.5 px-3">Date</th>
                                                    <th className="py-2.5 px-3 text-center">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 font-medium">
                                                {recentTransactions.map((tx) => (
                                                    <tr key={tx._id} className="hover:bg-slate-50/40 transition-colors">
                                                        <td className="py-3 px-3 font-bold text-slate-800 font-mono">{tx.receiptNumber}</td>
                                                        <td className="py-3 px-3 font-bold text-slate-900">{tx.studentName}</td>
                                                        <td className="py-3 px-3 text-slate-500 font-mono">{tx.studentId}</td>
                                                        <td className="py-3 px-3 text-slate-600">{tx.feeHead?.name || '—'}</td>
                                                        <td className="py-3 px-3 text-right font-extrabold text-emerald-600 font-mono">₹{fmtAmount(tx.amount)}</td>
                                                        <td className="py-3 px-3">
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                                                tx.paymentMode === 'Cash' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'
                                                            }`}>
                                                                {tx.paymentMode}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-3 text-slate-400 font-mono">
                                                            {new Date(tx.paymentDate || tx.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                        </td>
                                                        <td className="py-3 px-3 text-center">
                                                             <div className="flex items-center justify-center">
                                                                 <button
                                                                     onClick={() => handleActionOnRecentTransaction(tx)}
                                                                     className="px-2.5 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-md transition-colors uppercase"
                                                                     title="Open student profile"
                                                                 >
                                                                     Open
                                                                 </button>
                                                             </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}


                {/* --- STUDENT FEE DASHBOARD (Visible when student selected) --- */}
                {student && (
                    isDashLoading ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-20">
                            <div className="relative">
                                <div className="h-16 w-16 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center text-blue-600">
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                            </div>
                            <h3 className="text-lg font-bold text-gray-700 mt-4">Loading Student Profile</h3>
                            <p className="text-gray-400 text-sm">Please wait while we fetch the latest fee details...</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
                            {/* Left Column: Student Info, Fee Dues & Payment History */}
                            <div className="lg:col-span-2 space-y-4">

                                {/* Student Profile Card - Compact Professional Design */}
                                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-4">
                                    <div className="bg-blue-600 p-3 text-white flex flex-col md:flex-row items-center md:items-start gap-3">
                                        {/* Photo */}
                                        <div className="h-12 w-12 rounded-full border-2 border-white/20 shadow-md overflow-hidden shrink-0 bg-white">
                                            {student.student_photo ? (
                                                <img
                                                    src={student.student_photo.startsWith('data:') ? student.student_photo : `data:image/jpeg;base64,${student.student_photo}`}
                                                    alt="Student"
                                                    className="h-full w-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
                                                    title="Click to view larger image"
                                                    onClick={() => setShowPhotoPopup(true)}
                                                />
                                            ) : (
                                                <div className="h-full w-full flex items-center justify-center text-base font-bold text-gray-400">
                                                    {student.student_name?.charAt(0)}
                                                </div>
                                            )}
                                        </div>                                        {/* Info & Tags (Combined for flex-1) */}
                                        <div className="flex-1">
                                            <div className="flex flex-col md:flex-row md:items-baseline md:gap-2">
                                                <h2 className="text-sm font-bold truncate">{student.student_name}</h2>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="bg-white/20 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm border border-white/20">
                                                        {student.course}
                                                    </span>
                                                    <span className="bg-white/10 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm border border-white/10">
                                                        {student.branch}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap justify-center md:justify-start gap-1.5 text-[11px] mt-1">
                                                <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                    <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Adm:</span>
                                                    <span className="font-mono font-bold">{student.admission_number}</span>
                                                </div>
                                                <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                    <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Pin:</span>
                                                    <span className="font-mono font-bold">{student.pin_no || '-'}</span>
                                                </div>
                                                <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                    <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Yr:</span>
                                                    <span className="font-bold">{student.current_year} (S{student.current_semester})</span>
                                                </div>
                                                <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                    <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Quota:</span>
                                                    <span className="font-bold text-yellow-300 uppercase">{student.stud_type || 'Regular'}</span>
                                                </div>
                                                {student && (() => {
                                                    let meritText = '-';
                                                    let isMeritYes = false;

                                                    const yearFilter = viewFilterYear !== 'ALL' ? Number(viewFilterYear) : Number(student.current_year);
                                                    const meritRecords = Array.isArray(student.meritStatusRecords)
                                                        ? student.meritStatusRecords
                                                        : (Array.isArray(student.merit_status) ? student.merit_status : []);

                                                    if (meritRecords && meritRecords.length > 0) {
                                                        const yearRecord = meritRecords.find(m => Number(m.student_year) === yearFilter) || meritRecords[meritRecords.length - 1];
                                                        if (yearRecord) {
                                                            meritText = String(yearRecord.merit_status || '-').toUpperCase();
                                                            isMeritYes = String(yearRecord.merit_status).toLowerCase() === 'yes';
                                                        }
                                                    } else if (typeof student.merit_status === 'string' && student.merit_status) {
                                                        meritText = student.merit_status.toUpperCase();
                                                        isMeritYes = student.merit_status.toLowerCase() === 'yes';
                                                    }

                                                    return (
                                                        <div className={`px-1.5 py-0.5 rounded flex items-center ${isMeritYes ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-blue-700'}`}>
                                                            <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Merit:</span>
                                                            <span className={`font-bold uppercase ${isMeritYes ? 'text-emerald-300' : 'text-white'}`}>
                                                                {meritText}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                                {student && (() => {
                                                    let scholarText = 'not_eligible';
                                                    let isEligibleClass = false;

                                                    const yearFilter = viewFilterYear !== 'ALL' ? Number(viewFilterYear) : Number(student.current_year);
                                                    if (student.scholarships && student.scholarships.length > 0) {
                                                        const yearRecords = student.scholarships.filter(s => Number(s.student_year) === yearFilter);
                                                        if (yearRecords.length > 0) {
                                                            scholarText = yearRecords.map(r => `S${r.student_semester || 'Y'}: ${r.eligible}`).join(' | ');
                                                            isEligibleClass = yearRecords.some(r => String(r.eligible).toLowerCase() === 'eligible');
                                                        }
                                                    }

                                                    return (
                                                        <div className={`px-1.5 py-0.5 rounded flex items-center ${isEligibleClass ? 'bg-yellow-500/20 border border-yellow-500/30' : 'bg-blue-700'}`}>
                                                            <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Scholar:</span>
                                                            <span className={`font-bold uppercase ${isEligibleClass ? 'text-yellow-400' : 'text-white'}`}>
                                                                {scholarText}
                                                            </span>
                                                        </div>
                                                    );
                                                })()}
                                                {student.caste && (
                                                    <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                        <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Caste:</span>
                                                        <span className="font-bold text-orange-300 uppercase">{student.caste}</span>
                                                    </div>
                                                )}
                                                {student.student_status && (
                                                    <div className="bg-blue-700 px-1.5 py-0.5 rounded flex items-center">
                                                        <span className="text-blue-100 mr-1 uppercase text-[9px] font-bold">Status</span>
                                                        <span className="font-bold text-orange-300 uppercase">{student.student_status}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Status / Balance - Reverted to simpler original style for right-alignment */}
                                        <div className="flex flex-col gap-0.5 text-right shrink-0">
                                            <div className="text-[9px] text-blue-200 uppercase font-bold">Total Due</div>
                                            <div className="text-base font-bold text-white leading-none">{fmtAmount(globalTotalDue)}</div>
                                            {globalScholarshipAmount > 0 && (
                                                <div className="text-[9px] text-yellow-300 font-medium mt-0.5" title="Amount covered by Scholarship">
                                                    (Scholarship: {fmtAmount(globalScholarshipAmount)})
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* --- YEAR WISE STATS CARDS --- */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 animate-fadeIn">
                                    {(() => {
                                        const yearWiseStats = {};
                                        // Initialize with all years up to current
                                        for (let i = 1; i <= (student.current_year || 1); i++) {
                                            yearWiseStats[i] = { total: 0, paid: 0, due: 0, year: i };
                                        }

                                        // Add years from feeDetails — only up to the student's current year
                                        feeDetails.forEach(curr => {
                                            if (curr.isActive === false) return; // Exclude inactive fees from stats cards
                                            const y = curr.studentYear;
                                            // Skip future years beyond the student's current year
                                            if (Number(y) > Number(student.current_year || 1)) return;
                                            if (!yearWiseStats[y]) yearWiseStats[y] = { total: 0, paid: 0, due: 0, year: y };
                                            yearWiseStats[y].total += Number(curr.totalAmount || 0);
                                            yearWiseStats[y].paid += Number(curr.paidAmount || 0);
                                            yearWiseStats[y].due += Number(curr.dueAmount || 0);
                                        });
                                        const sortedYearStats = Object.values(yearWiseStats).sort((a, b) => Number(a.year) - Number(b.year));

                                        if (sortedYearStats.length === 0) return null;

                                        return sortedYearStats.map(stat => (
                                            <div
                                                key={stat.year}
                                                onClick={() => setViewFilterYear(String(stat.year))}
                                                className={`bg-white p-4 rounded-xl border transition-all relative overflow-hidden group cursor-pointer ${String(viewFilterYear) === String(stat.year) ? 'ring-2 ring-blue-500 shadow-md border-blue-500' : 'border-gray-200 shadow-sm hover:shadow-md hover:border-blue-300'}`}
                                            >
                                                <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br from-transparent ${stat.due > 0 ? 'to-red-50/50' : 'to-green-50/50'} rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110`}></div>

                                                <div className="flex justify-between items-center mb-3">
                                                    <div className="flex items-center gap-2">
                                                        <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${stat.due > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                                            Y{stat.year}
                                                        </span>
                                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Year {stat.year}</span>
                                                    </div>
                                                    {stat.due <= 0 && <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded border border-green-100 font-bold uppercase">Paid</span>}
                                                </div>

                                                <div className="space-y-1 relative z-10">
                                                    <div className="flex justify-between items-end">
                                                        <span className="text-[10px] font-semibold text-gray-400 uppercase">Balance</span>
                                                        <span className={`text-lg font-extrabold font-mono leading-none ${stat.due > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtAmount(stat.due)}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center text-[10px] text-gray-400 pt-1">
                                                        <span>Total: {fmtAmount(stat.total)}</span>
                                                        <span>Paid: <span className="text-gray-600 font-medium">{fmtAmount(stat.paid)}</span></span>
                                                    </div>


                                                </div>
                                            </div>
                                        ));
                                    })()}
                                </div>
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6">
                                    <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                                        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                                            <div className="bg-blue-100 p-1 rounded text-blue-600">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                                            </div>
                                            Fee Dues Breakdown
                                            <button
                                                type="button"
                                                onClick={syncStudentFees}
                                                disabled={isSyncingFees || isDashLoading}
                                                title="Sync fees from matching fee structures"
                                                className="ml-0.5 p-1 rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                            >
                                                <svg
                                                    className={`w-4 h-4 ${isSyncingFees ? 'animate-spin' : ''}`}
                                                    fill="none"
                                                    stroke="currentColor"
                                                    viewBox="0 0 24 24"
                                                >
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                </svg>
                                            </button>
                                        </h3>
                                        <div className="flex items-center gap-2">
                                            {loading && <span className="text-[10px] text-blue-500 animate-pulse font-medium">Updating...</span>}
                                            <select
                                                className="text-xs border-gray-200 border rounded-lg px-2.5 py-1 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer"
                                                value={viewFilterStatus}
                                                onChange={(e) => setViewFilterStatus(e.target.value)}
                                            >
                                                <option value="ACTIVE">Active Fees</option>
                                                <option value="INACTIVE">Inactive Fees</option>
                                                <option value="ALL">All Statuses</option>
                                            </select>
                                            <select
                                                className="text-xs border-gray-200 border rounded-lg px-2.5 py-1 bg-white focus:ring-2 focus:ring-blue-500 outline-none shadow-sm cursor-pointer"
                                                value={viewFilterYear}
                                                onChange={(e) => setViewFilterYear(e.target.value)}
                                            >
                                                <option value="ALL">All Years</option>
                                                {uniqueStudentYears.map(y => <option key={y} value={y}>Year {y}</option>)}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={handlePrintStatement}
                                                disabled={isPrintingStatement || isDashLoading}
                                                className="flex items-center gap-1.5 px-3 py-1 bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-xs font-bold rounded-lg shadow-sm transition-all active:scale-95 cursor-pointer ml-1"
                                                title="Print Student Fee Ledger / Statement"
                                            >
                                                <svg className="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>
                                                {isPrintingStatement ? 'Generating...' : 'Print Statement'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b-2 border-gray-200 bg-gray-100/80">
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider text-center w-10">Select</th>
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider">Fee Head / Year</th>
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider text-right">Total Fee</th>
                                                    {/* Dynamic Term Headers */}
                                                    {[...Array(maxTerms)].map((_, i) => (
                                                        <th key={i} className="py-2 px-3 text-[10px] font-bold text-gray-500 uppercase tracking-wider text-right bg-blue-50/30">T{i + 1} Due</th>
                                                    ))}
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider text-right">Paid</th>
                                                    <th className="py-2 px-3 text-[10px] font-bold text-purple-600 uppercase tracking-wider text-right">Concession</th>
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider text-right">Balance</th>
                                                    <th className="py-2 px-3 text-[10px] font-bold text-gray-600 uppercase tracking-wider text-center">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {duesTableRows.length === 0 ? (
                                                    <tr><td colSpan={6 + maxTerms} className="py-5 text-center text-gray-500 italic text-xs">No active fees found for this selection. Use the dropdown to collect a new fee.</td></tr>
                                                ) : (
                                                    <>
                                                        {duesTableRows.map((fee, idx) => {
                                                            const isFullyPaid = fee.dueAmount <= 0;
                                                            const isPartial = fee.paidAmount > 0 && fee.dueAmount > 0;
                                                            const isSelected = feeRows.some(row => row.feeHeadId === fee._id);
                                                            const rowKey = fee._id || `fee-${idx}`;
                                                            const isExpanded = expandedFeeRows.has(rowKey);
                                                            const hasDetails = Boolean(fee.remarks);
                                                            const detailColSpan = 7 + maxTerms;

                                                            return (
                                                                <React.Fragment key={rowKey}>
                                                                <tr
                                                                    onClick={() => !isFullyPaid && fee.isActive !== false && toggleFeeSelection(fee)}
                                                                    className={`transition-colors cursor-pointer ${fee.isActive === false ? 'opacity-60 bg-gray-100 hover:bg-gray-100' : isSelected ? 'bg-blue-100/50 hover:bg-blue-100' : 'hover:bg-blue-50/50 even:bg-gray-50/50'}`}
                                                                >
                                                                    <td className="py-1.5 px-3 text-center">
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isSelected}
                                                                            readOnly
                                                                            disabled={isFullyPaid || fee.isActive === false}
                                                                            className="w-3.5 h-3.5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer disabled:cursor-not-allowed"
                                                                        />
                                                                    </td>
                                                                    <td className="py-1.5 px-3 text-xs font-medium text-gray-700">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span title={fee.feeHeadCode ? `Code: ${fee.feeHeadCode}` : undefined} className="cursor-default">{fee.feeHeadName}</span>
                                                                            {hasDetails && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={(e) => toggleFeeRowExpand(rowKey, e)}
                                                                                    className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                                                                                    title={isExpanded ? 'Hide details' : 'Show details'}
                                                                                >
                                                                                    <svg
                                                                                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                                                                                        fill="none"
                                                                                        stroke="currentColor"
                                                                                        viewBox="0 0 24 24"
                                                                                    >
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                                                                    </svg>
                                                                                </button>
                                                                            )}
                                                                            {fee.isScholarshipApplicable && ['eligible', 'yes', 'true'].includes(String(fee.studentScholarStatus || '').toLowerCase()) && (
                                                                                <span title="Scholarship Applicable" className="text-[9px] bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded border border-yellow-200 font-bold uppercase tracking-wider">
                                                                                    Sch
                                                                                </span>
                                                                            )}
                                                                            {fee.extraDemandAmount > 0 && (
                                                                                <span title="Extra Demand Added" className="text-[9px] bg-red-100 text-red-800 px-1.5 py-0.5 rounded border border-red-200 font-bold uppercase tracking-wider whitespace-nowrap">
                                                                                    +{fmtAmount(fee.extraDemandAmount)} Demand
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-[9px] text-gray-400">Year {fee.studentYear} • Sem {fee.semester || '-'}</div>
                                                                    </td>
                                                                    <td className="py-1.5 px-3 text-xs text-right text-gray-600 font-mono">{fmtAmount(fee.totalAmount)}</td>

                                                                    {/* Dynamic Term Columns — non-divided heads show due under T1 */}
                                                                    {Array.from({ length: maxTerms }, (_, i) => {
                                                                        const termBalance = getFeeTermBalance(fee, i);
                                                                        if (termBalance == null) {
                                                                            return <td key={i} className="py-1.5 px-3 text-right text-gray-400 bg-gray-50/20 text-[11px]">- - -</td>;
                                                                        }
                                                                        return (
                                                                            <td key={i} className={`py-1.5 px-3 text-[11px] text-right font-mono border-x border-gray-100/50 ${termBalance > 0 ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                                                                                {termBalance > 0 ? fmtAmount(termBalance) : '—'}
                                                                            </td>
                                                                        );
                                                                    })}

                                                                    <td className="py-1.5 px-3 text-xs text-right text-green-600 font-mono font-medium">{fmtAmount(fee.paidAmount)}</td>
                                                                    <td className="py-1.5 px-3 text-xs text-right text-purple-600 font-mono font-medium">{fmtAmount(fee.concessionAmount)}</td>
                                                                    <td className="py-1.5 px-3 text-xs text-right font-bold text-gray-800 font-mono">{fmtAmount(fee.dueAmount)}</td>
                                                                    <td className="py-1.5 px-3 text-center">
                                                                        {fee.isActive === false ? (
                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-600">
                                                                                Inactive
                                                                            </span>
                                                                        ) : isFullyPaid ? (
                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-800">
                                                                                Paid
                                                                            </span>
                                                                        ) : isPartial ? (
                                                                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 text-yellow-800">
                                                                                Partial
                                                                            </span>
                                                                        ) : (
                                                                            <div className="flex flex-col items-center">
                                                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-100 text-red-800">
                                                                                    Unpaid
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                                {hasDetails && isExpanded && (
                                                                    <tr className="bg-blue-50/40 border-b border-blue-100/60">
                                                                        <td className="py-2 px-3"></td>
                                                                        <td colSpan={detailColSpan - 1} className="py-2 px-4">
                                                                            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Details</div>
                                                                            <div className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">
                                                                                {fee.remarks}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                        {/* Column totals: terms + paid + concession + balance */}
                                                        {(() => {
                                                            const termDues = Array.from({ length: maxTerms }, () => 0);
                                                            let totalFee = 0;
                                                            let paid = 0;
                                                            let concession = 0;
                                                            let balance = 0;
                                                            duesTableRows.forEach(fee => {
                                                                totalFee += Number(fee.totalAmount) || 0;
                                                                paid += Number(fee.paidAmount) || 0;
                                                                concession += Number(fee.concessionAmount) || 0;
                                                                balance += Number(fee.dueAmount) || 0;
                                                                for (let i = 0; i < maxTerms; i++) {
                                                                    const tb = getFeeTermBalance(fee, i);
                                                                    if (tb != null) termDues[i] += Number(tb) || 0;
                                                                }
                                                            });
                                                            return (
                                                                <tr className="bg-slate-100/80 border-t-2 border-slate-300">
                                                                    <td className="py-2.5 px-3"></td>
                                                                    <td className="py-2.5 px-3 text-[11px] font-extrabold text-slate-800 uppercase tracking-wide">
                                                                        Total
                                                                        <div className="text-[9px] font-semibold text-slate-500 normal-case tracking-normal mt-0.5">
                                                                            {viewFilterYear === 'ALL' ? 'All years' : `Year ${viewFilterYear}`}
                                                                        </div>
                                                                    </td>
                                                                    <td className="py-2.5 px-3 text-right text-xs font-bold text-slate-800 font-mono">
                                                                        {fmtAmount(totalFee)}
                                                                    </td>
                                                                    {termDues.map((amt, i) => (
                                                                        <td key={i} className={`py-2.5 px-3 text-right text-[11px] font-bold font-mono border-x border-slate-200/60 ${amt > 0 ? 'text-red-600' : 'text-slate-400'}`}>
                                                                            {amt > 0 ? fmtAmount(amt) : '—'}
                                                                        </td>
                                                                    ))}
                                                                    <td className="py-2.5 px-3 text-right text-xs font-bold text-green-700 font-mono">
                                                                        {fmtAmount(paid)}
                                                                    </td>
                                                                    <td className="py-2.5 px-3 text-right text-xs font-bold text-purple-700 font-mono">
                                                                        {fmtAmount(concession)}
                                                                    </td>
                                                                    <td className="py-2.5 px-3 text-right text-sm font-extrabold text-red-600 font-mono">
                                                                        {fmtAmount(balance)}
                                                                        {currentViewScholarshipAmount > 0 && (
                                                                            <div className="text-[9px] text-yellow-600 font-bold mt-0.5">
                                                                                (Sch: {fmtAmount(currentViewScholarshipAmount)})
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td className="py-2.5 px-3"></td>
                                                                </tr>
                                                            );
                                                        })()}
                                                    </>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* Payment History */}
                                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                                    <div className="px-5 py-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 gap-2 flex-wrap">
                                        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                                            <div className="bg-green-100 p-1 rounded text-green-600">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            </div>
                                            Transaction History
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100">
                                                {viewFilterYear === 'ALL' ? 'All Years' : `Year ${viewFilterYear}`}
                                            </span>
                                        </h3>
                                        <div className="flex gap-1.5 text-[11px]">
                                            <select className="border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none focus:ring-2 focus:ring-green-500 shadow-sm text-[11px]" value={historyFilter.mode} onChange={e => setHistoryFilter({ ...historyFilter, mode: e.target.value })}>
                                                <option value="">All Modes</option>
                                                <option>Cash</option>
                                                <option>UPI</option>
                                                <option>Cheque</option>
                                                <option>DD</option>
                                                <option>Waiver</option>
                                            </select>
                                            <select className="border border-gray-200 rounded-lg px-2 py-1 max-w-[150px] bg-white outline-none focus:ring-2 focus:ring-green-500 shadow-sm text-[11px]" value={historyFilter.feeHead} onChange={e => setHistoryFilter({ ...historyFilter, feeHead: e.target.value })}>
                                                <option value="">All Fee Heads</option>
                                                {uniqueFeeHeads.map(fh => <option key={fh} value={fh}>{fh}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto max-h-[400px]">
                                        <table className="w-full text-left text-xs">
                                            <thead className="bg-gray-50/50 border-b border-gray-100 sticky top-0 z-10">
                                                <tr>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Date</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Description</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider whitespace-nowrap">Receipt No</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Mode</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-center">Year / Sem</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">Amount</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Remarks</th>
                                                    <th className="py-1.5 px-3 text-[10px] font-bold text-right text-gray-400 uppercase tracking-wider">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {filteredTransactions.length === 0 ? (
                                                    <tr><td colSpan="8" className="py-6 text-center text-gray-500 italic text-xs">No matching transactions found.</td></tr>
                                                ) : (
                                                    filteredTransactions.map((t, i) => (
                                                        <TransactionRow
                                                            key={t._id || i}
                                                            transaction={t}
                                                            allTransactions={transactions} // Pass full history to find batch siblings
                                                            student={student}
                                                            totalDue={totalDueAmount}
                                                            settings={receiptSettings}
                                                            onEdit={handleEditTransaction}
                                                            onDelete={handleDeleteTransaction}
                                                        />
                                                    ))
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Payment Form & Transfer Form */}
                            {(canCollectFee || canTransferFee || isSuperAdmin) && (
                                <div className="space-y-3">
                                {isFeeCollectionDisabled && (
                                    <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-3">
                                        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-11a4 4 0 00-4 4v1H6a2 2 0 00-2 2v7a2 2 0 002 2h12a2 2 0 002-2v-7a2 2 0 00-2-2h-2V9a4 4 0 00-4-4z" /></svg>
                                        </div>
                                        <div>
                                            <p className="font-bold text-red-700 text-sm">Fee Collection Disabled</p>
                                            <p className="text-red-500 text-xs mt-0.5">Your access to collect fees has been temporarily disabled by the administrator. Please contact your supervisor.</p>
                                        </div>
                                    </div>
                                )}
                                {!isFeeCollectionDisabled && (
                                <div className="space-y-3">
                                    <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden sticky top-6">
                                        {isEditMode ? (
                                            <div className="flex border-b border-gray-100 bg-amber-500 text-white font-bold text-sm relative items-center justify-between px-4 py-3">
                                                 <div className="uppercase tracking-wider font-extrabold flex items-center gap-1.5">
                                                     <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                     Edit Mode
                                                 </div>
                                                 <button 
                                                     type="button"
                                                     onClick={cancelEditMode}
                                                     className="text-[10px] bg-amber-700 hover:bg-amber-800 text-white px-2 py-0.5 rounded font-black border border-amber-600 uppercase transition-all shadow-sm"
                                                 >
                                                     Cancel
                                                 </button>
                                             </div>
                                        ) : (
                                            <div className="flex border-b border-gray-100 bg-gray-50">
                                                 {(canCollectFee || isSuperAdmin) && (
                                                     <button
                                                         type="button"
                                                         onClick={() => setActionTab('collect')}
                                                         className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-all outline-none ${actionTab === 'collect' ? 'bg-white text-blue-700 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100/50'}`}
                                                     >
                                                         COLLECT FEE
                                                     </button>
                                                 )}
                                                 {canTransferFee && (
                                                     <button
                                                         type="button"
                                                         onClick={() => setActionTab('transfer')}
                                                         className={`flex-1 py-3 text-xs font-bold text-center border-b-2 transition-all outline-none ${actionTab === 'transfer' ? 'bg-white text-blue-700 border-blue-600' : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-100/50'}`}
                                                     >
                                                         TRANSFER FEE
                                                     </button>
                                                 )}
                                            </div>
                                        )}

                                            <div className="p-4">
                                                <div className="flex justify-between items-center mb-4 border-b border-gray-100 pb-3">
                                                    <div>
                                                        <h3 className="text-base font-bold text-gray-800">
                                                            {isEditMode ? 'Transaction Details' : actionTab === 'transfer' ? 'Transfer Details' : 'Payment Details'}
                                                        </h3>
                                                        {!canEditTransactionDate ? (
                                                            <p className="text-[11px] text-slate-600 mt-0.5 font-medium">
                                                                {actionTab === 'transfer' ? 'Select source and destination fee heads' : `Date: ${paymentForm.paymentDate ? new Date(paymentForm.paymentDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                                                                {isEditMode && editingTransaction?.receiptNumber ? ` · Receipt: ${editingTransaction.receiptNumber}` : ''}
                                                            </p>
                                                        ) : (
                                                            <p className="text-[11px] text-gray-400 mt-0.5">
                                                                {isEditMode ? `Receipt: ${editingTransaction?.receiptNumber}` : actionTab === 'transfer' ? 'Move money between student fee heads' : 'Add fee heads and amount below'}
                                                            </p>
                                                        )}
                                                    </div>
                                                    {!isEditMode && actionTab === 'collect' && !isRtfShareLocked && (
                                                        <button
                                                            type="button"
                                                            onClick={addFeeRow}
                                                            className="bg-gray-100 text-gray-600 p-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition duration-200 border border-gray-200 shadow-sm"
                                                            title="Add Another Fee Head"
                                                        >
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                                                        </button>
                                                    )}
                                                </div>

                                                {(actionTab === 'collect' || isEditMode) ? (
                                                    <form onSubmit={handlePrePayment} className="space-y-3">

                                                        {/* Dynamic Rows */}
                                                        <div className="space-y-2">
                                                            {feeRows.map((row, index) => {
                                                                // Identify already selected fee head IDs in other rows
                                                                const getTrueFeeHeadId = (rowFeeHeadId) => {
                                                                    const matchedFee = feeDetails.find(f => f._id === rowFeeHeadId);
                                                                    return matchedFee ? matchedFee.feeHeadId : rowFeeHeadId;
                                                                };
                                                                const selectedTrueFeeHeadIdsElsewhere = feeRows
                                                                    .filter(r => r.id !== row.id && r.feeHeadId)
                                                                    .map(r => getTrueFeeHeadId(r.feeHeadId));

                                                                // Build the merged options list:
                                                                // 1. All configured fees for the student (displayedFees)
                                                                // 2. Any global fee heads NOT already covered by configured fees
                                                                const configuredFeeHeadIds = new Set(displayedFees.filter(f => f.totalAmount > 0).map(f => f.feeHeadId));
                                                                const extraGlobalHeads = globalFeeHeads.filter(h => h.isActive !== false && !configuredFeeHeadIds.has(h._id));

                                                                return (
                                                                    <div key={row.id} className="flex flex-col gap-2 p-2 rounded-lg bg-gray-50/80 border border-gray-200/60 transition-all hover:border-blue-200 hover:shadow-sm group">
                                                                        <div className="flex gap-2 items-start">
                                                                            <div className="flex-1">
                                                                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Select Fee</label>
                                                                                <select
                                                                                    className="w-full border border-gray-300 rounded-lg p-1.5 text-xs bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all disabled:opacity-75 disabled:bg-gray-100 disabled:cursor-not-allowed"
                                                                                    value={row.feeHeadId}
                                                                                    onChange={e => updateFeeRow(row.id, 'feeHeadId', e.target.value)}
                                                                                    required
                                                                                    disabled={isEditMode}
                                                                                >
                                                                                    <option value="">-- Select Fee Head --</option>

                                                                                    {displayedFees.filter(f => f.totalAmount > 0 && !selectedTrueFeeHeadIdsElsewhere.includes(f.feeHeadId)).length > 0 && (
                                                                                        <optgroup label="── Structured Fees ──">
                                                                                            {displayedFees
                                                                                                .filter(f => f.totalAmount > 0 && !selectedTrueFeeHeadIdsElsewhere.includes(f.feeHeadId))
                                                                                                .map(f => (
                                                                                                    <option key={f._id} value={f._id}>
                                                                                                        [{f.academicYear}] (Yr {f.studentYear}) {f.feeHeadName} (Due: {f.dueAmount})
                                                                                                    </option>
                                                                                                ))
                                                                                            }
                                                                                        </optgroup>
                                                                                    )}
                                                                                    {/* All remaining global fee heads */}
                                                                                    {extraGlobalHeads.filter(h => !selectedTrueFeeHeadIdsElsewhere.includes(h._id)).length > 0 && (
                                                                                        <optgroup label="── All Fee Heads ──">
                                                                                            {extraGlobalHeads
                                                                                                .filter(h => !selectedTrueFeeHeadIdsElsewhere.includes(h._id))
                                                                                                .map(h => (
                                                                                                    <option key={h._id} value={h._id}>
                                                                                                        {h.name} {h.code ? `(${h.code})` : ''}
                                                                                                    </option>
                                                                                                ))
                                                                                            }
                                                                                        </optgroup>
                                                                                    )}
                                                                                </select>
                                                                            </div>
                                                                        <div className="w-24">
                                                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                                                                Amount{isRtfShareLocked ? ' (Share)' : ''}
                                                                            </label>
                                                                            <div className="relative">
                                                                                <span className="absolute left-2 top-1.5 text-gray-400 text-xs"></span>
                                                                                <input
                                                                                    type="number"
                                                                                    className={`w-full border rounded-lg p-1.5 pl-5 text-xs font-bold outline-none transition-all placeholder-gray-300 disabled:cursor-not-allowed ${
                                                                                        isRtfShareLocked
                                                                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                                                                            : 'border-gray-300 text-gray-700 bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-75 disabled:bg-gray-100'
                                                                                    }`}
                                                                                    value={row.amount}
                                                                                    onChange={e => updateFeeRow(row.id, 'amount', e.target.value)}
                                                                                    onWheel={e => e.target.blur()}
                                                                                    required
                                                                                    placeholder="0"
                                                                                    disabled={isEditMode || isRtfShareLocked}
                                                                                    readOnly={isRtfShareLocked}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        {feeRows.length > 1 && !isEditMode && !isRtfShareLocked && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => removeFeeRow(row.id)}
                                                                                className="mt-6 text-gray-300 hover:text-red-500 transition-colors bg-white rounded-full p-0.5 border border-transparent hover:border-red-100 hover:bg-red-50"
                                                                            >
                                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        </div>

                                                        {/* Total Summary */}
                                                        <div className="flex justify-between items-end py-2 border-t border-dashed border-gray-200 mt-1">
                                                            <span className="text-xs font-medium text-gray-500">Total Amount</span>
                                                            <span className="text-2xl font-extrabold text-gray-800 tracking-tight">{fmtAmount(totalSelectedAmount)}</span>
                                                        </div>

                                                        {getExcessPaymentError() && (
                                                            <div className="mt-1 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs font-semibold text-red-800 leading-normal animate-fadeIn flex items-start gap-2">
                                                                <svg className="w-4 h-4 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                                                <span>{getExcessPaymentError()}</span>
                                                            </div>
                                                        )}

                                                        {getExcessPaymentInfo() && (
                                                            <div className="mt-1 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs font-semibold text-blue-800 leading-normal animate-fadeIn flex items-start gap-2">
                                                                <svg className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                <span>{getExcessPaymentInfo()}</span>
                                                            </div>
                                                        )}

                                                        {/* PAYMENT MODE SELECTION */}
                                                        <div className="bg-gray-50/50 p-3 rounded-xl border border-gray-200/60">
                                                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Payment Method</label>
                                                                <div className="grid grid-cols-3 gap-2 mb-3">
                                                                    <label className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all ${!effectivePaymentAccess('enableCashPayment') ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'cursor-pointer'} ${paymentCategory === 'Cash' ? 'bg-blue-600 border-blue-600 shadow-sm text-white' : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                                                                        <input type="radio" className="sr-only" name="cat" checked={paymentCategory === 'Cash'} disabled={!effectivePaymentAccess('enableCashPayment')} onChange={() => { setPaymentCategory('Cash'); setPaymentForm({ ...paymentForm, paymentMode: 'Cash' }); }} />
                                                                        <span className={`font-bold text-xs ${paymentCategory === 'Cash' ? 'text-white' : 'text-gray-700'}`}>Cash</span>
                                                                    </label>
                                                                    <label className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all ${!effectivePaymentAccess('enableBankPayment') ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'cursor-pointer'} ${paymentCategory === 'Bank' ? 'bg-blue-600 border-blue-600 shadow-sm text-white' : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                                                                        <input type="radio" className="sr-only" name="cat" checked={paymentCategory === 'Bank'} disabled={!effectivePaymentAccess('enableBankPayment')} onChange={() => {
                                                                            setPaymentCategory('Bank'); 
                                                                            const newState = { ...paymentForm, paymentMode: 'UPI' };
                                                                            
                                                                            // Auto-select if only one config exists for this student's course
                                                                            if (relevantConfigs.length === 1) {
                                                                                newState.paymentConfigId = relevantConfigs[0]._id;
                                                                                newState.bankName = relevantConfigs[0].bank_name;
                                                                            }
                                                                            
                                                                            setPaymentForm(newState);
                                                                        }} />
                                                                        <span className={`font-bold text-xs ${paymentCategory === 'Bank' ? 'text-white' : 'text-gray-700'}`}>Bank</span>
                                                                    </label>
                                                                    <label className={`flex items-center justify-center gap-2 p-2 rounded-lg border transition-all ${(isEditMode || !effectivePaymentAccess('enableSplitPayment')) ? 'opacity-50 cursor-not-allowed bg-gray-100' : 'cursor-pointer'} ${paymentCategory === 'Split' ? 'bg-blue-600 border-blue-600 shadow-sm text-white' : 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                                                                        <input type="radio" className="sr-only" name="cat" checked={paymentCategory === 'Split'} disabled={isEditMode || !effectivePaymentAccess('enableSplitPayment')} onChange={() => {
                                                                            setPaymentCategory('Split'); 
                                                                            const newState = { ...paymentForm, paymentMode: 'UPI' };
                                                                            
                                                                            // Auto-select if only one config exists
                                                                            if (relevantConfigs.length === 1) {
                                                                                newState.paymentConfigId = relevantConfigs[0]._id;
                                                                                newState.bankName = relevantConfigs[0].bank_name;
                                                                            }
                                                                            
                                                                            setPaymentForm(newState);
                                                                            setPerRowSplitCash({}); // reset so table shows fresh inputs
                                                                        }} />
                                                                        <span className={`font-bold text-xs ${paymentCategory === 'Split' ? 'text-white' : 'text-gray-700'}`}>Split</span>
                                                                    </label>
                                                                </div>

                                                                {/* Per-fee-head split input table */}
                                                                {paymentCategory === 'Split' && (
                                                                    <div className="mb-3 bg-blue-50/50 border border-blue-100 rounded-xl p-3 space-y-2">
                                                                       
                                                                        {feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0).map((row) => {
                                                                            const selectedFee = feeDetails.find(f => f._id === row.feeHeadId);
                                                                            const feeLabel = selectedFee
                                                                                ? selectedFee.feeHeadName
                                                                                : (globalFeeHeads.find(h => h._id === row.feeHeadId)?.name || 'Fee');
                                                                            const rowTotal = Number(row.amount) || 0;
                                                                            const cashVal = perRowSplitCash[row.id] !== undefined ? perRowSplitCash[row.id] : '';
                                                                            const bankVal = rowTotal - (Number(cashVal) || 0);
                                                                            const isOverflow = (Number(cashVal) || 0) > rowTotal;
                                                                            return (
                                                                                <div key={row.id} className="bg-white rounded-lg border border-blue-100 p-2 space-y-1">
                                                                                    <div className="flex justify-between items-center">
                                                                                        <span className="text-[11px] font-bold text-gray-700 truncate max-w-[60%]">{feeLabel}</span>
                                                                                        <span className="text-[10px] text-gray-400 font-mono">Total: ₹{fmtAmount(rowTotal)}</span>
                                                                                    </div>
                                                                                    <div className="grid grid-cols-2 gap-2">
                                                                                        <div>
                                                                                            <label className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider block mb-0.5">Cash</label>
                                                                                            <input
                                                                                                type="number"
                                                                                                className={`w-full border rounded-lg p-1.5 text-xs font-bold outline-none focus:ring-1 transition-colors ${isOverflow ? 'border-red-400 bg-red-50 focus:ring-red-400' : 'border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-300'}`}
                                                                                                placeholder="0"
                                                                                                value={cashVal}
                                                                                                onChange={e => {
                                                                                                    const val = e.target.value;
                                                                                                    setPerRowSplitCash(prev => ({ ...prev, [row.id]: val }));
                                                                                                }}
                                                                                                onWheel={e => e.target.blur()}
                                                                                            />
                                                                                            {isOverflow && (
                                                                                                <p className="text-[9px] text-red-500 font-semibold mt-0.5">Exceeds fee amount</p>
                                                                                            )}
                                                                                        </div>
                                                                                        <div>
                                                                                            <label className="text-[9px] font-bold text-indigo-700 uppercase tracking-wider block mb-0.5">Bank</label>
                                                                                            <input
                                                                                                type="number"
                                                                                                className="w-full border border-gray-200 rounded-lg p-1.5 text-xs font-bold bg-gray-100 text-gray-500 outline-none"
                                                                                                value={bankVal < 0 ? 0 : bankVal}
                                                                                                readOnly
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0).length === 0 && (
                                                                            <p className="text-[11px] text-blue-400 text-center py-2 italic">Select fee heads above to enter split amounts.</p>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {(paymentCategory === 'Bank' || paymentCategory === 'Split') && (
                                                                    <div className="space-y-2 animate-fadeIn">
                                                                        {/* Instrument Type Selection */}
                                                                        <div className="grid grid-cols-2 gap-2 mb-2">
                                                                            <div className="col-span-2">
                                                                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center border-b border-gray-200 pb-1">Instrument Details</label>
                                                                            </div>
                                                                            <select
                                                                                className="col-span-2 w-full border border-gray-300 p-2 rounded-lg text-xs bg-white focus:border-blue-500 outline-none font-bold"
                                                                                value={paymentForm.paymentMode}
                                                                                onChange={e => {
                                                                                    const mode = e.target.value;
                                                                                    if (mode === 'RTF' && paymentForm.proceedingId) {
                                                                                        setPaymentForm(prev => applyProceedingBankToForm({ ...prev, paymentMode: mode }, prev.proceedingId));
                                                                                    } else {
                                                                                        setPaymentForm({ ...paymentForm, paymentMode: mode });
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <option value="UPI">UPI / QR Scan</option>
                                                                                <option value="RTF">RTF (Scholarship)</option>
                                                                            </select>
                                                                        </div>

                                                                         {paymentForm.paymentMode === 'RTF' && (
                                                                            <div className="space-y-2 animate-fadeIn">
                                                                                <div>
                                                                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Proceeding *</label>
                                                                                    <select
                                                                                        className="w-full border border-gray-300 p-2 rounded-lg text-xs bg-white focus:border-blue-500 outline-none"
                                                                                        value={paymentForm.proceedingId || ''}
                                                                                        onChange={e => handleProceedingSelect(e.target.value)}
                                                                                        required
                                                                                    >
                                                                                        <option value="">-- Select Proceeding --</option>
                                                                                        {availableProceedings.map(p => {
                                                                                            const isMapped = Boolean(p.studentCount && p.studentCount > 0);
                                                                                            const existingTxAmount = (isEditMode && editingTransaction && editingTransaction.proceedingId === p._id) ? Number(editingTransaction.amount) : 0;
                                                                                            const rem = (p.amount || 0) - (p.totalUsed || 0) + existingTxAmount;
                                                                                            const shareRem = isMapped ? ((p.shareRemaining ?? p.studentShare ?? 0) + existingTxAmount) : rem;
                                                                                            const isExhausted = rem <= 0 || (isMapped && shareRem <= 0);
                                                                                            return (
                                                                                                <option key={p._id} value={p._id} disabled={isExhausted}>
                                                                                                    {p.proceedingNumber} — {isMapped ? `Left ₹${fmtAmount(Math.max(0, shareRem))} of ₹${fmtAmount(p.studentShare || 0)} share · Proc ₹${fmtAmount(Math.max(0, rem))}` : `Proc Rem: ₹${fmtAmount(Math.max(0, rem))}`}{isExhausted ? ' [EXHAUSTED]' : ''}
                                                                                                </option>
                                                                                            );
                                                                                        })}
                                                                                        {isFetchingProceedings && <option disabled>Fetching...</option>}
                                                                                        {!isFetchingProceedings && availableProceedings.length === 0 && <option disabled>No proceedings found</option>}
                                                                                    </select>

                                                                                    {paymentForm.proceedingId && (() => {
                                                                                        const selProc = availableProceedings.find(p => p._id === paymentForm.proceedingId);
                                                                                        if (!selProc) return null;
                                                                                        const isMapped = Boolean(selProc.studentCount && selProc.studentCount > 0);
                                                                                        const existingTxAmount = (isEditMode && editingTransaction && editingTransaction.proceedingId === selProc._id) ? Number(editingTransaction.amount) : 0;
                                                                                        const rem = (selProc.amount || 0) - (selProc.totalUsed || 0) + existingTxAmount;
                                                                                        const shareRem = isMapped ? ((selProc.shareRemaining ?? selProc.studentShare ?? 0) + existingTxAmount) : rem;
                                                                                        const maxAllowed = isMapped ? Math.min(rem, shareRem) : rem;
                                                                                        const isExhausted = rem <= 0 || (isMapped && shareRem <= 0);

                                                                                        const validRows = feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0);
                                                                                        let currentRtfInput = 0;
                                                                                        if (paymentCategory === 'Bank') {
                                                                                            currentRtfInput = validRows.reduce((sum, r) => sum + Number(r.amount), 0);
                                                                                        } else if (paymentCategory === 'Split') {
                                                                                            currentRtfInput = validRows.reduce((sum, r) => {
                                                                                                const rowTotal = Number(r.amount);
                                                                                                const cashVal = Number(perRowSplitCash[r.id]) || 0;
                                                                                                return sum + Math.max(0, rowTotal - cashVal);
                                                                                            }, 0);
                                                                                        }

                                                                                        const isExceeding = currentRtfInput > maxAllowed;

                                                                                        return (
                                                                                            <div className={`mt-1.5 p-2 rounded-lg text-xs space-y-1 ${isExceeding || isExhausted ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>
                                                                                                {isMapped ? (
                                                                                                    <>
                                                                                                        <div className="flex justify-between items-center font-bold">
                                                                                                            <span>Your Share Remaining: ₹{fmtAmount(Math.max(0, shareRem))}</span>
                                                                                                            <span className="text-[10px] font-mono opacity-80">Fixed: ₹{fmtAmount(selProc.studentShare || 0)}</span>
                                                                                                        </div>
                                                                                                        <div className="flex justify-between items-center text-[10px] opacity-90">
                                                                                                            <span>Proceeding Balance: ₹{fmtAmount(Math.max(0, rem))}</span>
                                                                                                            <span className="font-mono">Max RTF: ₹{fmtAmount(Math.max(0, maxAllowed))}</span>
                                                                                                        </div>
                                                                                                    </>
                                                                                                ) : (
                                                                                                    <div className="flex justify-between items-center font-bold">
                                                                                                        <span>Proceeding Remaining Balance: ₹{fmtAmount(Math.max(0, rem))}</span>
                                                                                                        <span className="text-[10px] font-mono opacity-80">Legacy / Unmapped Proceeding</span>
                                                                                                    </div>
                                                                                                )}
                                                                                                {selProc.txnPending && selProc.txnPendingReason && (
                                                                                                    <p className="text-[10px] font-semibold text-amber-700">Pending auto-txn: {selProc.txnPendingReason}</p>
                                                                                                )}
                                                                                                {isExhausted && (
                                                                                                    <p className="text-[10px] font-semibold text-red-600">⚠️ Proceeding balance is exhausted.</p>
                                                                                                )}
                                                                                                {!isExhausted && isExceeding && (
                                                                                                    <p className="text-[10px] font-semibold text-red-600">⚠️ RTF Amount (₹{fmtAmount(currentRtfInput)}) exceeds available proceeding balance (₹{fmtAmount(maxAllowed)}).</p>
                                                                                                )}
                                                                                            </div>
                                                                                        );
                                                                                    })()}
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {/* Target Account — hidden dropdown for RTF; proceeding account only */}
                                                                        {paymentForm.paymentMode === 'RTF' ? (
                                                                            (() => {
                                                                                const rtfProceeding = paymentForm.proceedingId
                                                                                    ? availableProceedings.find(p => p._id === paymentForm.proceedingId)
                                                                                    : null;
                                                                                const proceedingConfig = rtfProceeding ? resolveConfigForProceeding(rtfProceeding) : null;
                                                                                return (
                                                                                    <div>
                                                                                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                                                                            Deposit Account (from proceeding)
                                                                                        </label>
                                                                                        {!rtfProceeding ? (
                                                                                            <div className="w-full border border-dashed border-slate-200 bg-slate-50 p-2 rounded-lg text-xs text-slate-500 italic">
                                                                                                Select a proceeding above — bank account is set automatically.
                                                                                            </div>
                                                                                        ) : proceedingConfig ? (
                                                                                            <div className="w-full border border-emerald-200 bg-emerald-50 p-2 rounded-lg text-xs font-bold text-emerald-800">
                                                                                                {proceedingConfig.account_name} — {proceedingConfig.account_number} ({proceedingConfig.bank_name})
                                                                                            </div>
                                                                                        ) : (
                                                                                            <div className="w-full border border-amber-200 bg-amber-50 p-2 rounded-lg text-xs font-semibold text-amber-800">
                                                                                                {rtfProceeding.bankAccount || '—'}
                                                                                                <span className="block text-[10px] font-normal mt-0.5">Not found in Payment Settings — add this account name in Payment Config.</span>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })()
                                                                        ) : (
                                                                        <div>
                                                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Target Account *</label>
                                                                            <select
                                                                                className={`w-full border p-2 rounded-lg text-xs bg-white focus:border-blue-500 outline-none ${(paymentCategory === 'Bank' || paymentCategory === 'Split') && !paymentForm.paymentConfigId ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-300'}`}
                                                                                value={paymentForm.paymentConfigId}
                                                                                onChange={e => {
                                                                                    const selected = paymentConfigs.find(c => c._id === e.target.value);
                                                                                    setPaymentForm({
                                                                                        ...paymentForm,
                                                                                        paymentConfigId: e.target.value,
                                                                                        bankName: selected ? selected.bank_name : paymentForm.bankName
                                                                                    });
                                                                                }}
                                                                                required
                                                                            >
                                                                                <option value="">-- Select Account --</option>
                                                                                {relevantConfigs.map(c => (
                                                                                    <option key={c._id} value={c._id}>
                                                                                        {c.account_name} - {c.account_number} ({c.bank_name})
                                                                                    </option>
                                                                                ))}
                                                                                {relevantConfigs.length === 0 && student && (
                                                                                    <option disabled className="text-red-500">No accounts linked to {student.course}</option>
                                                                                )}
                                                                            </select>
                                                                        </div>
                                                                        )}
                                                                        {paymentForm.paymentMode === 'UPI' && (
                                                                            <div className="grid grid-cols-2 gap-2">
                                                                                <div>
                                                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Reference Number *</label>
                                                                                    <input type="text" className="w-full border p-2 rounded-lg text-xs bg-white outline-none focus:border-blue-500" placeholder="e.g. Transaction ID" value={paymentForm.referenceNo || ''} onChange={e => setPaymentForm({ ...paymentForm, referenceNo: e.target.value })} required />
                                                                                </div>
                                                                                <div>
                                                                                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1" title="Date the explicit transfer was actually made by the student">Reference Date *</label>
                                                                                    <input type="date" className="w-full border p-2 rounded-lg text-xs bg-white outline-none focus:border-blue-500" value={paymentForm.referenceDate || ''} onChange={e => setPaymentForm({ ...paymentForm, referenceDate: e.target.value })} required />
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>

                                                        {canEditTransactionDate && (
                                                            <div className="mb-3">
                                                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                                                    Collection / Transaction Date
                                                                </label>
                                                                <input
                                                                    type="date"
                                                                    className="w-full border rounded-xl p-2.5 text-xs outline-none transition-all border-gray-300 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20"
                                                                    value={paymentForm.paymentDate || ''}
                                                                    onChange={e => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })}
                                                                    title="You can change the transaction date. Backdated payments will not appear in today's report."
                                                                    required
                                                                />
                                                            </div>
                                                        )}

                                                        <div className="mb-3">
                                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                                Remarks / Notes (Optional)
                                                            </label>
                                                            <textarea
                                                                className="w-full border border-gray-200 rounded-xl p-3 text-xs bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-none"
                                                                rows="2"
                                                                placeholder="Add any additional notes here..."
                                                                value={paymentForm.remarks || ''}
                                                                onChange={e => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                                                            ></textarea>
                                                        </div>

                                                        <div className="pt-2">
                                                            <button
                                                                type="submit"
                                                                disabled={isProcessing}
                                                                className="w-full py-3 rounded-xl text-white font-bold shadow-md transition-all transform active:scale-95 bg-blue-600 hover:bg-blue-700 shadow-blue-200 disabled:opacity-50"
                                                            >
                                                                {isProcessing ? (isEditMode ? 'Updating...' : 'Processing...') : (isEditMode ? 'Update Payment Details' : 'Confirm Payment')}
                                                            </button>
                                                        </div>
                                                    </form>
                                                ) : (
                                                    <form onSubmit={handleTransferFee} className="space-y-3">
                                                        {/* Source Transaction Select */}
                                                        <div className="mb-3">
                                                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                                Select Source Transaction
                                                            </label>
                                                            {(() => {
                                                                const transferableTransactions = transactions.filter(t => t.status === 'active' && t.paymentMode !== 'Transfer' && t.transactionType === 'DEBIT');
                                                                if (transferableTransactions.length === 0) {
                                                                    return (
                                                                        <div className="p-3 text-xs bg-gray-50 border border-gray-100 rounded-xl text-gray-500 font-medium text-center">
                                                                            No transferable active transactions found for this student.
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <select
                                                                        className="w-full border border-gray-300 rounded-xl p-2.5 text-xs bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                                                        value={transferForm.sourceTxId || ''}
                                                                        onChange={e => {
                                                                            const txId = e.target.value;
                                                                            const found = transferableTransactions.find(t => t._id === txId);
                                                                            setTransferForm(prev => ({
                                                                                ...prev,
                                                                                sourceTxId: txId,
                                                                                amount: found ? found.amount : '',
                                                                                sourceFeeHeadName: found?.feeHead?.name || 'Unknown'
                                                                            }));

                                                                            if (found) {
                                                                                setTransferRows([
                                                                                    { id: Date.now(), targetFeeHeadId: '', studentYear: '', semester: 'All', amount: found.amount, targetFeeId: '' }
                                                                                ]);
                                                                            }
                                                                        }}
                                                                        required
                                                                    >
                                                                        <option value="">-- Choose Transaction to Transfer --</option>
                                                                        {transferableTransactions.map(t => {
                                                                            const dt = t.paymentDate ? new Date(t.paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
                                                                            return (
                                                                                <option key={t._id} value={t._id}>
                                                                                    {dt} › {t.receiptNumber || 'No Rec'} › {t.feeHead?.name || 'Unknown'} (₹{t.amount.toLocaleString('en-IN')})
                                                                                </option>
                                                                            );
                                                                        })}
                                                                    </select>
                                                                );
                                                            })()}
                                                        </div>

                                                        {transferForm.sourceTxId && (
                                                             <>
                                                                 {/* Transaction details card with excess/standard rule helper */}
                                                                 {(() => {
                                                                     const selectedSourceTx = transactions.find(t => t._id === transferForm.sourceTxId);
                                                                     if (!selectedSourceTx) return null;
                                                                     const sourceFeeHeadId = String(selectedSourceTx.feeHead?._id || selectedSourceTx.feeHead || '');
                                                                     const sourceFeeHeadName = (selectedSourceTx.feeHeadName || selectedSourceTx.feeHead?.name || '').toLowerCase();
                                                                     const configuredExcessHeadId = String(receiptSettings?.excessFeeHead || '');
                                                                     const isExcess = (configuredExcessHeadId && sourceFeeHeadId === configuredExcessHeadId) || sourceFeeHeadName.includes('excess');

                                                                     return (
                                                                         <div className="p-3 bg-blue-50/50 border border-blue-100 rounded-xl space-y-1.5 text-xs mb-3">
                                                                             <div className="flex justify-between items-center">
                                                                                 <span className="text-gray-500 font-medium">Original Fee Head:</span>
                                                                                 <span className="font-bold text-gray-800 flex items-center gap-1.5">
                                                                                     {transferForm.sourceFeeHeadName}
                                                                                     {isExcess ? (
                                                                                         <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase">Excess Head</span>
                                                                                     ) : (
                                                                                         <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-bold uppercase">Standard Head</span>
                                                                                     )}
                                                                                 </span>
                                                                             </div>
                                                                             <div className="flex justify-between">
                                                                                 <span className="text-gray-500 font-medium">Transfer Amount:</span>
                                                                                 <span className="font-bold text-blue-700 font-mono">₹{Number(transferForm.amount).toLocaleString('en-IN')}</span>
                                                                             </div>
                                                                             <div className="text-[10.5px] text-gray-500 pt-1 border-t border-blue-100/60 leading-tight">
                                                                                 <span className="text-emerald-700 font-medium">✓ Active fee transactions can be transferred to any target fee head, student year, or semester.</span>
                                                                             </div>
                                                                         </div>
                                                                     );
                                                                 })()}

                                                                 {/* Split Targets Section */}
                                                                 <div className="mb-4 mt-3">
                                                                     <div className="flex justify-between items-center mb-2">
                                                                         <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                                                             Transfer Destination(s)
                                                                         </label>
                                                                         <button
                                                                             type="button"
                                                                             onClick={addTransferRow}
                                                                             className="bg-blue-50 text-blue-600 px-2 py-1 rounded text-[10px] font-bold hover:bg-blue-100 transition duration-150 flex items-center gap-1 shadow-sm border border-blue-200"
                                                                             title="Add Split Target"
                                                                         >
                                                                             <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                                                             Add Split
                                                                         </button>
                                                                     </div>

                                                                     <div className="space-y-3">
                                                                         {transferRows.map((row, index) => {
                                                                             const configuredFeeHeadIds = new Set(feeDetails.filter(f => f.totalAmount > 0).map(f => f.feeHeadId));
                                                                             const extraGlobalHeads = globalFeeHeads.filter(h => h.isActive !== false && !configuredFeeHeadIds.has(h._id));

                                                                             const selectedFee = feeDetails.find(f => f._id === row.targetFeeId);
                                                                             const isGlobalSelected = !selectedFee && row.targetFeeHeadId && globalFeeHeads.some(h => h._id === row.targetFeeHeadId);

                                                                             const selectedSourceTx = transactions.find(t => t._id === transferForm.sourceTxId);
                                                                             const sourceFeeHeadId = selectedSourceTx ? String(selectedSourceTx.feeHead?._id || selectedSourceTx.feeHead || '') : '';
                                                                             const sourceFeeHeadName = selectedSourceTx ? (selectedSourceTx.feeHeadName || selectedSourceTx.feeHead?.name || '').toLowerCase() : '';
                                                                             const configuredExcessHeadId = String(receiptSettings?.excessFeeHead || '');
                                                                             const isSourceExcess = selectedSourceTx ? ((configuredExcessHeadId && sourceFeeHeadId === configuredExcessHeadId) || sourceFeeHeadName.includes('excess')) : true;

                                                                             return (
                                                                                 <div key={row.id} className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-2 relative group">
                                                                                     {transferRows.length > 1 && (
                                                                                         <button
                                                                                             type="button"
                                                                                             onClick={() => removeTransferRow(row.id)}
                                                                                             className="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors bg-white rounded-full p-0.5 border border-gray-100 shadow-sm"
                                                                                             title="Remove Row"
                                                                                         >
                                                                                             <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                                                         </button>
                                                                                     )}

                                                                                     {/* Select Fee Destination */}
                                                                                     <div>
                                                                                         <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Select Target Fee Head</label>
                                                                                         <select
                                                                                             className="w-full border border-gray-300 rounded-lg p-2 text-xs bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all font-medium"
                                                                                             value={row.targetFeeId || row.targetFeeHeadId || ''}
                                                                                             onChange={e => updateTransferRow(row.id, 'targetFeeId', e.target.value)}
                                                                                             required
                                                                                         >
                                                                                             <option value="">-- Choose Target Fee --</option>
                                                                                             {feeDetails.filter(f => f.totalAmount > 0).length > 0 && (
                                                                                                 <optgroup label="── Structured Fees ──">
                                                                                                     {feeDetails
                                                                                                         .filter(f => f.totalAmount > 0)
                                                                                                         .map(f => (
                                                                                                             <option key={f._id} value={f._id}>
                                                                                                                 [{f.academicYear}] (Yr {f.studentYear}) {f.feeHeadName} (Due: {f.dueAmount})
                                                                                                             </option>
                                                                                                         ))
                                                                                                     }
                                                                                                 </optgroup>
                                                                                             )}
                                                                                             {extraGlobalHeads.length > 0 && (
                                                                                                 <optgroup label="── Global Fee Heads ──">
                                                                                                     {extraGlobalHeads.map(h => (
                                                                                                         <option key={h._id} value={h._id}>
                                                                                                             {h.name} {h.code ? '(' + h.code + ')' : ''}
                                                                                                         </option>
                                                                                                     ))}
                                                                                                 </optgroup>
                                                                                             )}
                                                                                         </select>
                                                                                     </div>

                                                                                     {/* Year & Semester Fields for Global Fee Heads or Manual Override */}
                                                                                     {(isGlobalSelected || !row.targetFeeId) && (
                                                                                         <div className="grid grid-cols-2 gap-2">
                                                                                             <div>
                                                                                                 <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Target Student Year *</label>
                                                                                                 <select
                                                                                                     className="w-full border border-gray-300 rounded-lg p-1.5 text-xs bg-white focus:border-blue-500 outline-none font-bold"
                                                                                                     value={row.studentYear || ''}
                                                                                                     onChange={e => updateTransferRow(row.id, 'studentYear', e.target.value)}
                                                                                                     required
                                                                                                 >
                                                                                                     <option value="">-- Select Year --</option>
                                                                                                     <option value="1">1st Year</option>
                                                                                                     <option value="2">2nd Year</option>
                                                                                                     <option value="3">3rd Year</option>
                                                                                                     <option value="4">4th Year</option>
                                                                                                 </select>
                                                                                             </div>
                                                                                             <div>
                                                                                                 <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Semester</label>
                                                                                                 <select
                                                                                                     className="w-full border border-gray-300 rounded-lg p-1.5 text-xs bg-white focus:border-blue-500 outline-none"
                                                                                                     value={row.semester || 'All'}
                                                                                                     onChange={e => updateTransferRow(row.id, 'semester', e.target.value)}
                                                                                                     required
                                                                                                 >
                                                                                                     <option value="All">All</option>
                                                                                                     <option value="1">1st Sem</option>
                                                                                                     <option value="2">2nd Sem</option>
                                                                                                 </select>
                                                                                             </div>
                                                                                         </div>
                                                                                     )}

                                                                                     {/* Amount Field */}
                                                                                     <div>
                                                                                         <label className="block text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Transfer Amount</label>
                                                                                         <input
                                                                                             type="number"
                                                                                             className="w-full border border-gray-300 rounded-lg p-1.5 text-xs font-bold text-slate-800 focus:border-blue-500 outline-none"
                                                                                             placeholder="₹ Enter amount..."
                                                                                             value={row.amount || ''}
                                                                                             onChange={e => updateTransferRow(row.id, 'amount', e.target.value)}
                                                                                             onWheel={e => e.target.blur()}
                                                                                             required
                                                                                         />
                                                                                     </div>
                                                                                 </div>
                                                                             );
                                                                         })}
                                                                     </div>
                                                                 </div>

                                                                 {/* Remarks textarea */}
                                                                 <div className="mb-3">
                                                                     <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                                                                         Reason / Remarks
                                                                     </label>
                                                                     <textarea
                                                                         className="w-full border border-gray-200 rounded-xl p-3 text-xs bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-none"
                                                                         rows="3"
                                                                         placeholder="Reason for transfer (required)..."
                                                                         value={transferForm.remarks || ''}
                                                                         onChange={e => setTransferForm(prev => ({ ...prev, remarks: e.target.value }))}
                                                                         required
                                                                     />
                                                                 </div>

                                                                 {/* Submit button */}
                                                                 <div className="pt-2">
                                                                     <button
                                                                         type="submit"
                                                                         disabled={isProcessing}
                                                                         className="w-full py-3 rounded-xl text-white font-bold shadow-md transition-all transform active:scale-95 bg-blue-600 hover:bg-blue-700 shadow-blue-200 disabled:opacity-50"
                                                                     >
                                                                         {isProcessing ? 'Processing Transfer...' : 'Execute Transfer'}
                                                                     </button>
                                                                 </div>
                                                             </>
                                                          )}
                                                      </form>
                                                  )}
                                            </div>
                                        </div>
                                    </div>
                                    )}
                                    </div>
                                )}
                            </div>
                        )
                    )}


                {/* Modals placed at root */}
                {showConfirmModal && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
                            <div className="bg-gray-50 border-b border-gray-100 p-4 flex justify-between items-center">
                                <h3 className="font-bold text-lg text-gray-800">
                                    {isEditMode ? 'Confirm Transaction Update' : 'Confirm Transaction'}
                                </h3>
                                <button onClick={() => setShowConfirmModal(false)} className="text-gray-400 hover:text-gray-600"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                            <div className="p-6">
                                <div className="text-center mb-6">
                                    <div className="text-sm text-gray-500 uppercase tracking-wider font-bold mb-1">Total Amount</div>
                                    <div className="text-4xl font-extrabold text-blue-600">{fmtAmount(totalSelectedAmount)}</div>
                                </div>
                                <div className="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-100 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Student:</span>
                                        <span className="font-bold text-gray-800">{student.student_name}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Mode:</span>
                                        <span className="font-bold text-gray-800">{paymentForm.paymentMode}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Transaction Date:</span>
                                        <span className="font-bold text-gray-800">
                                            {paymentForm.paymentDate
                                                ? new Date(paymentForm.paymentDate + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                                                : 'Today'}
                                        </span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Verification:</span>
                                        <span className="font-bold text-gray-800">{feeRows.filter(r => r.feeHeadId && r.amount !== '' && Number(r.amount) >= 0).length} Fee Heads</span>
                                    </div>

                                    {previewLoading && (
                                        <div className="flex items-center justify-center gap-2 py-2 text-xs text-blue-600 font-medium border-t border-gray-200/60 pt-2 mt-2">
                                            <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent"></div>
                                            Loading next sequence...
                                        </div>
                                    )}

                                    {sequencePreview?.enableCustom && sequencePreview.previewSequences && (
                                        <div className="border-t border-gray-200/60 pt-2 mt-2">
                                            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Next Receipt Number(s)</div>
                                            <div className="space-y-1.5 font-mono text-xs">
                                                {sequencePreview.previewSequences.map((p, idx) => (
                                                    <div key={idx} className="flex justify-between bg-blue-50/50 p-2 rounded border border-blue-100">
                                                        <span className="text-gray-600 font-sans font-bold">{p.groupName}:</span>
                                                        <span className="font-bold text-blue-700">{p.nextReceiptNo}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={confirmAndPay}
                                    disabled={isProcessing}
                                    className={`w-full mt-6 py-3 rounded-xl text-white font-bold text-lg shadow-lg transform transition flex items-center justify-center gap-2 ${isProcessing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}
                                >
                                    {isProcessing ? (
                                        <>
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                            Processing...
                                        </>
                                    ) : 'Proceed'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Receipt Modal */}
                {showReceiptModal && lastTransaction && (
                    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fadeIn">
                        <div className="relative w-full max-w-sm">
                            {/* Success Header Card */}
                            <div className="bg-white p-8 rounded-3xl shadow-2xl border border-green-100 w-full max-w-sm text-center animate-scaleUp">
                                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl shadow-inner">
                                    ✅
                                </div>
                                <h2 className="text-2xl font-extrabold text-gray-800 mb-2">Payment Successful!</h2>
                                <p className="text-sm text-gray-500 mb-8 px-4">The transaction has been recorded successfully. You can now download or print the receipt.</p>

                                <div className="space-y-3">
                                    <button
                                        onClick={handlePrintReceipt}
                                        className="w-full bg-blue-600 text-white px-6 py-4 rounded-2xl font-bold hover:bg-blue-700 flex items-center justify-center gap-3 shadow-xl shadow-blue-200 transition-all transform active:scale-95 text-lg"
                                    >
                                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                        PRINT RECEIPT
                                    </button>

                                    <button
                                        onClick={() => setShowReceiptModal(false)}
                                        className="w-full bg-gray-50 text-gray-600 px-6 py-3 rounded-2xl font-bold hover:bg-gray-100 transition-colors text-sm"
                                    >
                                        DONE
                                    </button>
                                </div>
                            </div>

                            {/* Hidden Receipt (Accessible by Ref) */}
                            <div className="hidden">
                                <ReceiptTemplate
                                    ref={receiptRef}
                                    transaction={lastTransaction}
                                    relatedTransactions={relatedTransactions}
                                    student={student}
                                    settings={{ ...(receiptSettings || {}), orientation: printOrientation }}
                                    totalDue={totalDueAmount}
                                />
                            </div>
                        </div>
                    </div>
                )}

                {/* Photo Popup Modal */}
                {showPhotoPopup && student && student.student_photo && (
                    <div 
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fadeIn"
                        onClick={() => setShowPhotoPopup(false)}
                    >
                        <div 
                            className="relative bg-white p-2 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden animate-scaleUp flex flex-col items-center"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header with Title and Close Button */}
                            <div className="w-full flex justify-between items-center px-4 py-2 border-b border-gray-100">
                                <h3 className="font-bold text-gray-800 truncate">{student.student_name}</h3>
                                <button 
                                    onClick={() => setShowPhotoPopup(false)} 
                                    className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
                                >
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            
                            {/* Image Container */}
                            <div className="w-full bg-gray-50 flex items-center justify-center overflow-hidden rounded-xl mt-2 p-1">
                                <img
                                    src={student.student_photo.startsWith('data:') ? student.student_photo : `data:image/jpeg;base64,${student.student_photo}`}
                                    alt="Student Preview"
                                    className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-sm"
                                />
                            </div>
                            
                            {/* Student Metadata footer */}
                            <div className="w-full px-4 py-3 bg-gray-50/50 mt-2 rounded-xl flex justify-between text-xs text-gray-500 font-medium">
                                <span>Adm No: <span className="font-bold text-gray-700">{student.admission_number}</span></span>
                                <span>Course: <span className="font-bold text-gray-700">{student.course} - {student.branch}</span></span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Cancel Confirmation Modal */}
                {showDeleteModal && txToDelete && (
                    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[80] flex items-center justify-center p-4 animate-fadeIn">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scaleUp">
                            {/* Header */}
                            <div className="bg-orange-50 border-orange-100 border-b p-4 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                                    <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                                </div>
                                <div className="flex-1">
                                    <h3 className="font-bold text-gray-800 text-base">Cancel Transaction</h3>
                                    <p className="text-xs font-medium text-orange-500">
                                        Transaction will be marked as cancelled
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setShowDeleteModal(false); setTxToDelete(null); }}
                                    className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                            {/* Body */}
                            <div className="p-5 space-y-4">
                                <p className="text-sm text-gray-600">
                                    This transaction will be cancelled and marked as void. The receipt number will be preserved in sequence.
                                </p>
                                <div className="bg-gray-50 rounded-xl border border-gray-100 p-4 space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Receipt No:</span>
                                        <span className="font-bold text-gray-800 font-mono">{txToDelete.receiptNumber}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Fee Head:</span>
                                        <span className="font-bold text-gray-800">{txToDelete.feeHead?.name || 'N/A'}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Payment Mode:</span>
                                        <span className="font-bold text-gray-800">{txToDelete.paymentMode}</span>
                                    </div>
                                    <div className="flex justify-between border-t border-gray-200 pt-2 mt-1">
                                        <span className="text-gray-500 font-semibold">Amount:</span>
                                        <span className="font-extrabold text-base text-orange-600">₹{Number(txToDelete.amount).toLocaleString('en-IN')}</span>
                                    </div>
                                    <div className="space-y-1 mt-3 text-left">
                                        <label className="text-[11px] font-bold text-gray-500 block">
                                            Cancellation Reason <span className="text-red-500">*</span>
                                        </label>
                                        <textarea
                                            rows={2}
                                            value={cancelReason}
                                            onChange={(e) => setCancelReason(e.target.value)}
                                            placeholder="Enter reason (e.g. incorrect amount, wrong category)..."
                                            className={`w-full text-xs border rounded-xl p-2.5 focus:ring-1 outline-none resize-none font-medium text-gray-700 bg-white transition-colors ${cancelReason.trim() ? 'border-gray-200 focus:ring-orange-500 focus:border-orange-500' : 'border-red-300 focus:ring-red-400 focus:border-red-400'}`}
                                        />
                                        {!cancelReason.trim() && (
                                            <p className="text-[10px] text-red-500 font-semibold">Reason is required to cancel a transaction.</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-3 pt-1">
                                    <button
                                        onClick={() => { setShowDeleteModal(false); setTxToDelete(null); }}
                                        disabled={isDeleting}
                                        className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={confirmDeleteTransaction}
                                        disabled={isDeleting || !cancelReason.trim()}
                                        className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm shadow transition flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed active:scale-95 bg-orange-500 hover:bg-orange-600"
                                    >
                                        {isDeleting ? (
                                            <><div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div> Cancelling...</>
                                        ) : (
                                            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg> Cancel Transaction</>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Custom Toast Alert */}
                {toast && (
                    <div className={`fixed top-5 right-5 z-[100] flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl transition-all duration-300 transform translate-y-0 ${
                        toast.type === 'success' 
                            ? 'bg-green-50 border-green-200 text-green-800' 
                            : 'bg-red-50 border-red-200 text-red-800'
                    }`}>
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                        }`}>
                            {toast.type === 'success' ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                            )}
                        </div>
                        <div>
                            <p className="text-sm font-bold">{toast.type === 'success' ? 'Success' : 'Error'}</p>
                            <p className="text-xs font-semibold text-gray-600 mt-0.5">{toast.message}</p>
                        </div>
                        <button onClick={() => setToast(null)} className="text-gray-400 hover:text-gray-600 ml-2">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
};

// Sub-component for Row (Kept same)
const TransactionRow = ({ transaction, allTransactions, student, totalDue, settings, onEdit, onDelete }) => {
    const loggedInUser = JSON.parse(localStorage.getItem('user'));
    const isSuperAdmin = loggedInUser?.role === 'superadmin';
    const hasEditPermission = loggedInUser?.permissions?.includes('fee_collection_edit') || isSuperAdmin;
    const hasDeletePermission = loggedInUser?.permissions?.includes('fee_collection_delete') || isSuperAdmin;
    const isCancelled = transaction.status === 'cancelled';
    const showEditButton = hasEditPermission && transaction.transactionType !== 'CREDIT' && !isCancelled;
    const showDeleteButton = hasDeletePermission && transaction.transactionType !== 'CREDIT' && !isCancelled;

    const [showPreview, setShowPreview] = useState(false);
    const printRef = useRef();

    // Identify if this is part of a batch.
    // In our backend, we group by 'receiptNumber' usually.
    // Let's assume all transactions with same receiptNumber (and same time) are a batch.
    const allSiblings = allTransactions.filter(t => t.receiptNumber === transaction.receiptNumber);
    const activeSiblings = allSiblings.filter(t => t.status !== 'transferred');
    const batchSiblings = activeSiblings.length > 0 ? activeSiblings : allSiblings;
    const isBatch = batchSiblings.length > 1;

    const handlePrint = async () => {
        try {
            const response = await api.post('/print', {
                template: 'fee-receipt',
                data: {
                    receiptId: transaction._id
                }
            });
            printHtmlDocument(response.data);
            setShowPreview(false);
        } catch (err) {
            console.error('Print failed:', err);
            alert('Failed to generate print document');
        }
    };

    return (
        <tr className={`transition-colors group ${isCancelled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}`}>
            <td className="py-1.5 px-3 text-[11px] text-gray-500 whitespace-nowrap">
                <div className="font-semibold text-gray-800">{formatDateDDMonthYYYY(transaction.paymentDate || transaction.createdAt)}</div>
                <div className="text-[9px] text-gray-400">{new Date(transaction.paymentDate || transaction.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                {transaction.referenceDate && (
                    <div className="text-[9px] text-blue-600 mt-0.5" title="Original Transfer Date">
                        Ref: {formatDateDDMonthYYYY(transaction.referenceDate)}
                    </div>
                )}
            </td>
            <td className="py-1.5 px-3 text-[11px] font-medium text-gray-800">
                <span className={isCancelled ? 'line-through text-gray-400' : ''}>{transaction.feeHead ? transaction.feeHead.name : 'Unknown Fee'}</span>
                {isCancelled && (
                    <span className="ml-1.5 inline-block px-1 py-0.5 rounded text-[8px] font-bold bg-red-100 text-red-600 border border-red-200 uppercase tracking-wide">Cancelled</span>
                )}
            </td>
            <td className="py-1.5 px-3 text-[11px] text-gray-500 font-mono whitespace-nowrap">
                <span className={isCancelled ? 'line-through text-gray-400' : ''}>{transaction.receiptNumber}</span>
            </td>
            <td className="py-1.5 px-3 text-center">
                <span className="px-1.5 py-0.5 rounded text-[9px] border border-gray-200 bg-white text-gray-600">
                    {transaction.paymentMode}
                </span>
                {transaction.referenceNo && (
                    <div className="text-[9px] text-gray-500 mt-0.5 max-w-[100px] truncate mx-auto" title={`Ref No: ${transaction.referenceNo}`}>
                        {transaction.referenceNo}
                    </div>
                )}
            </td>
            <td className="py-1.5 px-3 text-center text-[11px] text-gray-500">
                {transaction.studentYear ? `Yr ${transaction.studentYear}` : '-'}
            </td>
            <td className={`py-1.5 px-3 text-[11px] font-bold text-right font-mono ${isCancelled ? 'line-through text-gray-400' : transaction.transactionType === 'CREDIT' ? 'text-purple-600' : 'text-green-600'}`}>
                {transaction.transactionType === 'CREDIT' ? '-' : '+'}{fmtAmount(transaction.amount)}
            </td>
            <td className="py-1.5 px-3 text-[11px] text-gray-500 max-w-[150px] truncate" title={transaction.remarks}>
                {transaction.remarks || '-'}
            </td>
            <td className="py-1.5 px-3 text-right whitespace-nowrap">
                {showEditButton && (
                    <button
                        onClick={() => onEdit(transaction)}
                        className="text-amber-600 hover:text-amber-800 hover:bg-amber-50 p-1 rounded transition mr-0.5"
                        title="Edit Transaction Payment Mode"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </button>
                )}
                {showDeleteButton && (
                    <button
                        onClick={() => onDelete(transaction)}
                        className="text-orange-500 hover:text-orange-700 hover:bg-orange-50 p-1 rounded transition mr-0.5"
                        title="Cancel Transaction"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    </button>
                )}
                <button
                    onClick={() => setShowPreview(true)}
                    className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1 rounded transition"
                    title="Print Receipt"
                >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                </button>

                {/* Hidden Print Template */}
                {showPreview && (
                    <div className="hidden">
                        <ReceiptTemplate
                            ref={printRef}
                            transaction={transaction}
                            relatedTransactions={batchSiblings} // Pass all siblings for full receipt
                            student={student}
                            settings={settings}
                            totalDue={totalDue}
                        />
                    </div>
                )}
                {/* Auto-trigger print when preview opens. 
                    Actually useReactToPrint doesn't auto-trigger by just rendering. 
                    We need to call handlePrint(). 
                    We can use a small effect or just call it directly.
                */}
                {showPreview && <PrintTrigger trigger={handlePrint} />}
            </td>
        </tr>
    );
};

const PrintTrigger = ({ trigger }) => {
    useEffect(() => {
        trigger();
    }, []);
    return null;
};

export default FeeCollection;
