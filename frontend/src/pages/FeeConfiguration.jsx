import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../lib/api';
import { Pencil, Trash2, Calendar, ChevronRight, ChevronDown, ChevronUp, AlertTriangle, RefreshCw, ToggleLeft, ToggleRight, BookOpen, Settings, ArrowRight, CheckCircle2, Info, Clock, Database, AlertCircle, ShieldAlert, Layers } from 'lucide-react';
import Sidebar from './Sidebar';
import FeeConfigPrintButton from '../components/FeeConfigPrintButton';
import ServiceLateFeeConfigPanel from '../components/ServiceLateFeeConfigPanel';
import HostelConfiguration from './HostelConfiguration';
import TransportConfiguration from './TransportConfiguration';
import Swal from 'sweetalert2';

const FeeConfiguration = () => {
    const location = useLocation();
    const VALID_TABS = ['heads', 'groups', 'definitions', 'latefees'];

    const getTabFromHash = (hash) => {
        const cleaned = (hash || '').replace('#', '');
        return VALID_TABS.includes(cleaned) ? cleaned : 'heads';
    };

    const [activeTab, setActiveTab] = useState(() => getTabFromHash(location.hash));

    useEffect(() => {
        const tab = getTabFromHash(location.hash);
        setActiveTab(tab);
    }, [location.hash]);

    const handleTabChange = (tabId) => {
        setActiveTab(tabId);
        window.location.hash = tabId;
    };

    // --- SHARED STATE ---
    const [feeHeads, setFeeHeads] = useState([]);

    // --- TAB 1B: FEE GROUPS ---
    const [feeGroups, setFeeGroups] = useState([]);
    const [groupForm, setGroupForm] = useState({ name: '', code: '', description: '', feeHeads: [] });
    const [editGroupId, setEditGroupId] = useState(null);
    const [isSavingGroup, setIsSavingGroup] = useState(false);
    const [categories, setCategories] = useState([]);
    const [categoryMapping, setCategoryMapping] = useState({}); // Mapping of category per college|course|batch
    const [metadata, setMetadata] = useState({});
    const [collegeCodes, setCollegeCodes] = useState({});
    const [message, setMessage] = useState('');
    const [calendarData, setCalendarData] = useState([]);
    const [isSavingLateFee, setIsSavingLateFee] = useState(false);
    const [lateFeeSubTab, setLateFeeSubTab] = useState('view'); // 'create' | 'view'
    const [syncingLateFeeId, setSyncingLateFeeId] = useState(null); // structureId | 'all' | null
    const [lateFeeViewFilters, setLateFeeViewFilters] = useState({
        college: '',
        course: '',
        branch: '',
        batch: '',
        studentYear: '',
        semester: '',
        category: '',
        feeHead: ''
    });
    const [lateFeeForm, setLateFeeForm] = useState({
        college: '',
        course: '',
        branch: '',
        batch: '',
        studentYear: '',
        semester: '',
        categories: [],
        feeHead: '',
        lateFeeHead: '',
        termMappings: [],
        penaltyType: 'Fixed',
        penaltyValue: 0
    });

    const [expandedLateFeeBranches, setExpandedLateFeeBranches] = useState({});
    const [expandedLateFeeQuotas, setExpandedLateFeeQuotas] = useState({});
    const [lateFeeInputs, setLateFeeInputs] = useState({});
    const [editingLateFeeRows, setEditingLateFeeRows] = useState({});

    const [defaultConfigs, setDefaultConfigs] = useState([]);
    const [isSavingDefaultConfig, setIsSavingDefaultConfig] = useState(false);
    const [defaultConfigForm, setDefaultConfigForm] = useState({
        termsCount: 3,
        lateFeeHead: '',
        terms: [
            { termNumber: 1, dueDateMode: 'offset', referenceSemester: 1, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 1 Late Fee' },
            { termNumber: 2, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 2 Late Fee' },
            { termNumber: 3, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 60, fixedDueDate: '', dueDescription: 'Term 3 Late Fee' }
        ]
    });
    const [editingDefaultConfigId, setEditingDefaultConfigId] = useState(null);

    const toggleLateFeeBranchExpand = (key) => {
        setExpandedLateFeeBranches(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleLateFeeQuotaExpand = (key) => {
        setExpandedLateFeeQuotas(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSaveLateFeeRow = async (row, catName, fhId, inputVal, inputKey) => {
        const numAmt = Number(inputVal) || 0;
        setIsSavingLateFee(true);
        try {
            const qData = row.quotasMap[catName];
            const matchingStructs = [];
            Object.keys(qData?.matrix || {}).forEach(yr => {
                const items = qData.matrix[yr]?.[fhId] || [];
                items.forEach(it => {
                    const orig = structures.find(s => String(s._id) === String(it.id));
                    if (orig) matchingStructs.push(orig);
                });
            });

            if (matchingStructs.length === 0) {
                alert("No structures found for this fee head.");
                return;
            }

            const defaultLateHead = feeHeads.find(h => /late\s*fee/i.test(`${h.name || ''} ${h.code || ''}`))?._id || feeHeads[0]?._id;

            for (const orig of matchingStructs) {
                let updatedTerms = [];
                if (Array.isArray(orig.terms) && orig.terms.length > 0) {
                    updatedTerms = orig.terms.map(t => ({
                        ...t,
                        lateFeeAmount: numAmt,
                        dueDateMode: t.dueDateMode || 'offset',
                        referenceSemester: t.referenceSemester || (t.termNumber || 1),
                        dueOffsetDays: t.dueOffsetDays || 30
                    }));
                } else {
                    updatedTerms = [{
                        termNumber: 1,
                        percentage: 100,
                        amount: Number(orig.amount || 0),
                        lateFeeAmount: numAmt,
                        dueDateMode: 'offset',
                        referenceSemester: 1,
                        dueOffsetDays: 30
                    }];
                }

                const payload = {
                    ...orig,
                    feeHead: orig.feeHead?._id || orig.feeHead,
                    lateFeeHead: orig.lateFeeHead?._id || orig.lateFeeHead || defaultLateHead,
                    isTermsDivided: true,
                    terms: updatedTerms
                };

                await api.put(`/fee-structures/${orig._id}`, payload);
            }

            if (inputKey) {
                setEditingLateFeeRows(prev => ({ ...prev, [inputKey]: false }));
            }

            setMessage(`Late fee updated successfully!`);
            await fetchStructures();
            setTimeout(() => setMessage(''), 3000);
        } catch (e) {
            console.error('Error saving late fee:', e);
            alert(e.response?.data?.message || 'Failed to save late fee');
        } finally {
            setIsSavingLateFee(false);
        }
    };

    // --- TAB 1: FEE HEADS ---
    const [headForm, setHeadForm] = useState({ name: '', code: '', description: '' });
    const [editHeadId, setEditHeadId] = useState(null);




    // --- TAB 2: DEFINITIONS (Fee Structures) ---
    const [structures, setStructures] = useState([]);
    const [isLoadingStructures, setIsLoadingStructures] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [tableFilters, setTableFilters] = useState({
        college: '',
        batch: '',
        course: '',
        branch: '',
        category: '',
        feeHeadId: ''
    });
    const [structForm, setStructForm] = useState({
        feeHeadId: '', college: '', course: '', branch: '',
        batch: '', categories: [], studentYear: '', amount: '', // Replaced category with categories
        semester: '', // '1', '2' or empty for yearly
        isScholarshipApplicable: false,
        isTermsDivided: true
    });
    const [feeType, setFeeType] = useState('Yearly'); // 'Yearly' or 'Semester'
    const [semAmounts, setSemAmounts] = useState({ 1: '', 2: '' }); // For simultaneous creation
    const [bulkAmounts, setBulkAmounts] = useState({}); // For "All Years" creation: { 1: '', 2: '', ... }
    const [bulkTerms, setBulkTerms] = useState({}); // { "1-Y": { count: 3, data: [{p: 40, a: 0}, {p: 30, a: 0}, {p: 30, a: 0}] } }
    const [isMultiYear, setIsMultiYear] = useState(true); // Default to true (Always All Years)

    // Helper to generate Academic Years (Still useful for some display?)
    const currentYear = new Date().getFullYear();
    const academicYearOptions = ['ALL', ...Array.from({ length: 9 }, (_, i) => `${currentYear - 4 + i}-${currentYear - 3 + i}`)];

    const [editingId, setEditingId] = useState(null);
    const [isEditingContext, setIsEditingContext] = useState(false);
    const [filterCollege, setFilterCollege] = useState('');
    const [filterCourse, setFilterCourse] = useState('');

    const [batches, setBatches] = useState([]);
    const [isSavingDefinition, setIsSavingDefinition] = useState(false);

    // --- STEPPER WIZARD STATE FOR FEE STRUCTURE REDESIGN ---
    const [wizardStep, setWizardStep] = useState(1); // 1: Context Selection, 2: Quota Breakdown
    const [wizardContext, setWizardContext] = useState({
        college: '',
        batch: '',
        course: '',
        branch: '',
        feeType: 'Yearly'
    });
    const [activeQuotaIndex, setActiveQuotaIndex] = useState(0);
    const [expandedWizardQuotas, setExpandedWizardQuotas] = useState({}); // { [quotaName]: boolean } — each quota toggles independently
    const [quotaConfigs, setQuotaConfigs] = useState({}); // { [quotaName]: { columns: [...], amounts: {...}, terms: {...} } }
    const [quotaTabs, setQuotaTabs] = useState({}); // { [quotaName]: 'actual' | 'late' }
    const [quotaGroupWise, setQuotaGroupWise] = useState({}); // { [quotaName]: boolean }
    const [quotaGroupTermsCount, setQuotaGroupTermsCount] = useState({}); // { [quotaName]: number }
    const [quotaGroupLateFees, setQuotaGroupLateFees] = useState({}); // { [quotaName]: { [termNumber]: number } }
    const [savedQuotas, setSavedQuotas] = useState({}); // { [quotaName]: boolean }
    const [isSavingQuota, setIsSavingQuota] = useState(false);
    const [wizardError, setWizardError] = useState('');

    // --- MAIN TABLE & QUOTA EXPAND/COLLAPSE STATE ---
    const [expandedRows, setExpandedRows] = useState({});
    const [expandedQuotas, setExpandedQuotas] = useState({});

    const toggleRowExpand = (rowKey) => {
        setExpandedRows(prev => ({
            ...prev,
            [rowKey]: !prev[rowKey]
        }));
    };

    const toggleQuotaExpand = (quotaKey) => {
        setExpandedQuotas(prev => ({
            ...prev,
            [quotaKey]: !prev[quotaKey]
        }));
    };

    // --- LATE FEES VIEW TAB EXPAND/COLLAPSE STATE ---
    const [expandedViewGroups, setExpandedViewGroups] = useState({});
    const [expandedViewCategories, setExpandedViewCategories] = useState({});
    const [expandedViewYears, setExpandedViewYears] = useState({});
    const [viewingFallbackForId, setViewingFallbackForId] = useState(null);
    const [editingFallbackForId, setEditingFallbackForId] = useState(null);
    const [fallbackEditForm, setFallbackEditForm] = useState({ lateFeeHead: '', terms: [] });
    const [isSavingFallbackEdit, setIsSavingFallbackEdit] = useState(false);

    const toggleViewGroupExpand = (key) => {
        setExpandedViewGroups(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleViewCategoryExpand = (key) => {
        setExpandedViewCategories(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleViewYearExpand = (key) => {
        setExpandedViewYears(prev => ({ ...prev, [key]: !prev[key] }));
    };
    const toggleViewFallback = (id) => {
        setViewingFallbackForId(prev => (prev === id ? null : id));
        setEditingFallbackForId(null);
    };
    const openFallbackEdit = (s, matchingDefaultConfig) => {
        // Mirror the EXACT same source selection logic used by the read view:
        // if s.terms[i] has custom timing saved → use that; else use default config.
        // This ensures the edit form always shows what the read view shows.
        const structTerms = Array.isArray(s.terms) ? s.terms : [];
        const defaultTerms = matchingDefaultConfig?.terms || [];
        const termsCount = structTerms.length || matchingDefaultConfig?.termsCount || 1;

        const editTerms = Array.from({ length: termsCount }, (_, i) => {
            const sTerm = structTerms.find(t => Number(t.termNumber) === i + 1) || {};
            const dTerm = defaultTerms.find(t => Number(t.termNumber) === i + 1) || {};

            // Same hasCustomTiming check as in the read view
            const hasCustomTiming =
                sTerm.referenceSemester != null ||
                (sTerm.dueOffsetDays != null && sTerm.dueOffsetDays !== 0) ||
                !!sTerm.fixedDueDate;

            // Merge: custom overrides default for timing fields when custom exists
            const timingSrc = hasCustomTiming ? { ...dTerm, ...sTerm } : dTerm;

            return {
                termNumber: i + 1,
                dueDateMode: timingSrc.dueDateMode || 'offset',
                referenceSemester: timingSrc.referenceSemester ?? '',
                dueOffsetDays: timingSrc.dueOffsetDays ?? '',
                fixedDueDate: timingSrc.fixedDueDate ? String(timingSrc.fixedDueDate).substring(0, 10) : '',
                dueDescription: timingSrc.dueDescription || `Term ${i + 1} Late Fee`,
                lateFeeAmount: sTerm.lateFeeAmount ?? 0
            };
        });
        setFallbackEditForm({
            // Use structure's own lateFeeHead if saved, else default config's
            lateFeeHead: s.lateFeeHead?._id || (typeof s.lateFeeHead === 'string' ? s.lateFeeHead : '')
                || matchingDefaultConfig?.lateFeeHead?._id || '',
            terms: editTerms
        });
        setEditingFallbackForId(s._id);
    };
    const saveFallbackEdit = async (s) => {
        setIsSavingFallbackEdit(true);
        try {
            // Merge edited timing/fee fields from the form onto the original term objects.
            // This preserves required fields (percentage, amount) while applying the user's edits.
            const mergedTerms = (Array.isArray(s.terms) ? s.terms : []).map(origTerm => {
                const editedTerm = fallbackEditForm.terms.find(
                    t => Number(t.termNumber) === Number(origTerm.termNumber)
                ) || {};
                return {
                    ...origTerm,
                    dueDateMode: editedTerm.dueDateMode ?? origTerm.dueDateMode,
                    referenceSemester: editedTerm.referenceSemester !== '' ? editedTerm.referenceSemester : origTerm.referenceSemester,
                    dueOffsetDays: editedTerm.dueOffsetDays !== '' ? Number(editedTerm.dueOffsetDays) : origTerm.dueOffsetDays,
                    fixedDueDate: editedTerm.fixedDueDate || origTerm.fixedDueDate || undefined,
                    dueDescription: editedTerm.dueDescription ?? origTerm.dueDescription,
                    lateFeeAmount: editedTerm.lateFeeAmount ?? origTerm.lateFeeAmount
                };
            });

            await api.put(`/fee-structures/${s._id}`, {
                ...s,
                feeHead: s.feeHead?._id || s.feeHead,
                lateFeeHead: fallbackEditForm.lateFeeHead || null,
                isTermsDivided: Array.isArray(s.terms) && s.terms.length > 0,
                terms: mergedTerms
            });
            setMessage('Rules saved — running sync…');
            setEditingFallbackForId(null);
            fetchStructures();
            // Auto-sync after saving so date-based late fee demands are updated immediately
            await syncLateFees(s._id);
        } catch (e) {
            alert(e.response?.data?.message || 'Save failed');
        } finally {
            setIsSavingFallbackEdit(false);
        }
    };

    // --- LOCAL STORAGE DRAFT PERSISTENCE ---
    const WIZARD_DRAFT_KEY = 'pydah_fee_wizard_draft_v1';

    // Auto-save draft to localStorage whenever wizard state updates
    // Only save for CREATE mode — not when editing an existing structure
    useEffect(() => {
        if (isEditingContext) return; // Don't overwrite create-card draft with edit data
        if (isModalOpen || wizardContext.college || Object.keys(quotaConfigs).length > 0) {
            const draftData = {
                wizardStep,
                wizardContext,
                activeQuotaIndex,
                quotaConfigs,
                savedQuotas
            };
            localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draftData));
        }
    }, [wizardStep, wizardContext, activeQuotaIndex, quotaConfigs, savedQuotas, isModalOpen, isEditingContext]);

    // Load draft from localStorage
    const loadWizardDraft = () => {
        try {
            const saved = localStorage.getItem(WIZARD_DRAFT_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && (parsed.wizardContext?.college || Object.keys(parsed.quotaConfigs || {}).length > 0)) {
                    if (parsed.wizardStep) setWizardStep(parsed.wizardStep);
                    if (parsed.wizardContext) setWizardContext(parsed.wizardContext);
                    if (parsed.activeQuotaIndex !== undefined) setActiveQuotaIndex(parsed.activeQuotaIndex);
                    if (parsed.quotaConfigs) setQuotaConfigs(parsed.quotaConfigs);
                    if (parsed.savedQuotas) setSavedQuotas(parsed.savedQuotas);
                    return true;
                }
            }
        } catch (e) {
            console.error("Error reading wizard draft from localStorage", e);
        }
        return false;
    };

    // Clear draft from localStorage
    const clearWizardDraft = () => {
        localStorage.removeItem(WIZARD_DRAFT_KEY);
        setWizardStep(1);
        setWizardContext({ college: '', batch: '', course: '', branch: '', feeType: 'Yearly' });
        setActiveQuotaIndex(0);
        setExpandedWizardQuotas({});
        setQuotaConfigs({});
        setSavedQuotas({});
    };

    // Auto-load draft when component mounts
    useEffect(() => {
        loadWizardDraft();
    }, []);

    // Available categories/quotas for current context
    const availableQuotas = React.useMemo(() => {
        if (categories && categories.length > 0) return categories;
        return ['Convenor (A-Category)', 'Management (B-Category)', 'NRI (C-Category)', 'Spot Admission'];
    }, [categories]);

    // Helper: Compute effective years count taking branch-level metadata (e.g. additionalYear) into account
    const getEffectiveYearsCount = (collegeName, courseName, branchName) => {
        if (!collegeName || !courseName) return 4;
        const selectedMeta = metadata[collegeName]?.[courseName];
        if (!selectedMeta) return 4;
        if (branchName && selectedMeta.branchDetails && selectedMeta.branchDetails[branchName]) {
            return selectedMeta.branchDetails[branchName].total_years || selectedMeta.total_years || 4;
        }
        return selectedMeta.total_years || 4;
    };

    // Open wizard for new fee structure creation
    const handleOpenCreateWizard = () => {
        const hasDraft = loadWizardDraft();
        if (!hasDraft) {
            setWizardStep(1);
            setWizardContext({
                college: tableFilters.college || '',
                batch: tableFilters.batch || '',
                course: tableFilters.course || '',
                branch: tableFilters.branch || '',
                feeType: 'Yearly'
            });
            setActiveQuotaIndex(0);
            setExpandedWizardQuotas({});
            setQuotaConfigs({});
            setSavedQuotas({});
        }
        setIsEditingContext(false);
        setEditingId(null);
        setIsModalOpen(true);
    };

    // Helper: Initialize/Retrieve configuration for a specific quota
    const getQuotaConfig = (quotaName) => {
        if (quotaConfigs[quotaName]) return quotaConfigs[quotaName];
        return {
            columns: [],
            amounts: {},
            scholarships: {},
            terms: {}
        };
    };

    const updateScholarshipInActiveQuota = (quotaName, rowKey, colId, isChecked) => {
        const currentConfig = getQuotaConfig(quotaName);
        const key = `${rowKey}_${colId}`;
        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                scholarships: {
                    ...(currentConfig.scholarships || {}),
                    [key]: isChecked
                }
            }
        }));
    };

    const toggleColumnScholarshipAllYears = (quotaName, colId, checked, matrixRows) => {
        setQuotaConfigs(prev => {
            const currentConfig = prev[quotaName] || { columns: [], amounts: {}, scholarships: {}, terms: {} };
            const newScholarships = { ...(currentConfig.scholarships || {}) };
            matrixRows.forEach(row => {
                const key = `${row.rowKey}_${colId}`;
                newScholarships[key] = checked;
            });
            return {
                ...prev,
                [quotaName]: {
                    ...currentConfig,
                    columns: currentConfig.columns.map(c => c.id === colId ? { ...c, isScholarshipApplicable: checked } : c),
                    scholarships: newScholarships
                }
            };
        });
    };

    // Column Manipulation Actions
    const addColumnToActiveQuota = (quotaName) => {
        const currentConfig = getQuotaConfig(quotaName);
        const usedHeadIds = currentConfig.columns.map(c => c.feeHeadId);
        const unusedHead = feeHeads.find(h => !usedHeadIds.includes(h._id));
        const newCol = {
            id: `col_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
            feeHeadId: unusedHead ? unusedHead._id : '',
            isLateFeeApplicable: false,
            isScholarshipApplicable: false,
            termsCount: 0
        };
        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                columns: [...currentConfig.columns, newCol]
            }
        }));
    };

    const removeColumnFromActiveQuota = (quotaName, colId) => {
        const currentConfig = getQuotaConfig(quotaName);
        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                columns: currentConfig.columns.filter(c => c.id !== colId)
            }
        }));
    };

    const updateColumnInActiveQuota = (quotaName, colId, field, val) => {
        const currentConfig = getQuotaConfig(quotaName);
        const updatedCols = currentConfig.columns.map(c => {
            if (c.id === colId) {
                const updated = { ...c, [field]: val };
                if (field === 'isLateFeeApplicable') {
                    if (val === true) {
                        updated.termsCount = 3;
                    } else {
                        updated.termsCount = 0;
                    }
                }
                return updated;
            }
            return c;
        });

        // Re-calculate terms breakdown for non-zero amounts if termsCount or late fee applicability changed
        const colObj = updatedCols.find(c => c.id === colId);
        const count = colObj?.termsCount || 0;
        let updatedTerms = { ...currentConfig.terms };

        Object.keys(currentConfig.amounts).forEach(amtKey => {
            if (amtKey.endsWith(`_${colId}`)) {
                const numAmount = Number(currentConfig.amounts[amtKey]) || 0;
                if (colObj?.isLateFeeApplicable && count > 0 && numAmount > 0) {
                    let defaultPcts = [];
                    if (count === 1) defaultPcts = [100];
                    else if (count === 2) defaultPcts = [50, 50];
                    else if (count === 3) defaultPcts = [40, 30, 30];
                    else {
                        const equalP = Math.floor(100 / count);
                        defaultPcts = Array(count).fill(equalP);
                        const sum = equalP * count;
                        defaultPcts[count - 1] += (100 - sum);
                    }

                    let sumA = 0;
                    const termData = defaultPcts.map((p, idx) => {
                        if (idx === count - 1) {
                            return { p, a: numAmount - sumA };
                        } else {
                            const a = Math.round(numAmount * (p / 100));
                            sumA += a;
                            return { p, a };
                        }
                    });

                    updatedTerms[amtKey] = { count, data: termData };
                }
            }
        });

        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                columns: updatedCols,
                terms: updatedTerms
            }
        }));
    };

    // Amount & Terms Update Handlers
    const updateAmountInActiveQuota = (quotaName, rowKey, colId, amountVal) => {
        const currentConfig = getQuotaConfig(quotaName);
        const key = `${rowKey}_${colId}`;
        const numAmount = Number(amountVal) || 0;
        
        let updatedTerms = { ...currentConfig.terms };
        const colObj = currentConfig.columns.find(c => c.id === colId);
        const count = colObj?.termsCount || (colObj?.isLateFeeApplicable ? 3 : 0);

        if (colObj?.isLateFeeApplicable && count > 0 && numAmount > 0) {
            let defaultPcts = [];
            if (count === 1) defaultPcts = [100];
            else if (count === 2) defaultPcts = [50, 50];
            else if (count === 3) defaultPcts = [40, 30, 30];
            else {
                const equalP = Math.floor(100 / count);
                defaultPcts = Array(count).fill(equalP);
                const sum = equalP * count;
                defaultPcts[count - 1] += (100 - sum);
            }

            let sumA = 0;
            const termData = defaultPcts.map((p, idx) => {
                if (idx === count - 1) {
                    return { p, a: numAmount - sumA };
                } else {
                    const a = Math.round(numAmount * (p / 100));
                    sumA += a;
                    return { p, a };
                }
            });

            updatedTerms[key] = {
                count,
                data: termData
            };
        }

        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                amounts: { ...currentConfig.amounts, [key]: amountVal },
                terms: updatedTerms
            }
        }));
    };

    const updateTermPctInActiveQuota = (quotaName, rowKey, colId, termIdx, pctVal) => {
        const currentConfig = getQuotaConfig(quotaName);
        const key = `${rowKey}_${colId}`;
        const totalAmt = Number(currentConfig.amounts[key]) || 0;
        const currentTermObj = currentConfig.terms[key] 
            ? JSON.parse(JSON.stringify(currentConfig.terms[key])) 
            : { count: 3, data: [{ p: 40, a: 0 }, { p: 30, a: 0 }, { p: 30, a: 0 }] };
        
        currentTermObj.data[termIdx].p = Number(pctVal);
        let sumA = 0;
        currentTermObj.data.forEach((t, i) => {
            if (i === currentTermObj.data.length - 1) {
                t.a = totalAmt - sumA;
            } else {
                t.a = Math.round(totalAmt * (t.p / 100));
                sumA += t.a;
            }
        });

        setQuotaConfigs(prev => ({
            ...prev,
            [quotaName]: {
                ...currentConfig,
                terms: { ...currentConfig.terms, [key]: currentTermObj }
            }
        }));
    };

    // Save Active Quota & Advance to Next
    const handleSaveQuotaAndNext = async (quotaName, isLastQuota, currentQIndex) => {
        setWizardError('');
        if (!wizardContext.college || !wizardContext.batch || !wizardContext.course || !wizardContext.branch) {
            setWizardError('Please select complete academic context first.');
            return;
        }

        const config = getQuotaConfig(quotaName);
        const columns = config.columns || [];

        // 1. Validation: Every present column must have a Fee Head selected
        if (columns.length > 0) {
            for (let i = 0; i < columns.length; i++) {
                if (!columns[i].feeHeadId) {
                    setWizardError(`Please select a Fee Head for Column ${i + 1}, or remove unused columns.`);
                    return;
                }
            }
        }

        const yearsCount = getEffectiveYearsCount(wizardContext.college, wizardContext.course, wizardContext.branch);

        const matrixRows = [];
        for (let y = 1; y <= yearsCount; y++) {
            if (wizardContext.feeType === 'Yearly') {
                matrixRows.push({ year: y, semester: null, rowKey: `${y}-Y` });
            } else {
                matrixRows.push({ year: y, semester: 1, rowKey: `${y}-S1` });
                matrixRows.push({ year: y, semester: 2, rowKey: `${y}-S2` });
            }
        }

        // 2. Validation: Every present column MUST have an amount > 0 entered in at least one year/period
        if (columns.length > 0) {
            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                const hasValueInAnyYear = matrixRows.some(row => {
                    const amtKey = `${row.rowKey}_${col.id}`;
                    const val = config.amounts[amtKey];
                    return val !== undefined && val !== '' && !isNaN(Number(val)) && Number(val) > 0;
                });

                if (!hasValueInAnyYear) {
                    const fh = feeHeads.find(h => h._id === col.feeHeadId);
                    setWizardError(`Column ${i + 1} (${fh?.name || 'Selected Fee Head'}) does not have a fee amount entered. Please enter a fee amount in at least one year/period for every column.`);
                    return;
                }
            }
        }

        // 3. Validation: If Late Fee is applicable, make sure late fee amounts are entered and > 0 for all terms in the Late Fees tab
        if (columns.length > 0) {
            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                if (col.isLateFeeApplicable) {
                    const fh = feeHeads.find(h => h._id === col.feeHeadId);
                    
                    // Let's verify each active year/period row
                    for (const row of matrixRows) {
                        const amtKey = `${row.rowKey}_${col.id}`;
                        const rawAmt = config.amounts[amtKey];
                        if (rawAmt !== undefined && rawAmt !== '' && !isNaN(Number(rawAmt)) && Number(rawAmt) > 0) {
                            const termObj = config.terms[amtKey];
                            const tCount = col.termsCount > 0 ? col.termsCount : 1;
                            
                            if (tCount > 1 && termObj) {
                                // Divided terms
                                for (let tIdx = 0; tIdx < termObj.data.length; tIdx++) {
                                    const tNum = tIdx + 1;
                                    const lateAmt = (col.termLateFees && col.termLateFees[tNum] !== undefined)
                                        ? Number(col.termLateFees[tNum])
                                        : (Number(col.lateFeeAmount) || 0);
                                    if (isNaN(lateAmt) || lateAmt <= 0) {
                                        setWizardError(`Please configure a positive late fee amount for Term ${tNum} of "${fh?.name || 'Selected Head'}" in the Late Fees tab for quota "${quotaName}".`);
                                        return;
                                    }
                                }
                            } else {
                                // Undivided term (1 term)
                                const lateAmt = (col.termLateFees && col.termLateFees[1] !== undefined)
                                    ? Number(col.termLateFees[1])
                                    : (Number(col.lateFeeAmount) || 0);
                                if (isNaN(lateAmt) || lateAmt <= 0) {
                                    setWizardError(`Please configure a positive late fee amount for "${fh?.name || 'Selected Head'}" in the Late Fees tab for quota "${quotaName}".`);
                                    return;
                                }
                            }
                        }
                    }
                }
            }
        }

        setIsSavingQuota(true);
        try {
            // Delete existing fee structure records for this specific quota context to clean up removed columns/heads
            const contextKey = `${wizardContext.college}|${wizardContext.batch}|${wizardContext.course}|${wizardContext.branch}`;
            const targetGroup = grouped[contextKey];
            if (targetGroup && targetGroup.quotasMap && targetGroup.quotasMap[quotaName]) {
                const existingIds = targetGroup.quotasMap[quotaName].allIds || [];
                if (existingIds.length > 0) {
                    await Promise.all(existingIds.map(id => api.delete(`/fee-structures/${id}`)));
                }
            }

            const requests = [];
            if (columns.length > 0) {
                for (const col of columns) {
                    for (const row of matrixRows) {
                        const amtKey = `${row.rowKey}_${col.id}`;
                        const rawAmt = config.amounts[amtKey];
                        if (rawAmt !== undefined && rawAmt !== '' && !isNaN(Number(rawAmt)) && Number(rawAmt) > 0) {
                            const amt = Number(rawAmt);
                            const termObj = config.terms[amtKey];
                            const defaultLateHead = feeHeads.find(h => /late\s*fee/i.test(`${h.name || ''} ${h.code || ''}`))?._id || feeHeads[0]?._id;
                            const tCount = col.termsCount > 0 ? col.termsCount : 1;
                            const termsData = col.isLateFeeApplicable ? (
                                (tCount > 1 && termObj) ? termObj.data.map((t, idx) => {
                                    const tNum = idx + 1;
                                    const lateAmt = (col.termLateFees && col.termLateFees[tNum] !== undefined)
                                        ? Number(col.termLateFees[tNum])
                                        : (Number(col.lateFeeAmount) || 0);
                                    return {
                                        termNumber: tNum,
                                        percentage: t.p,
                                        amount: t.a,
                                        lateFeeAmount: lateAmt
                                    };
                                }) : [{
                                    termNumber: 1,
                                    percentage: 100,
                                    amount: amt,
                                    lateFeeAmount: (col.termLateFees && col.termLateFees[1] !== undefined)
                                        ? Number(col.termLateFees[1])
                                        : (Number(col.lateFeeAmount) || 0)
                                }]
                            ) : [];

                            requests.push(api.post('/fee-structures', {
                                feeHeadId: col.feeHeadId,
                                college: wizardContext.college,
                                course: wizardContext.course,
                                branch: wizardContext.branch,
                                batch: wizardContext.batch,
                                category: quotaName,
                                studentYear: row.year,
                                semester: row.semester,
                                amount: amt,
                                isScholarshipApplicable: config.scholarships?.[`${row.rowKey}_${col.id}`] || false,
                                isTermsDivided: col.isLateFeeApplicable || false,
                                lateFeeHead: col.isLateFeeApplicable ? defaultLateHead : null,
                                terms: col.isLateFeeApplicable ? termsData : [],
                                isGroupWiseLateFee: col.isLateFeeApplicable ? !!quotaGroupWise[quotaName] : false
                            }));
                        }
                    }
                }
            }

            if (requests.length > 0) {
                await Promise.all(requests);
            }

            setSavedQuotas(prev => ({ ...prev, [quotaName]: true }));

            if (isLastQuota) {
                await fetchStructures();
                clearWizardDraft(); // Only clear draft when entire card is done
                setMessage(`All quota fee structures saved successfully for ${wizardContext.course} - ${wizardContext.branch}!`);
                setIsModalOpen(false);
                setTimeout(() => setMessage(''), 4000);
            } else {
                fetchStructures(); // Fetch in background without blocking Next Quota navigation
                // Auto-expand next quota and close current quota
                const qIdx = currentQIndex !== undefined ? currentQIndex : availableQuotas.indexOf(quotaName);
                const nextQuotaName = availableQuotas[qIdx + 1];
                if (nextQuotaName) {
                    setExpandedWizardQuotas(prev => ({
                        ...prev,
                        [quotaName]: false,
                        [nextQuotaName]: true
                    }));
                }
                if (qIdx >= 0) {
                    setActiveQuotaIndex(qIdx + 1);
                }
            }
        } catch (err) {
            console.error('Error saving quota fee structure:', err);
            setWizardError(err.response?.data?.message || 'Failed to save fee structure for this quota.');
        } finally {
            setIsSavingQuota(false);
        }
    };

    // Reset selected categories when primary context changes in Late Fees
    useEffect(() => {
        setLateFeeForm(prev => ({ ...prev, categories: [] }));
    }, [lateFeeForm.college, lateFeeForm.course, lateFeeForm.batch]);

    useEffect(() => {
        fetchFeeHeads();
        fetchFeeGroups();
        fetchStructures();
        fetchMetadata();
        fetchCalendarData();
        fetchDefaultConfigs();
    }, []);

    const fetchCalendarData = async () => {
        try {
            const res = await api.get(`/academic-calendar/academic-years`);
            setCalendarData(res.data);
        } catch (error) {
            console.error('Error fetching academic years', error);
        }
    };

    const syncLateFees = async (structureId = null) => {
        const key = structureId || 'all';
        setSyncingLateFeeId(key);
        try {
            const res = await api.post('/late-fees/process', structureId ? { structureId } : {});
            const results = res.data?.results || [];
            const generatedCount = results.filter(r => r.status === 'Generated').length;
            const removedCount = results.filter(r => r.status && (r.status.includes('Removed') || r.status.includes('Mismatch'))).length;

            Swal.fire({
                title: 'Late Fee Sync Completed',
                html: `
                    <div style="text-align: left; font-family: sans-serif; font-size: 13px; color: #374151; margin-top: 10px;">
                        <p style="font-weight: 600; color: #4b5563; margin-bottom: 12px;">Sync summary statistics:</p>
                        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb;">
                            <span style="font-weight: 500; color: #059669;">✓ Demands Generated:</span>
                            <span style="font-weight: 800; color: #065f46; font-family: monospace; font-size: 14px;">${generatedCount}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #e5e7eb; margin-top: 4px;">
                            <span style="font-weight: 500; color: #dc2626;">✕ Demands Removed (extended/paid):</span>
                            <span style="font-weight: 800; color: #991b1b; font-family: monospace; font-size: 14px;">${removedCount}</span>
                        </div>
                    </div>
                `,
                icon: 'success',
                confirmButtonText: 'OK',
                confirmButtonColor: '#2563eb'
            });
        } catch (e) {
            Swal.fire({
                title: 'Sync Failed',
                text: e.response?.data?.message || 'Late fee sync execution encountered an error.',
                icon: 'error',
                confirmButtonColor: '#ef4444'
            });
        } finally {
            setSyncingLateFeeId(null);
        }
    };


    const fetchDefaultConfigs = async () => {
        try {
            const res = await api.get('/late-fees/default-config');
            setDefaultConfigs(res.data);
        } catch (error) {
            console.error('Error fetching default late fee configs', error);
        }
    };

    const handleDeleteDefaultConfig = async (id) => {
        if (!window.confirm('Are you sure you want to delete this default configuration?')) return;
        try {
            await api.delete(`/late-fees/default-config/${id}`);
            setMessage('Default configuration removed successfully!');
            fetchDefaultConfigs();
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            alert(error.response?.data?.message || 'Delete failed');
        }
    };


    const fetchMetadata = async () => {
        try {
            const response = await api.get(`/students/metadata`);
            setMetadata(response.data.hierarchy || response.data);
            if (response.data.batches) setBatches(response.data.batches);
            if (response.data.categories) setCategories(response.data.categories);
            if (response.data.categoryMapping) setCategoryMapping(response.data.categoryMapping);
            if (response.data.collegeCodes) setCollegeCodes(response.data.collegeCodes);
        } catch (error) { console.error('Error fetching metadata', error); }
    };

    const fetchFeeHeads = async () => {
        try {
            const response = await api.get(`/fee-heads`);
            setFeeHeads(response.data);
        } catch (error) { console.error(error); }
    };

    const fetchFeeGroups = async () => {
        try {
            const response = await api.get(`/fee-groups`);
            setFeeGroups(response.data);
        } catch (error) { console.error('Error fetching fee groups', error); }
    };

    const fetchStructures = async () => {
        setIsLoadingStructures(true);
        try {
            const response = await api.get(`/fee-structures`);
            setStructures(response.data);
        } catch (error) { console.error(error); }
        finally { setIsLoadingStructures(false); }
    };


    const activeHeadSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        try {
            if (editHeadId) {
                const response = await api.put(`/fee-heads/${editHeadId}`, headForm);
                setFeeHeads(feeHeads.map(h => h._id === editHeadId ? response.data : h));
                setMessage('Fee Head updated successfully!');
            } else {
                const response = await api.post(`/fee-heads`, headForm);
                setFeeHeads([response.data, ...feeHeads]);
                setMessage('Fee Head added successfully!');
            }
            setHeadForm({ name: '', code: '', description: '' });
            setEditHeadId(null);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) { setMessage(error.response?.data?.message || 'Error'); }
    };

    const handleEditHead = (h) => {
        setHeadForm({ name: h.name, code: h.code || '', description: h.description });
        setEditHeadId(h._id);
    };

    const toggleHeadActive = async (h) => {
        const newActiveStatus = h.isActive === false ? true : false;
        const confirmMsg = newActiveStatus 
            ? `Activate this Fee Head?` 
            : `Deactivate this Fee Head? It will no longer be selectable for configuring new structures.`;
        if (!window.confirm(confirmMsg)) return;
        try {
            const response = await api.put(`/fee-heads/${h._id}`, {
                name: h.name,
                code: h.code || '',
                description: h.description,
                isActive: newActiveStatus
            });
            setFeeHeads(feeHeads.map(item => item._id === h._id ? response.data : item));
            setMessage(`Fee Head "${h.name}" ${newActiveStatus ? 'activated' : 'deactivated'} successfully!`);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) { 
            alert(error.response?.data?.message || 'Failed to update status'); 
        }
    };

    const activeGroupSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        setIsSavingGroup(true);
        try {
            if (editGroupId) {
                const response = await api.put(`/fee-groups/${editGroupId}`, groupForm);
                setFeeGroups(feeGroups.map(g => g._id === editGroupId ? response.data : g));
                setMessage('Fee Group updated successfully!');
            } else {
                const response = await api.post(`/fee-groups`, groupForm);
                setFeeGroups([response.data, ...feeGroups]);
                setMessage('Fee Group added successfully!');
            }
            setGroupForm({ name: '', code: '', description: '', feeHeads: [] });
            setEditGroupId(null);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage(error.response?.data?.message || 'Error saving Fee Group');
        } finally {
            setIsSavingGroup(false);
        }
    };

    const handleEditGroup = (g) => {
        setGroupForm({
            name: g.name,
            code: g.code || '',
            description: g.description || '',
            feeHeads: g.feeHeads ? g.feeHeads.map(fh => fh._id || fh) : []
        });
        setEditGroupId(g._id);
    };

    const deleteGroup = async (id) => {
        if (!window.confirm('Delete this Fee Group?')) return;
        try {
            await api.delete(`/fee-groups/${id}`);
            setFeeGroups(feeGroups.filter(g => g._id !== id));
            setMessage('Fee Group deleted successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) { alert('Failed to delete Fee Group'); }
    };

    const handleTermChange = (key, count) => {
        const total = Number(bulkAmounts[key]) || 0;
        const newData = Array.from({ length: count }, (_, i) => ({
            p: i === 0 ? 100 : 0, // Default first term to 100%
            a: i === 0 ? total : 0
        }));
        // If 3 terms, maybe default to 40-30-30 or similar? 
        if (Number(count) === 3) {
            newData[0] = { p: 40, a: Math.round(total * 0.4) };
            newData[1] = { p: 30, a: Math.round(total * 0.3) };
            newData[2] = { p: 30, a: total - newData[0].a - newData[1].a };
        } else if (Number(count) > 0) {
            const equalP = Math.floor(100 / count);
            let sumA = 0;
            for (let i = 0; i < count; i++) {
                const p = (i === count - 1) ? (100 - (equalP * (count - 1))) : equalP;
                const a = (i === count - 1) ? (total - sumA) : Math.round(total * (p / 100));
                newData[i] = { p, a };
                sumA += a;
            }
        }

        setBulkTerms({ ...bulkTerms, [key]: { count: Number(count), data: newData } });
    };

    const updateTermPercentage = (key, index, p) => {
        const total = Number(bulkAmounts[key]) || 0;
        setBulkTerms(prev => {
            const currentTerms = JSON.parse(JSON.stringify(prev[key]));
            currentTerms.data[index].p = Number(p);

            // Recalc all amounts based on percentages
            let sumA = 0;
            currentTerms.data.forEach((t, i) => {
                if (i === currentTerms.data.length - 1) {
                    t.a = total - sumA;
                } else {
                    t.a = Math.round(total * (t.p / 100));
                    sumA += t.a;
                }
            });
            return { ...prev, [key]: currentTerms };
        });
    };

    const updateAmountAndRecalcTerms = (key, val) => {
        const total = Number(val) || 0;
        setBulkAmounts(prev => ({ ...prev, [key]: val }));

        if (structForm.isTermsDivided) {
            if (bulkTerms[key]) {
                setBulkTerms(prev => {
                    const currentTerms = JSON.parse(JSON.stringify(prev[key]));
                    let sumA = 0;
                    currentTerms.data.forEach((t, i) => {
                        if (i === currentTerms.data.length - 1) {
                            t.a = total - sumA;
                        } else {
                            t.a = Math.round(total * (t.p / 100));
                            sumA += t.a;
                        }
                    });
                    return { ...prev, [key]: currentTerms };
                });
            } else if (val && !isNaN(val)) {
                // Default to 3 terms as per user request
                handleTermChange(key, 3);
            }
        }
    };

    // --- DEFINITIONS LOGIC ---
    const activeStructSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        setIsSavingDefinition(true);
        try {
            if (editingId) {
                // Update existing
                await api.put(`/fee-structures/${editingId}`, structForm);
            } else {
                // Determine Years to Process from Metadata
                const yearsCount = getEffectiveYearsCount(structForm.college, structForm.course, structForm.branch);

                const requests = [];
                for (let y = 1; y <= yearsCount; y++) {
                    if (feeType === 'Yearly') {
                        const key = `${y}-Y`;
                        const amount = bulkAmounts[key];
                        if (amount) {
                            const termsData = bulkTerms[key] ? bulkTerms[key].data.map((t, idx) => ({
                                termNumber: idx + 1,
                                percentage: t.p,
                                amount: t.a
                            })) : [];

                            requests.push(api.post(`/fee-structures`, {
                                ...structForm,
                                studentYear: y,
                                semester: null,
                                amount: Number(amount),
                                batch: structForm.batch,
                                categories: structForm.categories,
                                isScholarshipApplicable: structForm.isScholarshipApplicable,
                                isTermsDivided: structForm.isTermsDivided,
                                terms: structForm.isTermsDivided ? termsData : []
                            }));
                        }
                    } else {
                        // Semester Wise
                        ['S1', 'S2'].forEach((sSuff, sIdx) => {
                            const key = `${y}-${sSuff}`;
                            const amount = bulkAmounts[key];
                            if (amount) {
                                const termsData = bulkTerms[key] ? bulkTerms[key].data.map((t, tidx) => ({
                                    termNumber: tidx + 1,
                                    percentage: t.p,
                                    amount: t.a
                                })) : [];

                                requests.push(api.post(`/fee-structures`, {
                                    ...structForm,
                                    studentYear: y,
                                    semester: sIdx + 1,
                                    amount: Number(amount),
                                    batch: structForm.batch,
                                    categories: structForm.categories,
                                    isScholarshipApplicable: structForm.isScholarshipApplicable,
                                    isTermsDivided: structForm.isTermsDivided,
                                    terms: structForm.isTermsDivided ? termsData : []
                                }));
                            }
                        });
                    }
                }

                if (requests.length === 0) { alert('Please enter at least one amount.'); return; }
                await Promise.all(requests);
            }

            setMessage(editingId ? 'Fee Structure updated!' : 'Fee Definitions created successfully!');
            fetchStructures();
            setStructForm({ ...structForm, amount: '' });
            setSemAmounts({ 1: '', 2: '' });
            setBulkAmounts({});
            setEditingId(null);
            setIsEditingContext(false);
            setIsModalOpen(false);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) { setMessage(error.response?.data?.message || 'Error saving structure'); }
        finally { setIsSavingDefinition(false); }
    };

    // Edit entire row (Propagate context)
    const handleEditRow = (row) => {
        setStructForm({
            feeHeadId: row.feeHeadId,
            college: row.college,
            course: row.course,
            branch: row.branch,
            batch: row.batch, // Ensure Batch is selected
            categories: row.category ? [row.category] : (row.categories || []), // Support both singular and array
            academicYear: row.academicYear,
            studentYear: '', // User must select year to refine OR use Multi-Year
            amount: '',
            semester: '',
            isScholarshipApplicable: row.isScholarshipApplicable || false,
            isTermsDivided: row.isTermsDivided || false
        });

        // Populate bulkAmounts and bulkTerms for Multi-Year Editing
        const newBulk = {};
        const newTerms = {};
        if (row.years) {
            Object.keys(row.years).forEach(y => {
                const items = row.years[y]; // Array of { semester, amount, terms }
                items.forEach(item => {
                    const suffice = item.semester ? `S${item.semester}` : 'Y';
                    const key = `${y}-${suffice}`;
                    newBulk[key] = item.amount;
                    if (item.terms && item.terms.length > 0) {
                        newTerms[key] = {
                            count: item.terms.length,
                            data: item.terms.map(t => ({ p: t.percentage, a: t.amount }))
                        };
                    }
                });
            });
        }
        setBulkAmounts(newBulk);
        setBulkTerms(newTerms);
        setIsMultiYear(true); // Default to Multi-Year edit mode
        setFeeType(Object.keys(newBulk).some(k => k.includes('S')) ? 'Semester' : 'Yearly');

        setEditingId(null);
        setIsEditingContext(true);
        setIsModalOpen(true);
        setMessage('Context loaded. Use "All Years" to edit multiple years at once.');
    };

    const handleEditStructureRow = (row) => {
        setWizardError('');
        setIsEditingContext(true); // Prevent auto-save from writing edit data to create draft
        let hasSemesters = false;
        if (row.quotasMap) {
            Object.values(row.quotasMap).forEach(qData => {
                if (qData.matrix) {
                    Object.values(qData.matrix).forEach(yrMap => {
                        Object.values(yrMap).forEach(items => {
                            if (items.some(it => it.semester)) hasSemesters = true;
                        });
                    });
                }
            });
        }

        setWizardContext({
            college: row.college,
            batch: row.batch,
            course: row.course,
            branch: row.branch,
            feeType: hasSemesters ? 'Semester' : 'Yearly'
        });

        const newQuotaConfigs = {};
        const newSavedQuotas = {};
        const newQuotaGroupWise = {};
        const newQuotaGroupLateFees = {};

        if (row.quotasMap) {
            Object.keys(row.quotasMap).forEach(catName => {
                const qData = row.quotasMap[catName];
                if (!qData) return;

                const feeHeadsList = Object.values(qData.feeHeadsMap || {});

                const columns = feeHeadsList.map(fh => {
                    const termLateFees = {};
                    if (qData.matrix) {
                        Object.keys(qData.matrix).forEach(yr => {
                            Object.keys(qData.matrix[yr]).forEach(fhId => {
                                if (String(fhId) === String(fh._id)) {
                                    const items = qData.matrix[yr][fhId] || [];
                                    items.forEach(item => {
                                        if (item.terms) {
                                            item.terms.forEach(t => {
                                                if (Number(t.lateFeeAmount) > 0) {
                                                    termLateFees[t.termNumber] = t.lateFeeAmount;
                                                }
                                            });
                                        }
                                    });
                                }
                            });
                        });
                    }

                    return {
                        id: `col_${fh._id}`,
                        feeHeadId: fh._id,
                        isLateFeeApplicable: fh.isTermsDivided || false,
                        isScholarshipApplicable: fh.isScholarshipApplicable || false,
                        termsCount: fh.termsCount || 0,
                        lateFeeAmount: fh.lateFeeAmount || 0,
                        termLateFees: Object.keys(termLateFees).length > 0 ? termLateFees : {}
                    };
                });

                // Determine if group-wise late fee was active
                let isGroupWise = false;
                if (qData.matrix) {
                    Object.keys(qData.matrix).forEach(yr => {
                        Object.keys(qData.matrix[yr]).forEach(fhId => {
                            const items = qData.matrix[yr][fhId] || [];
                            if (items.some(item => item.isGroupWiseLateFee)) {
                                isGroupWise = true;
                            }
                        });
                    });
                }
                newQuotaGroupWise[catName] = isGroupWise;

                // Pre-populate group late fees input if group-wise is true
                if (isGroupWise && columns.length > 0) {
                    const firstCol = columns.find(c => c.isLateFeeApplicable);
                    if (firstCol && firstCol.termLateFees) {
                        newQuotaGroupLateFees[catName] = { ...firstCol.termLateFees };
                    }
                }

                const amounts = {};
                const scholarships = {};
                const terms = {};

                if (qData.matrix) {
                    Object.keys(qData.matrix).forEach(yr => {
                        Object.keys(qData.matrix[yr]).forEach(fhId => {
                            const colId = `col_${fhId}`;
                            const items = qData.matrix[yr][fhId] || [];
                            items.forEach(item => {
                                const rowKey = item.semester ? `${yr}-S${item.semester}` : `${yr}-Y`;
                                const amtKey = `${rowKey}_${colId}`;
                                amounts[amtKey] = item.amount;
                                scholarships[amtKey] = item.isScholarshipApplicable || false;

                                if (item.isTermsDivided && item.terms && item.terms.length > 0) {
                                    terms[amtKey] = {
                                        count: item.terms.length,
                                        data: item.terms.map(t => ({ p: t.percentage, a: t.amount }))
                                    };
                                }
                            });
                        });
                    });
                }

                newQuotaConfigs[catName] = {
                    columns,
                    amounts,
                    scholarships,
                    terms
                };
                newSavedQuotas[catName] = true;
            });
        }

        setQuotaConfigs(newQuotaConfigs);
        setSavedQuotas(newSavedQuotas);
        setQuotaGroupWise(newQuotaGroupWise);
        setQuotaGroupLateFees(newQuotaGroupLateFees);
        const firstQuota = availableQuotas[0];
        setExpandedWizardQuotas(firstQuota ? { [firstQuota]: true } : newSavedQuotas);
        setActiveQuotaIndex(0);
        setWizardStep(2);
        setIsModalOpen(true);
    };

    // Close the wizard modal. If in edit mode, reset all wizard state so create draft is not polluted.
    const closeWizardModal = () => {
        if (isEditingContext) {
            // Reset all wizard state before clearing edit flag
            setWizardStep(1);
            setWizardContext({ college: '', batch: '', course: '', branch: '', feeType: 'Yearly' });
            setActiveQuotaIndex(0);
            setQuotaConfigs({});
            setSavedQuotas({});
            setIsEditingContext(false);
        }
        setIsModalOpen(false);
    };

    const handleCancelEditContext = () => {
        setStructForm({
            feeHeadId: '',
            college: '',
            course: '',
            branch: '',
            batch: '',
            categories: [],
            academicYear: '',
            studentYear: '',
            amount: '',
            semester: '',
            isScholarshipApplicable: false,
            isTermsDivided: true
        });
        setBulkAmounts({});
        setBulkTerms({});
        setIsEditingContext(false);
        setIsModalOpen(false);
        setMessage('');
    };

    const deleteStruct = async (id) => {
        if (!window.confirm('Delete this Fee Structure?')) return;
        try {
            await api.delete(`/fee-structures/${id}`);
            setStructures(structures.filter(s => s._id !== id));
        } catch (error) { alert('Failed to delete structure'); }
    };

    // --- RENDER HELPERS ---
    const colleges = Object.keys(metadata);

    // Definitions Grouping (Grouped by Context + Quota/Category)
    const grouped = {};
    structures.filter(s => {
        // Dynamic Filtering based on Table Filters
        if (tableFilters.college && s.college !== tableFilters.college) return false;
        if (tableFilters.batch && String(s.batch) !== String(tableFilters.batch)) return false;
        if (tableFilters.course && s.course !== tableFilters.course) return false;
        if (tableFilters.branch && s.branch !== tableFilters.branch) return false;
        if (tableFilters.category && s.category !== tableFilters.category) return false;
        if (tableFilters.feeHeadId && s.feeHead?._id !== tableFilters.feeHeadId) return false;

        return true;
    }).forEach(st => {
        const key = `${st.college}|${st.batch}|${st.course}|${st.branch}`;
        if (!grouped[key]) {
            grouped[key] = {
                key,
                college: st.college,
                batch: st.batch,
                course: st.course,
                branch: st.branch,
                quotasMap: {}, // category -> { category, feeHeadsMap, matrix, allIds, grandTotal, yearTotals, feeHeadTotals }
                categories: [],
                allIds: [],
                grandTotal: 0
            };
        }

        const grp = grouped[key];
        const cat = st.category || 'General';
        if (!grp.quotasMap[cat]) {
            grp.quotasMap[cat] = {
                category: cat,
                feeHeadsMap: {},
                matrix: {},
                allIds: [],
                grandTotal: 0,
                yearTotals: {},
                feeHeadTotals: {}
            };
            grp.categories.push(cat);
        }

        const qGrp = grp.quotasMap[cat];
        const fhId = st.feeHead?._id || 'unknown';
        const fhName = st.feeHead?.name || 'Unnamed';
        const fhCode = st.feeHead?.code || '';
        const yr = st.studentYear;

        // Register fee head
        if (!qGrp.feeHeadsMap[fhId]) {
            qGrp.feeHeadsMap[fhId] = {
                _id: fhId,
                name: fhName,
                code: fhCode,
                isScholarshipApplicable: st.isScholarshipApplicable,
                isTermsDivided: st.isTermsDivided,
                termsCount: st.terms?.length || 0,
                lateFeeAmount: st.terms ? (st.terms.find(t => Number(t.lateFeeAmount) > 0)?.lateFeeAmount || 0) : 0
            };
        } else {
            if (st.isScholarshipApplicable) qGrp.feeHeadsMap[fhId].isScholarshipApplicable = true;
            if (st.isTermsDivided) qGrp.feeHeadsMap[fhId].isTermsDivided = true;
            if (st.terms?.length) {
                qGrp.feeHeadsMap[fhId].termsCount = Math.max(qGrp.feeHeadsMap[fhId].termsCount || 0, st.terms.length);
                const lfa = st.terms.find(t => Number(t.lateFeeAmount) > 0)?.lateFeeAmount || 0;
                if (lfa) qGrp.feeHeadsMap[fhId].lateFeeAmount = lfa;
            }
        }

        // Register matrix cell
        if (!qGrp.matrix[yr]) qGrp.matrix[yr] = {};
        if (!qGrp.matrix[yr][fhId]) qGrp.matrix[yr][fhId] = [];

        const item = {
            id: st._id,
            amount: Number(st.amount) || 0,
            semester: st.semester,
            terms: st.terms,
            isTermsDivided: st.isTermsDivided,
            isScholarshipApplicable: st.isScholarshipApplicable
        };

        qGrp.matrix[yr][fhId].push(item);
        qGrp.allIds.push(st._id);
        grp.allIds.push(st._id);

        // Totals
        const amt = Number(st.amount) || 0;
        qGrp.grandTotal += amt;
        qGrp.yearTotals[yr] = (qGrp.yearTotals[yr] || 0) + amt;
        qGrp.feeHeadTotals[fhId] = (qGrp.feeHeadTotals[fhId] || 0) + amt;
        grp.grandTotal += amt;
    });

    // Hierarchical Sorting: College -> Batch -> Course -> Branch
    const groupedArray = Object.values(grouped).sort((a, b) => {
        // 1. College wise
        const collegeA = String(a.college || '').toLowerCase();
        const collegeB = String(b.college || '').toLowerCase();
        if (collegeA !== collegeB) return collegeA.localeCompare(collegeB);

        // 2. Batch wise (descending, e.g. 2026, 2025, 2024...)
        const batchA = String(a.batch || '');
        const batchB = String(b.batch || '');
        if (batchA !== batchB) return batchB.localeCompare(batchA, undefined, { numeric: true });

        // 3. Course wise
        const courseA = String(a.course || '').toLowerCase();
        const courseB = String(b.course || '').toLowerCase();
        if (courseA !== courseB) return courseA.localeCompare(courseB);

        // 4. Branch wise
        const branchA = String(a.branch || '').toLowerCase();
        const branchB = String(b.branch || '').toLowerCase();
        return branchA.localeCompare(branchB);
    });

    // Calculate dynamic years for the Table based on Table Filters
    const tableYearsCount = getEffectiveYearsCount(tableFilters.college, tableFilters.course, tableFilters.branch);
    const tableYears = Array.from({ length: tableYearsCount }, (_, i) => i + 1);

    // semesters.batch is admission year ("2023"); fee/student batch may be "2023" or "2023-2027"
    const normalizeBatch = (batch) => String(batch || '').split('-')[0].trim();

    const findCalendarDate = (tm) => {
        if (!lateFeeForm.batch || !lateFeeForm.course || !calendarData.length) return null;
        const targetBatch = normalizeBatch(lateFeeForm.batch);
        if (!targetBatch) return null;

        const item = calendarData.find(ay =>
            normalizeBatch(ay.batch) === targetBatch &&
            ay.course_name === lateFeeForm.course &&
            Number(ay.year_of_study) === Number(tm.studentYear) &&
            (!tm.semester || Number(ay.semester_number) === Number(tm.semester)) &&
            (!ay.college_name || !lateFeeForm.college || ay.college_name === lateFeeForm.college) &&
            (tm.dueEventType === 'END_DATE' ? ay.end_date : ay.start_date)
        );

        if (!item) return null;
        return tm.dueEventType === 'START_DATE' ? item.start_date : item.end_date;
    };

    const getLateFeeApplicableDate = (s, term) => {
        if (!term) return { dateStr: null, semStartDateStr: null, reason: 'No term data' };

        if (term.dueDateMode === 'fixed') {
            if (!term.fixedDueDate) return { dateStr: null, semStartDateStr: null, reason: 'Fixed date not set' };
            const d = new Date(term.fixedDueDate);
            if (isNaN(d.getTime())) return { dateStr: null, semStartDateStr: null, reason: 'Invalid date' };
            return {
                dateStr: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
                semStartDateStr: null,
                rawDate: d
            };
        }

        if (!calendarData || !calendarData.length) {
            return { dateStr: null, semStartDateStr: null, reason: 'Loading calendar...' };
        }

        const targetBatch = normalizeBatch(s.batch);
        const targetSem = Number(term.referenceSemester || s.semester || 1);
        const targetYear = Number(s.studentYear);

        const match = calendarData.find(ay => {
            const bMatch = normalizeBatch(ay.batch) === targetBatch;
            const cMatch = !s.course || ay.course_name === s.course;
            const yMatch = Number(ay.year_of_study) === targetYear;
            const sMatch = Number(ay.semester_number) === targetSem;
            const clgMatch = !s.college || !ay.college_name ||
                ay.college_name === s.college ||
                ay.college_code === s.college ||
                collegeCodes[s.college] === ay.college_name ||
                collegeCodes[ay.college_name] === s.college;
            return bMatch && cMatch && yMatch && sMatch && clgMatch;
        }) || calendarData.find(ay => {
            return normalizeBatch(ay.batch) === targetBatch &&
                (!s.course || ay.course_name === s.course) &&
                Number(ay.year_of_study) === targetYear &&
                Number(ay.semester_number) === targetSem;
        });

        if (!match || !match.start_date) {
            return { dateStr: null, semStartDateStr: null, reason: `Sem ${targetSem} start date not in Academic Calendar` };
        }

        const rawStart = String(match.start_date).slice(0, 10);
        const parts = rawStart.match(/^(\d{4})-(\d{2})-(\d{2})/);
        let startDate;
        if (parts) {
            startDate = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
        } else {
            startDate = new Date(match.start_date);
        }

        if (isNaN(startDate.getTime())) {
            return { dateStr: null, semStartDateStr: null, reason: 'Invalid start date' };
        }

        const offsetDays = Number(term.dueOffsetDays) || 0;
        const dueDate = new Date(startDate);
        dueDate.setDate(dueDate.getDate() + offsetDays);

        const semStartDateFormatted = startDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const dueDateFormatted = dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

        return {
            dateStr: dueDateFormatted,
            semStartDateStr: semStartDateFormatted,
            offsetDays,
            refSem: targetSem,
            rawDate: dueDate
        };
    };

    const TAB_TITLES = {
        heads: { title: 'Fee Heads', desc: 'Manage fee heads.' },
        groups: { title: 'Fee Groups', desc: 'Manage fee groups and head mappings.' },
        definitions: { title: 'Fee Structures', desc: 'Manage fee structure definitions.' },
        latefees: { title: 'Late Fees', desc: 'Manage late fee rules and penalty settings.' }
    };

    return (
        <div className="flex min-h-screen bg-gray-50 font-sans">
            <Sidebar />
            <div className="flex-1 p-4 md:p-6">
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 pb-2 border-b border-gray-200 gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">
                            Fee Configuration {TAB_TITLES[activeTab] ? `- ${TAB_TITLES[activeTab].title}` : ''}
                        </h1>
                        <p className="text-sm text-gray-500 mt-1">
                            {TAB_TITLES[activeTab]?.desc || 'Manage fee configuration settings.'}
                        </p>
                    </div>
                    {activeTab === 'latefees' && (
                        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl shrink-0 self-start sm:self-auto flex-wrap">
                            <button
                                type="button"
                                onClick={() => setLateFeeSubTab('view')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${lateFeeSubTab === 'view' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Academic Config
                            </button>
                            <button
                                type="button"
                                onClick={() => setLateFeeSubTab('hostel')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${lateFeeSubTab === 'hostel' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Hostel Config
                            </button>
                            <button
                                type="button"
                                onClick={() => setLateFeeSubTab('transport')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${lateFeeSubTab === 'transport' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Transport Config
                            </button>
                            <button
                                type="button"
                                onClick={() => setLateFeeSubTab('due-dates')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${lateFeeSubTab === 'due-dates' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Default Rules
                            </button>
                            <button
                                type="button"
                                onClick={() => setLateFeeSubTab('setup')}
                                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${lateFeeSubTab === 'setup' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Setup Guide
                            </button>
                        </div>
                    )}
                    {activeTab === 'definitions' && (
                        <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                            <button
                                type="button"
                                onClick={handleOpenCreateWizard}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs md:text-sm font-bold px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition-all duration-200 flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                                Create Fee Structure
                            </button>
                            <FeeConfigPrintButton
                                variant="structures"
                                data={{
                                    rows: groupedArray.flatMap(group => 
                                        (group.categories || []).map(cat => {
                                            const qData = group.quotasMap[cat];
                                            const resolvedMatrix = {};
                                            if (qData && qData.matrix) {
                                                Object.keys(qData.matrix).forEach(yr => {
                                                    resolvedMatrix[yr] = {};
                                                    Object.keys(qData.matrix[yr] || {}).forEach(fhId => {
                                                        resolvedMatrix[yr][fhId] = (qData.matrix[yr][fhId] || []).map(item => {
                                                            let resolvedTerms = [];
                                                            if (Array.isArray(item.terms) && item.terms.length > 0) {
                                                                resolvedTerms = item.terms;
                                                            } else {
                                                                const structTermsCount = 1;
                                                                const matchingDefaultConfig = defaultConfigs.find(c => Number(c.termsCount) === structTermsCount);
                                                                resolvedTerms = (matchingDefaultConfig?.terms || []).map(dt => ({
                                                                    termNumber: dt.termNumber,
                                                                    percentage: 100,
                                                                    amount: item.amount,
                                                                    lateFeeAmount: 0
                                                                }));
                                                                if (resolvedTerms.length === 0) {
                                                                    resolvedTerms = [{
                                                                        termNumber: 1,
                                                                        percentage: 100,
                                                                        amount: item.amount,
                                                                        lateFeeAmount: 0
                                                                    }];
                                                                }
                                                            }
                                                            return {
                                                                ...item,
                                                                terms: resolvedTerms
                                                            };
                                                        });
                                                    });
                                                });
                                            }
                                            return {
                                                college: group.college,
                                                batch: group.batch,
                                                course: group.course,
                                                branch: group.branch,
                                                category: cat,
                                                feeHeadsMap: qData?.feeHeadsMap || {},
                                                matrix: resolvedMatrix,
                                                grandTotal: qData?.grandTotal || 0,
                                                yearTotals: qData?.yearTotals || {},
                                                feeHeadTotals: qData?.feeHeadTotals || {}
                                            };
                                        })
                                    ),
                                    tableYears,
                                    collegeCodes,
                                    filters: {
                                        college: tableFilters.college || '',
                                        course: tableFilters.course || '',
                                        branch: tableFilters.branch || '',
                                        batch: tableFilters.batch || '',
                                        category: tableFilters.category || '',
                                        feeHeadName: feeHeads.find(h => h._id === tableFilters.feeHeadId)?.name || '',
                                    }
                                }}
                                 label="Print"
                                 disabled={
                                     groupedArray.length === 0 ||
                                     [
                                         tableFilters.college,
                                         tableFilters.batch,
                                         tableFilters.course,
                                         tableFilters.branch,
                                         tableFilters.category,
                                         tableFilters.feeHeadId
                                     ].filter(Boolean).length < 3
                                 }
                             />

                         </div>
                     )}
                </div>

                {message && <div className="p-3 bg-green-50 text-green-700 rounded mb-4 border border-green-200">{message}</div>}

                {/* --- TAB 1: HEADS --- */}
                {activeTab === 'heads' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 h-fit">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="font-semibold text-gray-800">{editHeadId ? 'Edit Fee Head' : 'Add Fee Head'}</h2>
                                {editHeadId && <button onClick={() => { setEditHeadId(null); setHeadForm({ name: '', description: '' }); }} className="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300">Cancel</button>}
                            </div>
                            <form onSubmit={activeHeadSubmit} className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <input className="w-full border p-2 rounded" placeholder="Name (e.g. Tuition)" value={headForm.name} onChange={e => setHeadForm({ ...headForm, name: e.target.value })} required />
                                    <input className="w-full border p-2 rounded disabled:bg-gray-100 disabled:text-gray-400" placeholder="Code (e.g. TUI01)" value={headForm.code} onChange={e => setHeadForm({ ...headForm, code: e.target.value })} disabled={!!editHeadId} />
                                </div>
                                <textarea className="w-full border p-2 rounded" placeholder="Description" value={headForm.description} onChange={e => setHeadForm({ ...headForm, description: e.target.value })} />
                                <button className={`w-full text-white py-2 rounded ${editHeadId ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                                    {editHeadId ? 'Update Fee Head' : 'Add Fee Head'}
                                </button>
                            </form>
                        </div>
                        <div className="md:col-span-2 bg-white p-5 rounded-lg shadow-sm">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="font-semibold text-gray-800">Existing Heads</h2>
                                <FeeConfigPrintButton
                                    variant="heads"
                                    data={{ reportData: feeHeads }}
                                    label="Print"
                                    disabled={feeHeads.length === 0}
                                />
                            </div>
                            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr><th className="p-2">Name</th><th className="p-2">Code</th><th className="p-2">Desc</th><th className="p-2">Status</th><th className="p-2 text-right">Action</th></tr></thead>
                                <tbody>{feeHeads.map(h => (
                                    <tr key={h._id} className="border-t hover:bg-gray-50">
                                        <td className="p-2 font-medium">{h.name}</td>
                                        <td className="p-2 text-mono text-gray-600">{h.code || '-'}</td>
                                        <td className="p-2 text-gray-500 text-sm">{h.description}</td>
                                        <td className="p-2">
                                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${h.isActive !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                                                {h.isActive !== false ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-2 text-right space-x-2 flex justify-end">
                                            <button onClick={() => handleEditHead(h)} className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded transition" title="Edit"><Pencil size={16} /></button>
                                            <button onClick={() => toggleHeadActive(h)} className={`p-2 rounded transition ${h.isActive !== false ? 'text-amber-600 bg-amber-50 hover:bg-amber-100' : 'text-green-600 bg-green-50 hover:bg-green-100'}`} title={h.isActive !== false ? 'Deactivate' : 'Activate'}>
                                                {h.isActive !== false ? <ToggleLeft size={16} /> : <ToggleRight size={16} />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}</tbody></table></div>
                        </div>
                    </div>
                )}

                {/* --- TAB 1B: FEE GROUPS --- */}
                {activeTab === 'groups' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in duration-200">
                        {/* Group Add/Edit Panel */}
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 h-fit">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="font-semibold text-gray-800">{editGroupId ? 'Edit Fee Group' : 'Add Fee Group'}</h2>
                                {editGroupId && (
                                    <button 
                                        onClick={() => { 
                                            setEditGroupId(null); 
                                            setGroupForm({ name: '', code: '', description: '', feeHeads: [] }); 
                                        }} 
                                        className="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300 transition"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                            <form onSubmit={activeGroupSubmit} className="space-y-4 text-sm">
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-500 block">Group Name</label>
                                        <input 
                                            className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none transition text-xs font-semibold" 
                                            placeholder="e.g. Tuition Fee Group" 
                                            value={groupForm.name} 
                                            onChange={e => setGroupForm({ ...groupForm, name: e.target.value })} 
                                            required 
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-500 block">Group Code</label>
                                        <input 
                                            className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none transition uppercase text-xs font-mono font-bold" 
                                            placeholder="e.g. TUI" 
                                            maxLength={10}
                                            value={groupForm.code} 
                                            onChange={e => setGroupForm({ ...groupForm, code: e.target.value.toUpperCase().replace(/\s/g, '') })} 
                                            required 
                                        />
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-500 block">Description</label>
                                    <textarea 
                                        className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none transition" 
                                        placeholder="Group description..." 
                                        value={groupForm.description} 
                                        onChange={e => setGroupForm({ ...groupForm, description: e.target.value })} 
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 block">Select Fee Heads</label>
                                    <div className="max-h-[220px] overflow-y-auto border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50 scrollbar-thin">
                                        {feeHeads.filter(fh => {
                                            const otherGroup = feeGroups.find(g => 
                                                g._id !== editGroupId && 
                                                g.feeHeads.some(h => (h._id || h) === fh._id)
                                            );
                                            return !otherGroup;
                                        }).length === 0 && (
                                            <p className="text-xs text-gray-400 italic text-center py-2">All fee heads are already grouped.</p>
                                        )}
                                        {feeHeads
                                            .filter(fh => {
                                                const otherGroup = feeGroups.find(g => 
                                                    g._id !== editGroupId && 
                                                    g.feeHeads.some(h => (h._id || h) === fh._id)
                                                );
                                                return !otherGroup;
                                            })
                                            .map(fh => (
                                                <label 
                                                    key={fh._id} 
                                                    className="flex items-center gap-2 p-1.5 rounded transition cursor-pointer hover:bg-white"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={groupForm.feeHeads.includes(fh._id)}
                                                        onChange={e => {
                                                            const isChecked = e.target.checked;
                                                            let updated = [...groupForm.feeHeads];
                                                            if (isChecked) {
                                                                updated.push(fh._id);
                                                            } else {
                                                                updated = updated.filter(id => id !== fh._id);
                                                            }
                                                            setGroupForm({ ...groupForm, feeHeads: updated });
                                                        }}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                                    />
                                                    <span className="text-xs text-gray-700 font-medium">{fh.name}</span>
                                                </label>
                                            ))
                                        }
                                    </div>
                                    {groupForm.feeHeads.length === 0 && (
                                        <p className="text-[10px] text-red-500 font-medium">Select at least one fee head.</p>
                                    )}
                                </div>
                                <button 
                                    disabled={isSavingGroup || groupForm.feeHeads.length === 0}
                                    className={`w-full text-white py-2 rounded font-bold transition flex items-center justify-center gap-2 ${
                                        (isSavingGroup || groupForm.feeHeads.length === 0) 
                                            ? 'bg-gray-400 cursor-not-allowed' 
                                            : (editGroupId ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700')
                                    }`}
                                >
                                    {isSavingGroup ? 'Saving...' : (editGroupId ? 'Update Fee Group' : 'Add Fee Group')}
                                </button>
                            </form>
                        </div>

                        {/* Existing Groups Table */}
                        <div className="md:col-span-2 bg-white p-5 rounded-lg shadow-sm border border-gray-100">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="font-semibold text-gray-800">Existing Fee Groups</h2>
                                <FeeConfigPrintButton
                                    variant="groups"
                                    data={{ reportData: feeGroups }}
                                    label="Print"
                                    disabled={feeGroups.length === 0}
                                />
                            </div>
                            {feeGroups.length === 0 ? (
                                <p className="text-gray-400 italic text-sm">No fee groups defined yet.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm border-collapse">
                                        <thead className="bg-gray-50 border-b">
                                            <tr>
                                                <th className="p-3 w-1/4">Name / Code</th>
                                                <th className="p-3 w-1/4">Description</th>
                                                <th className="p-3 w-2/5">Included Fee Heads</th>
                                                <th className="p-3 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {feeGroups.map(g => (
                                                <tr key={g._id} className="hover:bg-gray-50/50 transition-colors">
                                                    <td className="p-3">
                                                        <div className="font-semibold text-gray-800">{g.name}</div>
                                                        <div className="text-[10px] font-mono font-bold text-blue-600 uppercase bg-blue-50 w-fit px-1.5 py-0.5 rounded border border-blue-100 mt-1">{g.code}</div>
                                                    </td>
                                                    <td className="p-3 text-gray-500 text-xs">{g.description || '-'}</td>
                                                    <td className="p-3">
                                                        <div className="flex flex-wrap gap-1 max-h-[100px] overflow-y-auto scrollbar-thin">
                                                            {g.feeHeads && g.feeHeads.map(fh => (
                                                                <span key={fh._id} className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-100 uppercase whitespace-nowrap">
                                                                    {fh.name}
                                                                </span>
                                                            ))}
                                                            {(!g.feeHeads || g.feeHeads.length === 0) && <span className="text-xs text-gray-400 italic">None</span>}
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-right">
                                                        <div className="flex justify-end gap-2">
                                                            <button 
                                                                onClick={() => handleEditGroup(g)} 
                                                                className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded transition" 
                                                                title="Edit"
                                                            >
                                                                <Pencil size={16} />
                                                            </button>
                                                            <button 
                                                                onClick={() => deleteGroup(g._id)} 
                                                                className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded transition" 
                                                                title="Delete"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- TAB 2: DEFINITIONS --- */}
                {activeTab === 'definitions' && (
                    <div className="space-y-6">
                        {/* Full-width Fee Templates Table Card */}
                        <div className="w-full bg-white p-5 md:p-6 rounded-xl shadow-sm border border-gray-100">
                            {/* Table Filters Bar */}
                            <div className="bg-gray-50/90 p-3.5 rounded-xl border border-gray-200/80 mb-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-[1.6fr_1fr_1fr_1fr_1fr_1fr_auto] gap-3 items-end">
                                <div>
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">College</label>
                                    <select 
                                        className="w-full border border-gray-200 bg-white p-2 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none transition" 
                                        value={tableFilters.college} 
                                        onChange={e => setTableFilters({ ...tableFilters, college: e.target.value, course: '', branch: '' })}
                                    >
                                        <option value="">All Colleges</option>
                                        {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">Batch</label>
                                    <select 
                                        className="w-full border border-gray-200 bg-white p-2 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none transition" 
                                        value={tableFilters.batch} 
                                        onChange={e => setTableFilters({ ...tableFilters, batch: e.target.value })}
                                    >
                                        <option value="">All Batches</option>
                                        {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">Course</label>
                                    <select 
                                        className="w-full border border-gray-200 bg-white p-2 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none transition disabled:bg-gray-100 disabled:text-gray-400" 
                                        value={tableFilters.course} 
                                        onChange={e => setTableFilters({ ...tableFilters, course: e.target.value, branch: '' })}
                                        disabled={!tableFilters.college}
                                    >
                                        <option value="">All Courses</option>
                                        {(tableFilters.college ? Object.keys(metadata[tableFilters.college] || {}) : []).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>

                                <div>
                                    <label className="text-[11px] font-bold text-gray-600 block mb-1 uppercase tracking-wider">Branch</label>
                                    <select 
                                        className="w-full border border-gray-200 bg-white p-2 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none transition disabled:bg-gray-100 disabled:text-gray-400" 
                                        value={tableFilters.branch} 
                                        onChange={e => setTableFilters({ ...tableFilters, branch: e.target.value })}
                                        disabled={!tableFilters.course}
                                    >
                                        <option value="">All Branches</option>
                                        {((tableFilters.college && tableFilters.course) 
                                            ? (metadata[tableFilters.college]?.[tableFilters.course]?.branches || []) 
                                            : []
                                         ).map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                </div>

                                <div className="shrink-0">
                                    {(tableFilters.college || tableFilters.batch || tableFilters.course || tableFilters.branch) ? (
                                        <button
                                            type="button"
                                            onClick={() => setTableFilters({ college: '', batch: '', course: '', branch: '', category: '', feeHeadId: '' })}
                                            className="px-3.5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-bold rounded-lg transition text-center shrink-0 w-auto"
                                        >
                                           Clear
                                        </button>
                                    ) : (
                                        <div className="text-[11px] text-gray-400 font-medium py-2 px-1 text-center italic whitespace-nowrap">No filters active</div>
                                    )}
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-600 font-semibold">
                                        <tr>
                                            <th className="p-3">College / Batch</th>
                                            <th className="p-3">Course & Branch</th>
                                            <th className="p-3">Category (Quota)</th>
                                            <th className="p-3 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {isLoadingStructures ? (
                                            Array.from({ length: 5 }).map((_, idx) => (
                                                <tr key={idx} className="animate-pulse">
                                                    <td className="p-3"><div className="h-4 bg-slate-200 rounded w-36 mb-1"></div><div className="h-3 bg-slate-100 rounded w-24"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-slate-200 rounded w-28 mb-1"></div><div className="h-3 bg-slate-100 rounded w-16"></div></td>
                                                    <td className="p-3"><div className="h-6 bg-slate-200 rounded-full w-20"></div></td>
                                                    <td className="p-3 text-right"><div className="h-8 bg-slate-200 rounded-lg w-24 ml-auto"></div></td>
                                                </tr>
                                            ))
                                        ) : groupedArray.length === 0 ? (
                                            <tr>
                                                <td colSpan={4} className="p-10 text-center text-gray-400 italic">
                                                    <div className="flex flex-col items-center justify-center gap-2">
                                                        <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                                        <span>No fee templates found for selected filters.</span>
                                                        <button onClick={handleOpenCreateWizard} className="text-xs text-blue-600 font-semibold hover:underline mt-1">
                                                            + Define Standard Fees Now
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            groupedArray.map((row, i) => {
                                                const isExpanded = !!expandedRows[row.key];

                                                return (
                                                    <React.Fragment key={row.key || i}>
                                                        <tr 
                                                            onClick={() => toggleRowExpand(row.key)}
                                                            className={`cursor-pointer hover:bg-blue-50/50 transition-colors group/row ${isExpanded ? 'bg-blue-50/40' : ''}`}
                                                        >
                                                            {/* 1. College / Batch */}
                                                            <td className="p-3 text-xs text-gray-700">
                                                                <div className="flex items-center gap-2">
                                                                    <ChevronRight size={16} className={`text-gray-400 group-hover/row:text-blue-600 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                    <span className="font-bold text-gray-900">{collegeCodes[row.college] || row.college}</span>
                                                                    <span className="text-blue-600 font-mono font-medium bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-100 shrink-0">{row.batch}</span>
                                                                </div>
                                                            </td>

                                                            {/* 2. Course & Branch */}
                                                            <td className="p-3 text-xs">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="font-bold text-gray-800">{row.course}</span>
                                                                    <span className="text-gray-400 font-normal">-</span>
                                                                    <span className="text-gray-600 font-medium">{row.branch}</span>
                                                                </div>
                                                            </td>

                                                            {/* 3. Category (Quota) - All Quotas */}
                                                            <td className="p-3">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    {row.categories.map(cat => (
                                                                        <span key={cat} className="bg-purple-100 text-purple-800 text-xs px-2.5 py-0.5 rounded-full font-bold border border-purple-200">
                                                                            {cat}
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            </td>

                                                            {/* 4. Actions */}
                                                            <td className="p-3 text-right">
                                                                <div className="flex justify-end items-center gap-2" onClick={e => e.stopPropagation()}>
                                                                     <button
                                                                        onClick={() => handleEditStructureRow(row)}
                                                                        className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-2 rounded-lg transition"
                                                                        title="Edit Fee Structure"
                                                                    >
                                                                        <Pencil size={16} />
                                                                    </button>

                                                                    <button
                                                                        onClick={async () => {
                                                                            if (!window.confirm(`Delete ALL fee definitions for ${row.course} - ${row.branch} (${row.batch})?`)) return;
                                                                            try {
                                                                                await Promise.all(row.allIds.map(id => api.delete(`/fee-structures/${id}`)));
                                                                                fetchStructures();
                                                                            } catch (e) { alert('Delete failed'); }
                                                                        }}
                                                                        className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-2 rounded-lg transition"
                                                                        title="Delete Fee Structure"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>

                                                        {/* EXPANDABLE SECTION FOR QUOTAS - MATCHING CREATION MATRIX TABLES */}
                                                        {isExpanded && (
                                                            <tr>
                                                                <td colSpan={4} className="p-0 bg-slate-50/70 border-y-2 border-blue-100">
                                                                    <div className="p-4 space-y-4">
                                                                        {row.categories.map(catName => {
                                                                            const quotaKey = `${row.key}|${catName}`;
                                                                            const isQuotaExpanded = !!expandedQuotas[quotaKey];
                                                                            const qData = row.quotasMap[catName];
                                                                            const qFeeHeads = Object.values(qData?.feeHeadsMap || {});
                                                                            const isConfigured = qFeeHeads.length > 0 || Object.values(qData?.matrix || {}).some(yrMap => Object.keys(yrMap).length > 0);
                                                                            const yearsCount = getEffectiveYearsCount(row.college, row.course, row.branch);
                                                                            const hasSemesters = Object.values(qData?.matrix || {}).some(yrMap =>
                                                                                Object.values(yrMap).some(items => items.some(it => it.semester))
                                                                            );
                                                                            const matrixRows = [];
                                                                            for (let y = 1; y <= yearsCount; y++) {
                                                                                if (!hasSemesters) {
                                                                                    matrixRows.push({ year: y, semester: null, rowKey: `${y}-Y`, label: `Year ${y}` });
                                                                                } else {
                                                                                    matrixRows.push({ year: y, semester: 1, rowKey: `${y}-S1`, label: `Yr ${y} Sem 1` });
                                                                                    matrixRows.push({ year: y, semester: 2, rowKey: `${y}-S2`, label: `Yr ${y} Sem 2` });
                                                                                }
                                                                            }
                                                                            return (
                                                                                <div key={catName} className="border border-gray-200 rounded-xl bg-white shadow-xs overflow-hidden transition-all duration-200">
                                                                                    {/* Quota Header Bar - Click to Expand / Collapse */}
                                                                                    <div
                                                                                        onClick={() => toggleQuotaExpand(quotaKey)}
                                                                                        className={`px-4 py-2.5 flex items-center justify-between cursor-pointer select-none transition-colors ${isQuotaExpanded ? 'bg-slate-100/90 border-b border-gray-200 hover:bg-slate-200/60' : 'bg-white hover:bg-gray-50'}`}
                                                                                    >
                                                                                        <div className="flex items-center gap-2">
                                                                                            <ChevronRight size={16} className={`text-gray-500 transition-transform duration-200 shrink-0 ${isQuotaExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                                            <span className="font-bold text-gray-800 text-xs md:text-sm">{catName}</span>
                                                                                            <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">
                                                                                                Quota
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
                                                                                            <span>Quota Total: <span className="font-mono font-bold text-blue-900">₹{(qData?.grandTotal || 0).toLocaleString('en-IN')}</span></span>
                                                                                            <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isQuotaExpanded ? 'rotate-180 text-blue-600' : ''}`} />
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Quota Matrix Table - Expandable & Collapsible (Closed by Default) */}
                                                                                    {isQuotaExpanded && (isConfigured ? (
                                                                                        <div className="overflow-x-auto">
                                                                                             <table className="w-full text-center text-xs border-collapse">
                                                                                                 <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                                                                                                     <tr>
                                                                                                         <th className="p-2.5 border-r border-gray-200 w-36 font-bold bg-gray-100/70 text-left">Fee Head</th>
                                                                                                         {matrixRows.map(rowInfo => (
                                                                                                             <th key={rowInfo.rowKey} className="p-2.5 border-r border-gray-200 w-28 font-bold bg-gray-50 text-center">
                                                                                                                 {rowInfo.label}
                                                                                                             </th>
                                                                                                         ))}
                                                                                                         <th className="p-2.5 border-r border-gray-200 w-28 font-bold bg-gray-100/70 text-center">Total</th>
                                                                                                     </tr>
                                                                                                 </thead>
                                                                                                 <tbody className="divide-y divide-gray-100">
                                                                                                     {qFeeHeads.map(fh => {
                                                                                                         const fhTotal = qData?.feeHeadTotals?.[fh._id] || 0;
                                                                                                         return (
                                                                                                             <tr key={fh._id} className="hover:bg-gray-50/80">
                                                                                                                 <td className="p-2.5 border-r border-gray-200 align-top space-y-1 text-left bg-gray-50">
                                                                                                                     <div className="font-bold text-gray-900 text-xs">{fh.name}</div>
                                                                                                                     <div className="flex items-center justify-start gap-1.5 text-[10px] text-gray-600">
                                                                                                                         {fh.isTermsDivided && (
                                                                                                                             <span className="bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold border border-blue-200">
                                                                                                                                 Terms: {fh.termsCount || 'Divided'}
                                                                                                                             </span>
                                                                                                                         )}
                                                                                                                         {fh.isScholarshipApplicable && (
                                                                                                                             <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold border border-amber-200">
                                                                                                                                 Scholarship
                                                                                                                             </span>
                                                                                                                         )}
                                                                                                                     </div>
                                                                                                                 </td>
                                                                                                                 {matrixRows.map(rowInfo => {
                                                                                                                     const items = qData?.matrix?.[rowInfo.year]?.[fh._id] || [];
                                                                                                                     const matchItem = items.find(it => rowInfo.semester ? Number(it.semester) === Number(rowInfo.semester) : !it.semester);
                                                                                                                     const amt = matchItem ? matchItem.amount : 0;
                                                                                                                     const terms = matchItem?.terms || [];
                                                                                                                     return (
                                                                                                                         <td key={rowInfo.rowKey} className="p-2 border-r border-gray-200 align-top space-y-1 text-center">
                                                                                                                             <div className="font-mono font-bold text-gray-800 text-xs">
                                                                                                                                 {amt > 0 ? `₹${amt.toLocaleString('en-IN')}` : <span className="text-gray-300 font-normal italic">-</span>}
                                                                                                                             </div>
                                                                                                                             {matchItem?.isTermsDivided && terms.length > 0 && (
                                                                                                                                 <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                                                                                                                                     {terms.map(t => (
                                                                                                                                         <div key={t.termNumber} className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded flex items-center gap-1 text-[10px] whitespace-nowrap">
                                                                                                                                             <span className="text-[9px] text-gray-500 font-bold">T{t.termNumber}</span>
                                                                                                                                             <span className="text-[10px] font-bold text-blue-600 font-mono">₹{t.amount !== undefined && t.amount !== null ? Number(t.amount).toLocaleString('en-IN') : '0'}</span>
                                                                                                                                         </div>
                                                                                                                                     ))}
                                                                                                                                 </div>
                                                                                                                             )}
                                                                                                                         </td>
                                                                                                                     );
                                                                                                                 })}
                                                                                                                 <td className="p-2.5 border-r border-gray-200 font-mono font-bold text-blue-900 text-center">
                                                                                                                     ₹{fhTotal.toLocaleString('en-IN')}
                                                                                                                 </td>
                                                                                                             </tr>
                                                                                                         );
                                                                                                     })}
                                                                                                 </tbody>
                                                                                                 <tfoot className="bg-gray-100 font-bold border-t border-gray-300">
                                                                                                     <tr>
                                                                                                         <td className="p-2.5 border-r border-gray-200 text-center">Total</td>
                                                                                                         {matrixRows.map(rowInfo => {
                                                                                                             let periodTotal = 0;
                                                                                                             qFeeHeads.forEach(fh => {
                                                                                                                 const items = qData?.matrix?.[rowInfo.year]?.[fh._id] || [];
                                                                                                                 const matchItem = items.find(it => rowInfo.semester ? Number(it.semester) === Number(rowInfo.semester) : !it.semester);
                                                                                                                 if (matchItem) periodTotal += matchItem.amount || 0;
                                                                                                             });
                                                                                                             return (
                                                                                                                 <td key={rowInfo.rowKey} className="p-2.5 border-r border-gray-200 font-mono text-blue-900 text-center">
                                                                                                                     ₹{periodTotal.toLocaleString('en-IN')}
                                                                                                                 </td>
                                                                                                             );
                                                                                                         })}
                                                                                                         <td className="p-2.5 border-r border-gray-200 font-mono text-blue-900 text-center">
                                                                                                             ₹{(qData?.grandTotal || 0).toLocaleString('en-IN')}
                                                                                                         </td>
                                                                                                     </tr>
                                                                                                 </tfoot>
                                                                                             </table>
                                                                                        </div>
                                                                                     ) : (
                                                                                         <div className="p-6 text-center bg-gray-50 border border-dashed border-gray-300 rounded-lg my-2">
                                                                                             <p className="text-sm text-gray-600 font-semibold">Not Configured</p>
                                                                                             <p className="text-xs text-gray-400 mt-1">No fee heads have been set up for this quota.</p>
                                                                                         </div>
                                                                                     ))}
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Modal Popup for "Define Standard Fees" - Simple & Clean UI */}
                        {isModalOpen && (
                            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs overflow-y-auto">
                                <div className="relative bg-white w-full max-w-6xl max-h-[90vh] rounded-xl shadow-xl border border-gray-200 flex flex-col my-auto overflow-hidden text-gray-800">
                                    
                                    {/* Modal Header */}
                                    <div className="px-6 py-4 bg-white border-b border-gray-200 flex justify-between items-center shrink-0">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h2 className="text-lg font-bold text-gray-800">{isEditingContext ? 'Edit Fee Structure' : 'Create Fee Structure'}</h2>
                                                <span className="bg-blue-50 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-blue-200">
                                                    Step {wizardStep} of 2
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {wizardStep === 1 
                                                    ? 'Select College, Batch, Course and Branch context.' 
                                                    : 'Configure Fee Head columns and amounts quota by quota.'}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {!isEditingContext && (wizardContext.college || Object.keys(quotaConfigs).length > 0) && (
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (window.confirm("Are you sure you want to reset and clear all draft configuration?")) {
                                                            clearWizardDraft();
                                                        }
                                                    }}
                                                    className="text-xs text-red-600 hover:text-red-800 hover:bg-red-50 font-semibold px-2.5 py-1 rounded border border-red-200 transition"
                                                >
                                                    Reset Draft
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => setIsModalOpen(false)}
                                                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition"
                                                title="Close"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Stepper Tabs Bar */}
                                    <div className="bg-gray-50 border-b border-gray-200 px-6 py-2 flex items-center gap-6 text-xs font-semibold shrink-0">
                                        <button 
                                            type="button"
                                            onClick={() => setWizardStep(1)}
                                            className={`flex items-center gap-2 py-1 transition ${wizardStep === 1 ? 'text-blue-600 font-bold border-b-2 border-blue-600 -mb-2' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${wizardStep === 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>1</span>
                                            1. Context Selection
                                        </button>

                                        <button 
                                            type="button"
                                            onClick={() => {
                                                if (wizardContext.college && wizardContext.batch && wizardContext.course && wizardContext.branch) {
                                                    setWizardStep(2);
                                                }
                                            }}
                                            disabled={!wizardContext.college || !wizardContext.batch || !wizardContext.course || !wizardContext.branch}
                                            className={`flex items-center gap-2 py-1 transition ${wizardStep === 2 ? 'text-blue-600 font-bold border-b-2 border-blue-600 -mb-2' : 'text-gray-500 hover:text-gray-700 disabled:opacity-40'}`}
                                        >
                                            <span className={`w-5 h-5 rounded-full text-[11px] flex items-center justify-center font-bold ${wizardStep === 2 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'}`}>2</span>
                                            2. Quota-wise Setup
                                        </button>
                                    </div>

                                    {/* Modal Content Area */}
                                    <div className="p-6 overflow-y-auto flex-1 space-y-6">

                                        {/* STEP 1: CONTEXT SELECTION */}
                                        {wizardStep === 1 && (
                                            <div className="max-w-2xl mx-auto space-y-6 py-2">
                                                <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 space-y-4">
                                                    <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider border-b pb-2">Academic Context</h3>

                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                        {/* College */}
                                                        <div>
                                                            <label className="text-xs font-bold text-gray-700 block mb-1">College *</label>
                                                            <select 
                                                                className="w-full border border-gray-300 bg-white p-2 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                                                                value={wizardContext.college}
                                                                onChange={e => setWizardContext({ ...wizardContext, college: e.target.value, course: '', branch: '' })}
                                                                required
                                                            >
                                                                <option value="">Select College</option>
                                                                {colleges.map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
                                                        </div>

                                                        {/* Batch */}
                                                        <div>
                                                            <label className="text-xs font-bold text-gray-700 block mb-1">Batch *</label>
                                                            <select 
                                                                className="w-full border border-gray-300 bg-white p-2 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                                                                value={wizardContext.batch}
                                                                onChange={e => setWizardContext({ ...wizardContext, batch: e.target.value })}
                                                                required
                                                            >
                                                                <option value="">Select Batch</option>
                                                                {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                                            </select>
                                                        </div>

                                                        {/* Course */}
                                                        <div>
                                                            <label className="text-xs font-bold text-gray-700 block mb-1">Course *</label>
                                                            <select 
                                                                className="w-full border border-gray-300 bg-white p-2 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                                                                value={wizardContext.course}
                                                                onChange={e => setWizardContext({ ...wizardContext, course: e.target.value, branch: '' })}
                                                                disabled={!wizardContext.college}
                                                                required
                                                            >
                                                                <option value="">Select Course</option>
                                                                {(wizardContext.college ? Object.keys(metadata[wizardContext.college] || {}) : []).map(c => <option key={c} value={c}>{c}</option>)}
                                                            </select>
                                                        </div>

                                                        {/* Branch */}
                                                        <div>
                                                            <label className="text-xs font-bold text-gray-700 block mb-1">Branch *</label>
                                                            <select 
                                                                className="w-full border border-gray-300 bg-white p-2 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none disabled:bg-gray-100"
                                                                value={wizardContext.branch}
                                                                onChange={e => setWizardContext({ ...wizardContext, branch: e.target.value })}
                                                                disabled={!wizardContext.course}
                                                                required
                                                            >
                                                                <option value="">Select Branch</option>
                                                                {(metadata[wizardContext.college]?.[wizardContext.course]?.branches || []).map(b => <option key={b} value={b}>{b}</option>)}
                                                            </select>
                                                        </div>
                                                    </div>

                                                    {/* Structure Type */}
                                                    <div className="pt-3 border-t">
                                                        <label className="text-xs font-bold text-gray-700 block mb-2">Structure Type</label>
                                                        <div className="flex gap-4">
                                                            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                                                                <input 
                                                                    type="radio" 
                                                                    name="feeType" 
                                                                    checked={wizardContext.feeType === 'Yearly'} 
                                                                    onChange={() => setWizardContext({ ...wizardContext, feeType: 'Yearly' })} 
                                                                /> 
                                                                Yearly Structure
                                                            </label>

                                                            <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                                                                <input 
                                                                    type="radio" 
                                                                    name="feeType" 
                                                                    checked={wizardContext.feeType === 'Semester'} 
                                                                    onChange={() => setWizardContext({ ...wizardContext, feeType: 'Semester' })} 
                                                                /> 
                                                                Semester-wise Structure
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Action Buttons */}
                                                <div className="flex justify-end gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => setIsModalOpen(false)}
                                                        className="px-4 py-2 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition"
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        type="button"
                                                        disabled={!wizardContext.college || !wizardContext.batch || !wizardContext.course || !wizardContext.branch}
                                                        onClick={() => {
                                                            setWizardStep(2);
                                                            if (Object.keys(expandedWizardQuotas).length === 0 && availableQuotas[0]) {
                                                                setExpandedWizardQuotas({ [availableQuotas[0]]: true });
                                                            }
                                                        }}
                                                        className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition flex items-center gap-1.5"
                                                    >
                                                        <span>Next: Configure Quotas</span>
                                                        <ChevronRight size={16} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* STEP 2: QUOTA-WISE SETUP */}
                                        {wizardStep === 2 && (
                                            <div className="space-y-4">
                                                {/* Context Summary Bar */}
                                                <div className="bg-blue-50/80 border border-blue-200 p-2.5 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                                                    <div className="flex items-center gap-2 font-medium text-gray-800">
                                                        <span className="font-bold text-blue-900">{wizardContext.college}</span>
                                                        <span>•</span>
                                                        <span>Batch {wizardContext.batch}</span>
                                                        <span>•</span>
                                                        <span>{wizardContext.course} ({wizardContext.branch})</span>
                                                        <span>•</span>
                                                        <span className="text-gray-500">{wizardContext.feeType}</span>
                                                    </div>

                                                    <button
                                                        type="button"
                                                        onClick={() => setWizardStep(1)}
                                                        className="text-xs text-blue-700 hover:underline font-semibold"
                                                    >
                                                        Change Context
                                                    </button>
                                                </div>

                                                {/* Quotas Accordion List */}
                                                <div className="space-y-3">
                                                    {availableQuotas.map((quotaName, qIndex) => {
                                                        const isExpanded = !!expandedWizardQuotas[quotaName];
                                                        const isSaved = !!savedQuotas[quotaName];
                                                        const currentConfig = getQuotaConfig(quotaName);

                                                        // All quotas are always accessible — toggle independently
                                                        const handleQuotaClick = () => {
                                                            setWizardError('');
                                                            setExpandedWizardQuotas(prev => ({ ...prev, [quotaName]: !prev[quotaName] }));
                                                        };

                                                        // Compute Matrix Rows
                                                        const yearsCount = getEffectiveYearsCount(wizardContext.college, wizardContext.course, wizardContext.branch);
                                                        const matrixRows = [];
                                                        for (let y = 1; y <= yearsCount; y++) {
                                                            if (wizardContext.feeType === 'Yearly') {
                                                                matrixRows.push({ year: y, semester: null, rowKey: `${y}-Y`, label: `Year ${y}` });
                                                            } else {
                                                                matrixRows.push({ year: y, semester: 1, rowKey: `${y}-S1`, label: `Yr ${y} Sem 1` });
                                                                matrixRows.push({ year: y, semester: 2, rowKey: `${y}-S2`, label: `Yr ${y} Sem 2` });
                                                            }
                                                        }

                                                        // Calculate Grand Total for quota
                                                        let quotaTotal = 0;
                                                        currentConfig.columns.forEach(col => {
                                                            matrixRows.forEach(row => {
                                                                const key = `${row.rowKey}_${col.id}`;
                                                                quotaTotal += Number(currentConfig.amounts[key]) || 0;
                                                            });
                                                        });

                                                        return (
                                                            <div 
                                                                key={quotaName}
                                                                className={`border rounded-lg bg-white overflow-hidden transition ${isExpanded ? 'border-blue-400 ring-1 ring-blue-200' : isSaved ? 'border-green-200 bg-green-50/20' : 'border-gray-200'}`}
                                                            >
                                                                {/* Quota Single Header Row */}
                                                                <div 
                                                                    onClick={handleQuotaClick}
                                                                    className={`p-3 flex items-center justify-between select-none cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-blue-50/40 border-b border-blue-100' : ''}`}
                                                                >
                                                                    <div className="flex items-center gap-3">
                                                                        <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${isSaved ? 'bg-green-600 text-white' : isExpanded ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-800'}`}>
                                                                            {isSaved ? '✓' : (qIndex + 1)}
                                                                        </span>

                                                                        <div>
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="font-bold text-xs md:text-sm text-gray-800">{quotaName}</span>
                                                                                {isSaved && (
                                                                                    <span className="bg-green-100 text-green-800 text-[10px] font-bold px-2 py-0.5 rounded">
                                                                                        Saved
                                                                                    </span>
                                                                                )}
                                                                                {!isSaved && (
                                                                                    <span className="bg-amber-50 text-amber-600 text-[10px] font-semibold px-2 py-0.5 rounded border border-amber-200">
                                                                                        Not Configured
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <div className="text-[11px] text-gray-500 mt-0.5">
                                                                                {currentConfig.columns.filter(c => c.feeHeadId).length} Fee Head Columns | Total: <span className="font-mono font-bold text-gray-800">₹{quotaTotal.toLocaleString()}</span>
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    <div className="flex items-center gap-2">
                                                                        {!isExpanded && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => { e.stopPropagation(); handleQuotaClick(); }}
                                                                                className={`text-xs font-semibold px-2.5 py-1 rounded border ${isSaved ? 'bg-white text-green-700 border-green-300 hover:bg-green-50' : 'bg-white text-blue-700 border-blue-300 hover:bg-blue-50'}`}
                                                                            >
                                                                                {isSaved ? 'Edit' : 'Configure'}
                                                                            </button>
                                                                        )}
                                                                        <ChevronDown size={16} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180 text-blue-600' : ''}`} />
                                                                    </div>
                                                                </div>

                                                                {/* EXPANDED SECTION FOR ACTIVE QUOTA */}
                                                                {isExpanded && (
                                                                    <div className="p-4 space-y-4 bg-white">
                                                                        {/* Fee Head Columns Header with Tabs in Top Right */}
                                                                        <div className="pb-2 border-b border-gray-200 flex items-center justify-between">
                                                                            <span className="text-xs font-bold text-gray-700">Fee Configuration for {quotaName}</span>
                                                                            <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setQuotaTabs(prev => ({ ...prev, [quotaName]: 'actual' }))}
                                                                                    className={`px-3 py-1 rounded text-xs font-bold transition ${(!quotaTabs[quotaName] || quotaTabs[quotaName] === 'actual') ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                                                                >
                                                                                    Actual Fees
                                                                                </button>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => setQuotaTabs(prev => ({ ...prev, [quotaName]: 'late' }))}
                                                                                    className={`px-3 py-1 rounded text-xs font-bold transition ${(quotaTabs[quotaName] === 'late') ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                                                                                >
                                                                                    Late Fees
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        {(!quotaTabs[quotaName] || quotaTabs[quotaName] === 'actual') && (
                                                                            <>
                                                                                {!quotaConfigs[quotaName] ? (
                                                                                    <div className="p-6 text-center bg-gray-50 border border-dashed border-gray-300 rounded-lg my-2">
                                                                                        <p className="text-xs text-gray-600 font-semibold">Not Configured</p>
                                                                                        <p className="text-[11px] text-gray-400 mt-1">
                                                                                            Click <span className="font-bold text-blue-600">+ Add Fee Head Column</span> below to start setting up this quota.
                                                                                        </p>
                                                                                    </div>
                                                                                ) : currentConfig.columns.length === 0 ? (
                                                                                    <div className="p-6 text-center bg-gray-50 border border-dashed border-gray-300 rounded-lg my-2">
                                                                                        <p className="text-xs text-gray-600 font-semibold">No fee head columns defined for {quotaName}.</p>
                                                                                        <p className="text-[11px] text-gray-400 mt-1">
                                                                                            Click <span className="font-bold text-blue-600">+ Add Fee Head Column</span> below to add fee heads, or click <span className="font-bold text-gray-700">{qIndex === availableQuotas.length - 1 ? 'Save & Finish' : 'Save Quota & Next'}</span> to proceed with 0 fee heads.
                                                                                        </p>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="overflow-x-auto border border-gray-200 rounded">
                                                                                        <table className="w-full text-center text-xs border-collapse">
                                                                                            <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                                                                                                <tr>
                                                                                                    <th className="p-2.5 border-r border-gray-200 w-44 bg-gray-100/70 text-left">Fee Head / Attribute</th>
                                                                                                    {matrixRows.map(row => (
                                                                                                        <th key={row.rowKey} className="p-2.5 border-r border-gray-200 w-32 bg-gray-50 text-center">
                                                                                                            {row.label}
                                                                                                        </th>
                                                                                                    ))}
                                                                                                    <th className="p-2.5 border-r border-gray-200 w-32 bg-gray-100/70 text-center">Total</th>
                                                                                                </tr>
                                                                                            </thead>
                                                                                            <tbody className="divide-y divide-gray-100">
                                                                                                {currentConfig.columns.map(col => {
                                                                                                    let rowTotal = 0;
                                                                                                    matrixRows.forEach(row => {
                                                                                                        const amtKey = `${row.rowKey}_${col.id}`;
                                                                                                        rowTotal += Number(currentConfig.amounts[amtKey]) || 0;
                                                                                                    });
                                                                                                    return (
                                                                                                        <tr key={col.id} className="hover:bg-gray-50/80">
                                                                                                            <td className="p-2.5 border-r border-gray-200 align-top text-left bg-gray-50">
                                                                                                                <div className="space-y-1.5">
                                                                                                                    <div className="flex items-center gap-1">
                                                                                                                        <select
                                                                                                                            className="w-full border border-gray-300 bg-white p-1.5 rounded text-xs font-semibold text-gray-800 focus:ring-1 focus:ring-blue-500 outline-none text-left"
                                                                                                                            value={col.feeHeadId}
                                                                                                                            onChange={e => updateColumnInActiveQuota(quotaName, col.id, 'feeHeadId', e.target.value)}
                                                                                                                        >
                                                                                                                            <option value="">Select Fee Head</option>
                                                                                                                            {feeHeads.filter(h => ((h.isActive !== false && !['HST01', 'TRN01'].includes(String(h.code || '').trim().toUpperCase())) || h._id === col.feeHeadId)).map(h => (
                                                                                                                                <option key={h._id} value={h._id} disabled={currentConfig.columns.some(c => c.id !== col.id && c.feeHeadId === h._id)}>
                                                                                                                                    {h.name}
                                                                                                                                </option>
                                                                                                                            ))}
                                                                                                                        </select>
                                                                                                                        <button
                                                                                                                            type="button"
                                                                                                                            onClick={() => removeColumnFromActiveQuota(quotaName, col.id)}
                                                                                                                            className="text-gray-400 hover:text-red-600 p-1 shrink-0"
                                                                                                                            title="Remove column"
                                                                                                                        >
                                                                                                                            <Trash2 size={15} />
                                                                                                                        </button>
                                                                                                                    </div>
                                                                                                                    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-gray-200 text-[11px] text-gray-700">
                                                                                                                        <div className="flex items-center justify-between gap-1.5 whitespace-nowrap">
                                                                                                                            <label className="flex items-center gap-1 cursor-pointer select-none">
                                                                                                                                <input
                                                                                                                                    type="checkbox"
                                                                                                                                    checked={col.isLateFeeApplicable || false}
                                                                                                                                    onChange={e => updateColumnInActiveQuota(quotaName, col.id, 'isLateFeeApplicable', e.target.checked)}
                                                                                                                                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                                                                                                                />
                                                                                                                                <span className="font-semibold text-gray-800">Late Fee</span>
                                                                                                                            </label>
                                                                                                                            <div className="flex items-center gap-1">
                                                                                                                                <span className="text-[10px] text-gray-500 font-bold">Terms:</span>
                                                                                                                                <select
                                                                                                                                    className="border border-gray-300 bg-white p-0.5 rounded text-[10px] font-bold text-blue-700 focus:ring-1 focus:ring-blue-500 outline-none"
                                                                                                                                    value={col.termsCount || 0}
                                                                                                                                    onChange={e => updateColumnInActiveQuota(quotaName, col.id, 'termsCount', Number(e.target.value))}
                                                                                                                                >
                                                                                                                                    <option value={0}>0</option>
                                                                                                                                    <option value={2}>2</option>
                                                                                                                                    <option value={3}>3</option>
                                                                                                                                    <option value={4}>4</option>
                                                                                                                                </select>
                                                                                                                            </div>
                                                                                                                        </div>
                                                                                                                        <div className="flex items-center justify-between">
                                                                                                                            <label className="flex items-center gap-1 cursor-pointer select-none">
                                                                                                                                <input
                                                                                                                                    type="checkbox"
                                                                                                                                    checked={col.isScholarshipApplicable || false}
                                                                                                                                    onChange={e => toggleColumnScholarshipAllYears(quotaName, col.id, e.target.checked, matrixRows)}
                                                                                                                                    className="rounded text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                                                                                                                />
                                                                                                                                <span className="font-semibold text-gray-800">Scholarship (All Years)</span>
                                                                                                                            </label>
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            </td>
                                                                                                            {matrixRows.map(row => {
                                                                                                                const amtKey = `${row.rowKey}_${col.id}`;
                                                                                                                const val = currentConfig.amounts[amtKey] || '';
                                                                                                                const nVal = Number(val) || 0;
                                                                                                                const termObj = currentConfig.terms[amtKey];
                                                                                                                return (
                                                                                                                    <td key={row.rowKey} className="p-2 border-r border-gray-200 align-top space-y-1 text-center">
                                                                                                                        <input
                                                                                                                            type="number"
                                                                                                                            placeholder="₹ Amount"
                                                                                                                            className="w-full border border-gray-300 p-1.5 rounded text-xs focus:ring-1 focus:ring-blue-500 outline-none text-center"
                                                                                                                            value={val}
                                                                                                                            onChange={e => updateAmountInActiveQuota(quotaName, row.rowKey, col.id, e.target.value)}
                                                                                                                            disabled={!col.feeHeadId}
                                                                                                                        />
                                                                                                                        {col.isScholarshipApplicable && (
                                                                                                                            <label className="flex items-center justify-center gap-1 mt-1.5 cursor-pointer select-none text-[10px] text-gray-600">
                                                                                                                                <input
                                                                                                                                    type="checkbox"
                                                                                                                                    checked={currentConfig.scholarships?.[amtKey] || false}
                                                                                                                                    onChange={e => updateScholarshipInActiveQuota(quotaName, row.rowKey, col.id, e.target.checked)}
                                                                                                                                    disabled={!col.feeHeadId}
                                                                                                                                    className="rounded text-blue-600 focus:ring-blue-500 h-3 w-3"
                                                                                                                                />
                                                                                                                                <span>Scholarship</span>
                                                                                                                            </label>
                                                                                                                        )}
                                                                                                                        {col.isLateFeeApplicable && col.termsCount > 1 && nVal > 0 && termObj && termObj.data && termObj.data.length > 0 && (
                                                                                                                            <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                                                                                                                                {termObj.data.map((t, tidx) => (
                                                                                                                                    <div key={tidx} className="bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded flex items-center gap-1 text-[10px] whitespace-nowrap">
                                                                                                                                        <span className="text-[9px] text-gray-500 font-bold">T{tidx+1}</span>
                                                                                                                                        <span className="text-[10px] font-bold text-blue-600 font-mono">₹{Number(t.a || 0).toLocaleString('en-IN')}</span>
                                                                                                                                    </div>
                                                                                                                                ))}
                                                                                                                            </div>
                                                                                                                        )}
                                                                                                                    </td>
                                                                                                                );
                                                                                                            })}
                                                                                                            <td className="p-2.5 border-r border-gray-200 font-mono font-bold text-blue-900 text-center">
                                                                                                                ₹{rowTotal.toLocaleString('en-IN')}
                                                                                                            </td>
                                                                                                        </tr>
                                                                                                    );
                                                                                                })}
                                                                                            </tbody>
                                                                                            <tfoot className="bg-gray-100 font-bold border-t border-gray-300">
                                                                                                <tr>
                                                                                                    <td className="p-2.5 border-r border-gray-200 text-center">Total</td>
                                                                                                    {matrixRows.map(row => {
                                                                                                        let periodTotal = 0;
                                                                                                        currentConfig.columns.forEach(col => {
                                                                                                            const amtKey = `${row.rowKey}_${col.id}`;
                                                                                                            periodTotal += Number(currentConfig.amounts[amtKey]) || 0;
                                                                                                        });
                                                                                                        return (
                                                                                                            <td key={row.rowKey} className="p-2.5 border-r border-gray-200 font-mono text-blue-900 text-center">
                                                                                                                ₹{periodTotal.toLocaleString('en-IN')}
                                                                                                            </td>
                                                                                                        );
                                                                                                    })}
                                                                                                    <td className="p-2.5 border-r border-gray-200 font-mono text-blue-900 text-center">
                                                                                                        {(() => {
                                                                                                            let gTotal = 0;
                                                                                                            currentConfig.columns.forEach(col => {
                                                                                                                matrixRows.forEach(row => {
                                                                                                                    const amtKey = `${row.rowKey}_${col.id}`;
                                                                                                                    gTotal += Number(currentConfig.amounts[amtKey]) || 0;
                                                                                                                });
                                                                                                            });
                                                                                                            return `₹${gTotal.toLocaleString('en-IN')}`;
                                                                                                        })()}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            </tfoot>
                                                                                        </table>
                                                                                    </div>
                                                                                )}

                                                                                {/* Bottom Add Fee Head Column Button */}
                                                                                <div className="flex items-center justify-start pt-1">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => addColumnToActiveQuota(quotaName)}
                                                                                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 border border-blue-300 bg-blue-50 px-3 py-1.5 rounded hover:bg-blue-100 transition flex items-center gap-1"
                                                                                    >
                                                                                        + Add Fee Head Column
                                                                                    </button>
                                                                                </div>
                                                                            </>
                                                                        )}

                                                                        {quotaTabs[quotaName] === 'late' && (() => {
                                                                            const lateCols = currentConfig.columns.filter(c => c.isLateFeeApplicable && c.feeHeadId);
                                                                            if (lateCols.length === 0) {
                                                                                return (
                                                                                    <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded-lg my-2 flex flex-col items-center">
                                                                                        <AlertTriangle className="text-amber-500 mb-2" size={24} />
                                                                                        <p className="text-xs text-gray-600 font-semibold">No Late Fee Applicable Heads</p>
                                                                                        <p className="text-[11px] text-gray-400 mt-1">
                                                                                            Go to the <span className="font-bold text-blue-600">Actual Fees</span> tab and check the "Late Fee" checkbox for at least one fee head.
                                                                                        </p>
                                                                                    </div>
                                                                                );
                                                                            }

                                                                            const isGroupWise = !!quotaGroupWise[quotaName];
                                                                            const uniqueTermCounts = [...new Set(lateCols.map(c => (c.termsCount > 0 ? c.termsCount : 1)))];
                                                                            const hasMismatchedTerms = uniqueTermCounts.length > 1;
                                                                            const groupTerms = uniqueTermCounts[0] || 1;
                                                                            const groupFees = quotaGroupLateFees[quotaName] || {};

                                                                            return (
                                                                                <div className="space-y-4">
                                                                                    {/* Mode selection */}
                                                                                    <div className="flex items-center gap-4 bg-gray-50 p-3 rounded-lg border border-gray-200 text-xs">
                                                                                        <span className="font-bold text-gray-500 mr-2 uppercase text-[10px]">Penalty Type:</span>
                                                                                        <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-gray-700">
                                                                                            <input
                                                                                                type="radio"
                                                                                                name={`groupWise_${quotaName}`}
                                                                                                checked={!isGroupWise}
                                                                                                onChange={() => {
                                                                                                    setQuotaGroupWise(prev => ({ ...prev, [quotaName]: false }));
                                                                                                }}
                                                                                                className="text-blue-600 focus:ring-blue-500"
                                                                                            />
                                                                                            Each Head Late Fee
                                                                                        </label>
                                                                                        <label className="flex items-center gap-1.5 cursor-pointer select-none font-bold text-gray-700">
                                                                                            <input
                                                                                                type="radio"
                                                                                                name={`groupWise_${quotaName}`}
                                                                                                checked={isGroupWise}
                                                                                                onChange={() => {
                                                                                                    setQuotaGroupWise(prev => ({ ...prev, [quotaName]: true }));
                                                                                                    // Sync first column's late fees to all other columns immediately
                                                                                                    const currentConfig = getQuotaConfig(quotaName);
                                                                                                    const lateCols = currentConfig.columns.filter(c => c.isLateFeeApplicable && c.feeHeadId);
                                                                                                    if (lateCols.length > 0) {
                                                                                                        const firstCol = lateCols[0];
                                                                                                        const fees = firstCol.termLateFees || {};
                                                                                                        setQuotaGroupLateFees(prev => ({ ...prev, [quotaName]: fees }));
                                                                                                        setQuotaConfigs(prev => {
                                                                                                            const config = prev[quotaName] || { columns: [], amounts: {}, terms: {} };
                                                                                                            const updatedCols = config.columns.map(c => {
                                                                                                                if (c.isLateFeeApplicable && c.feeHeadId) {
                                                                                                                    return { ...c, termLateFees: { ...fees } };
                                                                                                                }
                                                                                                                return c;
                                                                                                            });
                                                                                                            return {
                                                                                                                ...prev,
                                                                                                                [quotaName]: {
                                                                                                                    ...config,
                                                                                                                    columns: updatedCols
                                                                                                                }
                                                                                                            };
                                                                                                        });
                                                                                                    }
                                                                                                }}
                                                                                                className="text-blue-600 focus:ring-blue-500"
                                                                                            />
                                                                                            Group-wise Late Fee
                                                                                        </label>
                                                                                    </div>

                                                                                    {isGroupWise ? (
                                                                                        /* Group-wise Late Fee View */
                                                                                        hasMismatchedTerms ? (
                                                                                            <div className="bg-amber-50 border border-amber-200 text-amber-850 p-4 rounded-xl text-xs font-semibold flex items-start gap-2.5">
                                                                                                <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
                                                                                                <div>
                                                                                                    <p className="font-bold text-amber-900">Mismatched Term Counts</p>
                                                                                                    <p className="text-[11px] text-amber-700/80 font-normal mt-1">
                                                                                                        Group-wise configuration requires all late-fee-applicable heads to have the same number of terms. Currently, your selected heads have different terms division configurations.
                                                                                                    </p>
                                                                                                    <div className="mt-2 space-y-1">
                                                                                                        {lateCols.map(col => {
                                                                                                            const name = feeHeads.find(h => h._id === col.feeHeadId)?.name || 'Unnamed';
                                                                                                            return (
                                                                                                                <div key={col.id} className="text-[10px] font-bold text-amber-800">
                                                                                                                    • {name}: {col.termsCount || 0} terms
                                                                                                                </div>
                                                                                                            );
                                                                                                        })}
                                                                                                    </div>
                                                                                                    <p className="text-[10px] text-amber-600/70 font-normal mt-2">
                                                                                                        Please align their term counts in the <span className="font-bold text-blue-600">Actual Fees</span> tab first.
                                                                                                    </p>
                                                                                                </div>
                                                                                            </div>
                                                                                        ) : groupTerms === 0 ? (
                                                                                            <div className="p-6 text-center bg-gray-50 border border-dashed border-gray-300 rounded-lg my-2 flex flex-col items-center">
                                                                                                <AlertTriangle className="text-amber-500 mb-1" size={20} />
                                                                                                <p className="text-xs text-gray-600 font-semibold">Terms Not Configured</p>
                                                                                                <p className="text-[11px] text-gray-400 mt-1">
                                                                                                    Please set a terms count (e.g. 2, 3, or 4) for your late-fee heads in the <span className="font-bold text-blue-600">Actual Fees</span> tab.
                                                                                                </p>
                                                                                            </div>
                                                                                        ) : (
                                                                                            <div className="bg-blue-50/20 p-4 rounded-xl border border-blue-100 space-y-4">
                                                                                                <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                                                                                                    <span>Group Terms Configuration</span>
                                                                                                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">{groupTerms} Terms (From Actual Fees)</span>
                                                                                                </div>

                                                                                                <div className="text-[11px] text-gray-500 bg-white p-2.5 rounded border border-gray-100">
                                                                                                    <span className="font-semibold text-blue-900 block mb-1">Applying to heads:</span>
                                                                                                    <div className="flex flex-wrap gap-1.5">
                                                                                                        {lateCols.map(col => {
                                                                                                            const name = feeHeads.find(h => h._id === col.feeHeadId)?.name || 'Unnamed';
                                                                                                            return <span key={col.id} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold text-[10px]">{name}</span>;
                                                                                                        })}
                                                                                                    </div>
                                                                                                </div>

                                                                                                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                                                                    {Array.from({ length: groupTerms }).map((_, idx) => {
                                                                                                        const termNum = idx + 1;
                                                                                                        const val = groupFees[termNum] || '';
                                                                                                        return (
                                                                                                            <div key={termNum} className="bg-white p-3 rounded-lg border border-gray-200">
                                                                                                                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Term {termNum} Penalty</label>
                                                                                                                <div className="relative">
                                                                                                                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">₹</span>
                                                                                                                    <input
                                                                                                                        type="number"
                                                                                                                        className="w-full border border-gray-200 rounded p-1.5 pl-5 text-xs font-bold text-gray-800 outline-none text-right focus:border-blue-300"
                                                                                                                        value={val}
                                                                                                                        onChange={e => {
                                                                                                                            const updatedGroupFees = { ...groupFees, [termNum]: e.target.value };
                                                                                                                            setQuotaGroupLateFees(p => ({ ...p, [quotaName]: updatedGroupFees }));
                                                                                                                            
                                                                                                                            setQuotaConfigs(prev => {
                                                                                                                                const config = prev[quotaName] || { columns: [], amounts: {}, terms: {} };
                                                                                                                                const updatedCols = config.columns.map(c => {
                                                                                                                                    if (c.isLateFeeApplicable && c.feeHeadId) {
                                                                                                                                        const updatedTermLate = c.termLateFees ? { ...c.termLateFees } : {};
                                                                                                                                        updatedTermLate[termNum] = e.target.value;
                                                                                                                                        return { ...c, termLateFees: updatedTermLate };
                                                                                                                                    }
                                                                                                                                    return c;
                                                                                                                                });
                                                                                                                                return {
                                                                                                                                    ...prev,
                                                                                                                                    [quotaName]: {
                                                                                                                                        ...config,
                                                                                                                                        columns: updatedCols
                                                                                                                                    }
                                                                                                                                };
                                                                                                                            });
                                                                                                                        }}
                                                                                                                    />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )
                                                                                    ) : (
                                                                                        /* Individual Late Fee View */
                                                                                        <div className="space-y-4">
                                                                                            {lateCols.map(col => {
                                                                                                const name = feeHeads.find(h => h._id === col.feeHeadId)?.name || 'Unnamed';
                                                                                                const count = col.termsCount > 0 ? col.termsCount : 1;
                                                                                                const colTermFees = col.termLateFees || {};

                                                                                                return (
                                                                                                    <div key={col.id} className="bg-gray-50/50 p-4 rounded-xl border border-gray-200 space-y-3">
                                                                                                        <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                                                                                                            <span className="font-bold text-xs text-blue-900">{name}</span>
                                                                                                            <span className="bg-gray-200 text-gray-700 px-2 py-0.5 rounded text-[10px] font-bold">
                                                                                                                {count === 1 ? '1 Term' : `${count} Terms`}
                                                                                                            </span>
                                                                                                        </div>

                                                                                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                                                                                            {Array.from({ length: count }).map((_, idx) => {
                                                                                                                const termNum = idx + 1;
                                                                                                                const val = colTermFees[termNum] || '';
                                                                                                                return (
                                                                                                                    <div key={termNum} className="bg-white p-3 rounded-lg border border-gray-200">
                                                                                                                        <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">
                                                                                                                            {count === 1 ? 'Late Fee Penalty' : `Term ${termNum} Penalty`}
                                                                                                                        </label>
                                                                                                                        <div className="relative">
                                                                                                                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-xs">₹</span>
                                                                                                                            <input
                                                                                                                                type="number"
                                                                                                                                className="w-full border border-gray-200 rounded p-1.5 pl-5 text-xs font-bold text-gray-800 outline-none text-right focus:border-blue-300"
                                                                                                                                value={val}
                                                                                                                                onChange={e => {
                                                                                                                                    const updatedTermLate = { ...colTermFees, [termNum]: e.target.value };
                                                                                                                                    updateColumnInActiveQuota(quotaName, col.id, 'termLateFees', updatedTermLate);
                                                                                                                                }}
                                                                                                                            />
                                                                                                                        </div>
                                                                                                                    </div>
                                                                                                                );
                                                                                                            })}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })()}

                                                                        {/* Inline Validation Error Banner inside active quota card */}
                                                                        {wizardError && (
                                                                            <div className="bg-red-50 border border-red-200 text-red-700 p-2.5 rounded-lg text-xs font-semibold flex items-center justify-between gap-2 my-1">
                                                                                <div className="flex items-center gap-2">
                                                                                    <span className="text-red-600 font-bold">⚠️</span>
                                                                                    <span>{wizardError}</span>
                                                                                </div>
                                                                                <button 
                                                                                    type="button" 
                                                                                    onClick={() => setWizardError('')}
                                                                                    className="text-red-400 hover:text-red-600 font-bold text-xs shrink-0"
                                                                                >
                                                                                    ✕
                                                                                </button>
                                                                            </div>
                                                                        )}

                                                                        {/* Bottom Button for Save & Next Quota */}
                                                                        <div className="flex justify-between items-center pt-2">
                                                                            <span className="text-xs text-gray-500">
                                                                                Quota {qIndex + 1} of {availableQuotas.length}: <span className="font-bold text-gray-700">{quotaName}</span>
                                                                            </span>

                                                                            <div className="flex items-center gap-2">
                                                                                {qIndex > 0 && (
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => {
                                                                                            const prevQuotaName = availableQuotas[qIndex - 1];
                                                                                            if (prevQuotaName) {
                                                                                                setExpandedWizardQuotas(prev => ({
                                                                                                    ...prev,
                                                                                                    [quotaName]: false,
                                                                                                    [prevQuotaName]: true
                                                                                                }));
                                                                                            }
                                                                                            setActiveQuotaIndex(qIndex - 1);
                                                                                        }}
                                                                                        className="px-3.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded transition"
                                                                                    >
                                                                                        Previous Quota
                                                                                    </button>
                                                                                )}

                                                                                <button
                                                                                    type="button"
                                                                                    disabled={isSavingQuota}
                                                                                    onClick={() => handleSaveQuotaAndNext(quotaName, qIndex === availableQuotas.length - 1, qIndex)}
                                                                                    className="px-5 py-2 rounded text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 transition flex items-center gap-1"
                                                                                >
                                                                                    {isSavingQuota ? (
                                                                                        <span>Saving...</span>
                                                                                    ) : qIndex === availableQuotas.length - 1 ? (
                                                                                        <span>Save & Complete All Quotas</span>
                                                                                    ) : (
                                                                                        <>
                                                                                            <span>Next Quota ({availableQuotas[qIndex + 1]})</span>
                                                                                            <ChevronRight size={15} />
                                                                                        </>
                                                                                    )}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* --- TAB 3: LATE FEES --- */}
                
                {activeTab === 'latefees' && (
                    <div className="space-y-6">
                        {lateFeeSubTab === 'view' && (
                            <div className="space-y-4">
                                <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
                                    <div className="flex items-center justify-between mb-4">
                                        {(lateFeeViewFilters.college || lateFeeViewFilters.course || lateFeeViewFilters.batch) && (
                                            <button
                                                type="button"
                                                onClick={() => setLateFeeViewFilters({ college: '', course: '', branch: '', batch: '', studentYear: '', semester: '', category: '', feeHead: '' })}
                                                className="text-xs font-bold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition"
                                            >
                                                Clear Filters
                                            </button>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">College</label>
                                            <select
                                                className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                                                value={lateFeeViewFilters.college}
                                                onChange={e => setLateFeeViewFilters({ ...lateFeeViewFilters, college: e.target.value, course: '', branch: '', feeHead: '' })}
                                            >
                                                <option value="">All</option>
                                                {colleges.map(c => <option key={c}>{c}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Batch</label>
                                            <select
                                                className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                                                value={lateFeeViewFilters.batch}
                                                onChange={e => setLateFeeViewFilters({ ...lateFeeViewFilters, batch: e.target.value })}
                                            >
                                                <option value="">All</option>
                                                {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-400 uppercase">Course</label>
                                            <select
                                                className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                                                value={lateFeeViewFilters.course}
                                                onChange={e => setLateFeeViewFilters({ ...lateFeeViewFilters, course: e.target.value, branch: '', feeHead: '' })}
                                                disabled={!lateFeeViewFilters.college}
                                            >
                                                <option value="">All</option>
                                                {(lateFeeViewFilters.college ? Object.keys(metadata[lateFeeViewFilters.college] || {}) : []).map(c => <option key={c}>{c}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                    <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                        <div>
                                            <h2 className="font-bold text-gray-800">Existing Late Fee Configurations</h2>
                                            <p className="text-xs text-gray-500 mt-0.5">Structures with late fee amounts or a late fee head saved</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={!!syncingLateFeeId}
                                                onClick={() => syncLateFees()}
                                                className="text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-lg transition inline-flex items-center gap-1.5 disabled:opacity-50"
                                                title="Run late fee job for all configurations (same as nightly sync)"
                                            >
                                                <RefreshCw size={13} className={syncingLateFeeId === 'all' ? 'animate-spin' : ''} />
                                                {syncingLateFeeId === 'all' ? 'Syncing…' : 'Sync All'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs border-collapse">
                                            <thead className="bg-gray-50 border-b border-gray-200">
                                                <tr>
                                                    <th className="px-4 py-3 font-bold uppercase text-gray-500 tracking-wider">College</th>
                                                    <th className="px-4 py-3 font-bold uppercase text-gray-500 tracking-wider">Batch</th>
                                                    <th className="px-4 py-3 font-bold uppercase text-gray-500 tracking-wider">Course</th>
                                                    <th className="px-4 py-3 font-bold uppercase text-gray-500 tracking-wider">Branch</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                            {(() => {
                                                if (isLoadingStructures) {
                                                    return (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-16 text-center text-gray-400">
                                                                <div className="flex flex-col items-center justify-center gap-3">
                                                                    <div className="w-8 h-8 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
                                                                    <p className="font-medium text-gray-500">Loading late fee configurations…</p>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                const configured = structures.filter(s => {
                                                    const hasLateFee = s.lateFeeHead ||
                                                        (Array.isArray(s.terms) && s.terms.some(t => Number(t.lateFeeAmount) > 0));
                                                    if (!hasLateFee) return false;

                                                    if (lateFeeViewFilters.college && s.college !== lateFeeViewFilters.college) return false;
                                                    if (lateFeeViewFilters.course && s.course !== lateFeeViewFilters.course) return false;
                                                    if (lateFeeViewFilters.branch && s.branch !== lateFeeViewFilters.branch) return false;
                                                    if (lateFeeViewFilters.batch && String(s.batch) !== String(lateFeeViewFilters.batch)) return false;
                                                    if (lateFeeViewFilters.studentYear && Number(s.studentYear) !== Number(lateFeeViewFilters.studentYear)) return false;
                                                    if (lateFeeViewFilters.semester === 'full') {
                                                        if (s.semester) return false;
                                                    } else if (lateFeeViewFilters.semester) {
                                                        if (Number(s.semester) !== Number(lateFeeViewFilters.semester)) return false;
                                                    }
                                                    if (lateFeeViewFilters.category && s.category !== lateFeeViewFilters.category) return false;
                                                    if (lateFeeViewFilters.feeHead) {
                                                        const headId = String(s.feeHead?._id || s.feeHead || '');
                                                        if (headId !== String(lateFeeViewFilters.feeHead)) return false;
                                                    }
                                                    return true;
                                                });

                                                if (configured.length === 0) {
                                                    return (
                                                        <tr>
                                                            <td colSpan={4} className="px-6 py-16 text-center text-gray-400">
                                                                <Calendar size={32} className="mx-auto mb-2 text-gray-300" />
                                                                <p className="font-medium">No late fee configurations found</p>
                                                                <p className="text-[11px] mt-1">
                                                                    {(lateFeeViewFilters.college || lateFeeViewFilters.course || lateFeeViewFilters.batch)
                                                                        ? 'Try clearing filters, or create one from the Create tab'
                                                                        : 'Create one from the Create tab'}
                                                                </p>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                // Grouping logic:
                                                const groups = {};
                                                configured.forEach(s => {
                                                    const groupKey = `${s.college}|${s.course}|${s.branch}|${s.batch}`;
                                                    if (!groups[groupKey]) {
                                                        groups[groupKey] = {
                                                            key: groupKey,
                                                            college: s.college,
                                                            course: s.course,
                                                            branch: s.branch,
                                                            batch: s.batch,
                                                            categories: {}
                                                        };
                                                    }
                                                    const catKey = s.category || 'General';
                                                    if (!groups[groupKey].categories[catKey]) {
                                                        groups[groupKey].categories[catKey] = {
                                                            name: catKey,
                                                            key: `${groupKey}|${catKey}`,
                                                            years: {}
                                                        };
                                                    }
                                                    const yrKey = s.studentYear;
                                                    if (!groups[groupKey].categories[catKey].years[yrKey]) {
                                                        groups[groupKey].categories[catKey].years[yrKey] = {
                                                            year: yrKey,
                                                            key: `${groupKey}|${catKey}|${yrKey}`,
                                                            items: []
                                                        };
                                                    }
                                                    groups[groupKey].categories[catKey].years[yrKey].items.push(s);
                                                });

                                                const sortedGroups = Object.values(groups).sort((a, b) => {
                                                    if (a.college !== b.college) return a.college.localeCompare(b.college);
                                                    if (a.course !== b.course) return a.course.localeCompare(b.course);
                                                    if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
                                                    return String(b.batch).localeCompare(String(a.batch), undefined, { numeric: true });
                                                });

                                                sortedGroups.forEach(g => {
                                                    g.categoriesList = Object.values(g.categories).sort((a, b) => a.name.localeCompare(b.name));
                                                    g.categoriesList.forEach(cat => {
                                                        cat.yearsList = Object.values(cat.years).sort((a, b) => Number(a.year) - Number(b.year));
                                                    });
                                                });

                                                return sortedGroups.map(g => {
                                                    const isGroupExpanded = !!expandedViewGroups[g.key];
                                                    const totalHeadsCount = g.categoriesList.reduce((acc, cat) => acc + cat.yearsList.reduce((acc2, yr) => acc2 + yr.items.length, 0), 0);
                                                    return (
                                                        <React.Fragment key={g.key}>
                                                            <tr 
                                                                onClick={() => toggleViewGroupExpand(g.key)}
                                                                className={`cursor-pointer hover:bg-blue-50/50 transition-colors group/groupRow ${isGroupExpanded ? 'bg-blue-50/40' : ''}`}
                                                            >
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <ChevronRight size={16} className={`text-gray-400 group-hover/groupRow:text-blue-600 transition-transform duration-200 shrink-0 ${isGroupExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                        <span className="font-bold text-gray-900 text-xs">{collegeCodes[g.college] || g.college}</span>
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <span className="text-blue-600 font-mono font-bold bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-100">{g.batch}</span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <span className="text-gray-700 font-semibold text-xs">{g.course}</span>
                                                                </td>
                                                                <td className="px-4 py-3">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-gray-700 font-semibold text-xs">{g.branch}</span>
                                                                        <span className="text-[11px] text-gray-400 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full font-bold shrink-0">
                                                                            {totalHeadsCount} {totalHeadsCount === 1 ? 'Head' : 'Heads'}
                                                                        </span>
                                                                    </div>
                                                                </td>
                                                            </tr>

                                                            {isGroupExpanded && (
                                                                <tr>
                                                                    <td colSpan={4} className="p-0 bg-slate-50/50 border-y border-gray-200">
                                                                        <div className="p-4 space-y-3 pl-8">
                                                                            {g.categoriesList.map(cat => {
                                                                                const isCategoryExpanded = !!expandedViewCategories[cat.key];
                                                                                const categoryHeadsCount = cat.yearsList.reduce((acc, yr) => acc + yr.items.length, 0);
                                                                                return (
                                                                                    <div key={cat.key} className="border border-gray-200 rounded-xl bg-white shadow-xs overflow-hidden transition-all duration-200">
                                                                                        <div
                                                                                            onClick={() => toggleViewCategoryExpand(cat.key)}
                                                                                            className={`px-4 py-2.5 flex items-center justify-between cursor-pointer select-none transition-colors ${isCategoryExpanded ? 'bg-slate-100/90 border-b border-gray-200 hover:bg-slate-200/60' : 'bg-white hover:bg-gray-50'}`}
                                                                                        >
                                                                                            <div className="flex items-center gap-2">
                                                                                                <ChevronRight size={16} className={`text-gray-500 transition-transform duration-200 shrink-0 ${isCategoryExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                                                <span className="font-bold text-gray-800 text-xs md:text-sm">{cat.name}</span>
                                                                                                <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">
                                                                                                    Quota
                                                                                                </span>
                                                                                            </div>
                                                                                            <div className="flex items-center gap-2">
                                                                                                <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full font-bold">
                                                                                                    {categoryHeadsCount} {categoryHeadsCount === 1 ? 'Head' : 'Heads'}
                                                                                                </span>
                                                                                            </div>
                                                                                        </div>

                                                                                        {isCategoryExpanded && (
                                                                                            <div className="p-3 space-y-3 bg-gray-50/50 pl-6">
                                                                                                {cat.yearsList.map(yr => {
                                                                                                    const isYearExpanded = !!expandedViewYears[yr.key];
                                                                                                    return (
                                                                                                        <div key={yr.key} className="border border-gray-200 rounded-lg bg-white overflow-hidden transition-all duration-200">
                                                                                                            <div
                                                                                                                onClick={() => toggleViewYearExpand(yr.key)}
                                                                                                                className={`px-3 py-2 flex items-center justify-between cursor-pointer select-none transition-colors ${isYearExpanded ? 'bg-slate-100/70 border-b border-gray-200 hover:bg-slate-200/40' : 'bg-white hover:bg-gray-50'}`}
                                                                                                            >
                                                                                                                <div className="flex items-center gap-2">
                                                                                                                    <ChevronRight size={14} className={`text-gray-500 transition-transform duration-200 shrink-0 ${isYearExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                                                                    <span className="font-bold text-gray-700 text-xs">Year {yr.year}</span>
                                                                                                                    <span className="bg-blue-50 text-blue-700 text-[9px] font-bold px-1.5 py-0.2 rounded border border-blue-100">
                                                                                                                        Year
                                                                                                                    </span>
                                                                                                                </div>
                                                                                                                <div className="flex items-center gap-2">
                                                                                                                    <span className="text-[9px] text-gray-400 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full font-bold">
                                                                                                                        {yr.items.length} {yr.items.length === 1 ? 'Head' : 'Heads'}
                                                                                                                    </span>
                                                                                                                </div>
                                                                                                            </div>

                                                                                                            {isYearExpanded && (
                                                                                                                <div className="overflow-x-auto">
                                                                                                                    <table className="w-full text-left text-xs border-collapse">
                                                                                                                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-600 font-semibold">
                                                                                                                            <tr>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider">Semester / Period</th>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider">Fee Head</th>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider">Late Fee Head</th>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider">Terms</th>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider">Late Fee Type</th>
                                                                                                                                <th className="px-4 py-2.5 font-bold uppercase text-gray-500 tracking-wider text-right">Actions</th>
                                                                                                                            </tr>
                                                                                                                        </thead>
                                                                                                                        <tbody className="divide-y divide-gray-100">
                                                                                                                            {(() => {
                                                                                                                                const rowGroups = [];
                                                                                                                                const groupWiseBySem = {};

                                                                                                                                yr.items.forEach(s => {
                                                                                                                                    if (s.isGroupWiseLateFee) {
                                                                                                                                        const semKey = s.semester !== undefined && s.semester !== null ? `Sem_${s.semester}` : 'FullYear';
                                                                                                                                        if (!groupWiseBySem[semKey]) {
                                                                                                                                            groupWiseBySem[semKey] = [];
                                                                                                                                            rowGroups.push({
                                                                                                                                                isGroup: true,
                                                                                                                                                semester: s.semester,
                                                                                                                                                items: groupWiseBySem[semKey]
                                                                                                                                            });
                                                                                                                                        }
                                                                                                                                        groupWiseBySem[semKey].push(s);
                                                                                                                                    } else {
                                                                                                                                        rowGroups.push({
                                                                                                                                            isGroup: false,
                                                                                                                                            semester: s.semester,
                                                                                                                                            items: [s]
                                                                                                                                        });
                                                                                                                                    }
                                                                                                                                });

                                                                                                                                return rowGroups.map((rg, rgIdx) => {
                                                                                                                                    const s = rg.items[0];
                                                                                                                                    const structTermsCount = Array.isArray(s.terms) ? s.terms.length : 1;
                                                                                                                                    const matchingDefaultConfig = defaultConfigs.find(c => Number(c.termsCount) === Number(structTermsCount));
                                                                                                                                    const resolvedLateHead = s.lateFeeHead || matchingDefaultConfig?.lateFeeHead;
                                                                                                                                    const sourceTerms = (s.terms && s.terms.length > 0) ? s.terms : (matchingDefaultConfig?.terms || []);
                                                                                                                                    const lateTerms = sourceTerms.filter(t =>
                                                                                                                                        Number(t.lateFeeAmount) > 0 ||
                                                                                                                                        t.referenceSemester != null ||
                                                                                                                                        (t.dueOffsetDays != null && t.dueOffsetDays !== 0) ||
                                                                                                                                        !!t.fixedDueDate
                                                                                                                                    );
                                                                                                                                    const isFallbackOpen = viewingFallbackForId === s._id;
                                                                                                                                    const feeHeadName = rg.isGroup
                                                                                                                                        ? rg.items.map(item => item.feeHead?.name || '—').join(', ')
                                                                                                                                        : (s.feeHead?.name || '—');

                                                                                                                                    return (
                                                                                                                                        <React.Fragment key={`${s._id}_rg_${rgIdx}`}>
                                                                                                                                        <tr className={`hover:bg-gray-50/80 transition-colors ${isFallbackOpen ? 'bg-blue-50/30' : ''}`}>
                                                                                                                                            <td className="px-4 py-2.5">
                                                                                                                                                {s.semester ? `Sem ${s.semester}` : 'Full Year'}
                                                                                                                                            </td>
                                                                                                                                            <td className="px-4 py-2.5 font-semibold text-blue-700">
                                                                                                                                                {feeHeadName}
                                                                                                                                            </td>
                                                                                                                                            <td className="px-4 py-2.5">
                                                                                                                                                {resolvedLateHead?.name
                                                                                                                                                    ? `${resolvedLateHead.name}${resolvedLateHead.code ? ` (${resolvedLateHead.code})` : ''}`
                                                                                                                                                    : <span className="text-amber-600 font-medium">Not set</span>}
                                                                                                                                            </td>
                                                                                                                                            <td className="px-4 py-2.5">
                                                                                                                                                {lateTerms.length > 0 ? (
                                                                                                                                                    <div className="flex flex-wrap gap-1.5">
                                                                                                                                                        {lateTerms.map(t => {
                                                                                                                                                            const defT = matchingDefaultConfig?.terms?.find(d => Number(d.termNumber) === Number(t.termNumber)) || {};
                                                                                                                                                            const ownTerm = (s.terms || []).find(ot => Number(ot.termNumber) === Number(t.termNumber)) || {};
                                                                                                                                                            const hasCustomTiming = ownTerm.referenceSemester != null || (ownTerm.dueOffsetDays != null && ownTerm.dueOffsetDays !== 0) || ownTerm.fixedDueDate;
                                                                                                                                                            const effTerm = hasCustomTiming ? { ...defT, ...ownTerm } : { ...defT, lateFeeAmount: t.lateFeeAmount };
                                                                                                                                                            const appDate = getLateFeeApplicableDate(s, effTerm);
                                                                                                                                                            return (
                                                                                                                                                                <div key={t.termNumber} className="bg-gray-50 border border-gray-200 text-gray-700 px-2 py-1 rounded-md font-medium text-[10px] space-y-0.5 shadow-2xs">
                                                                                                                                                                    <div className="font-bold text-gray-900 flex items-center justify-between gap-2">
                                                                                                                                                                        <span>T{t.termNumber}: ₹{Number(t.lateFeeAmount).toLocaleString()}</span>
                                                                                                                                                                    </div>
                                                                                                                                                                    <div className="text-[9px] text-blue-700 font-semibold flex items-center gap-1">
                                                                                                                                                                        <Calendar size={10} className="shrink-0 text-blue-500" />
                                                                                                                                                                        {appDate.dateStr ? (
                                                                                                                                                                            <span>Date: <strong className="text-blue-800 font-bold">{appDate.dateStr}</strong></span>
                                                                                                                                                                        ) : (
                                                                                                                                                                            <span className="text-amber-600 font-normal italic" title={appDate.reason}>{appDate.reason || 'Date pending'}</span>
                                                                                                                                                                        )}
                                                                                                                                                                    </div>
                                                                                                                                                                </div>
                                                                                                                                                            );
                                                                                                                                                        })}
                                                                                                                                                    </div>
                                                                                                                                                ) : (
                                                                                                                                                    <span className="text-gray-400">—</span>
                                                                                                                                                )}
                                                                                                                                            </td>
                                                                                                                                            <td className="px-4 py-2.5">
                                                                                                                                                <div className="flex flex-col gap-1 items-start">
                                                                                                                                                    {(() => {
                                                                                                                                                        const ownTerms = s.terms || [];
                                                                                                                                                        const hasCustomTiming = ownTerms.some(t =>
                                                                                                                                                            t.referenceSemester != null ||
                                                                                                                                                            (t.dueOffsetDays != null && t.dueOffsetDays !== 0) ||
                                                                                                                                                            !!t.fixedDueDate
                                                                                                                                                        );
                                                                                                                                                        if (hasCustomTiming) {
                                                                                                                                                            return (
                                                                                                                                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                                                                                                                                    Custom
                                                                                                                                                                </span>
                                                                                                                                                            );
                                                                                                                                                        } else if (matchingDefaultConfig) {
                                                                                                                                                            return (
                                                                                                                                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                                                                                                                                                    Default
                                                                                                                                                                </span>
                                                                                                                                                            );
                                                                                                                                                        } else {
                                                                                                                                                            return <span className="text-[10px] text-amber-600 font-semibold">Not set</span>;
                                                                                                                                                        }
                                                                                                                                                    })()}
                                                                                                                                                    {s.isGroupWiseLateFee && (
                                                                                                                                                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-2 py-0.5 rounded-full">
                                                                                                                                                            Group-wise
                                                                                                                                                        </span>
                                                                                                                                                    )}
                                                                                                                                                </div>
                                                                                                                                            </td>
                                                                                                                                            <td className="px-4 py-2.5 text-right">
                                                                                                                                                <div className="inline-flex items-center gap-1.5">
                                                                                                                                                    {(() => {
                                                                                                                                                        const canSync = !!(s.lateFeeHead || matchingDefaultConfig?.lateFeeHead);
                                                                                                                                                        const syncTitle = !canSync
                                                                                                                                                            ? 'No late fee head configured on structure or default config'
                                                                                                                                                            : !s.lateFeeHead
                                                                                                                                                                ? 'Sync using default config late fee head'
                                                                                                                                                                : 'Apply / reconcile late fees for this structure now';
                                                                                                                                                        return (
                                                                                                                                                            <button
                                                                                                                                                                type="button"
                                                                                                                                                                disabled={!!syncingLateFeeId || !canSync}
                                                                                                                                                                title={syncTitle}
                                                                                                                                                                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed ${!s.lateFeeHead && matchingDefaultConfig?.lateFeeHead ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                                                                                                                                                                onClick={() => syncLateFees(s._id)}
                                                                                                                                                            >
                                                                                                                                                                <RefreshCw size={13} className={syncingLateFeeId === s._id ? 'animate-spin' : ''} />
                                                                                                                                                                {syncingLateFeeId === s._id ? 'Syncing…' : 'Sync'}
                                                                                                                                                            </button>
                                                                                                                                                        );
                                                                                                                                                    })()}
                                                                                                                                                    <button
                                                                                                                                                        type="button"
                                                                                                                                                        title="View Default Fallback Rules for this configuration"
                                                                                                                                                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-bold transition ${isFallbackOpen ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                                                                                                                                        onClick={() => toggleViewFallback(s._id)}
                                                                                                                                                    >
                                                                                                                                                        <ChevronRight size={13} className={`transition-transform duration-200 ${isFallbackOpen ? 'rotate-90' : ''}`} />
                                                                                                                                                        {isFallbackOpen ? 'Hide Rules' : 'View Rules'}
                                                                                                                                                    </button>
                                                                                                                                                </div>
                                                                                                                                            </td>
                                                                                                                                        </tr>
                                                                                                                                        {isFallbackOpen && (
                                                                                                                                            <tr>
                                                                                                                                                <td colSpan={6} className="p-0 bg-blue-50/20 border-b border-blue-100">
                                                                                                                                                    <div className="px-6 py-4 space-y-3">
                                                                                                                                                        {/* Panel header */}
                                                                                                                                                        <div className="flex items-center justify-between">
                                                                                                                                                            <div className="flex items-center gap-2">
                                                                                                                                                                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100 px-2 py-1 rounded">Default Fallback Rules</span>
                                                                                                                                                                <span className="text-[10px] text-gray-500">Applied for {structTermsCount}-term fee structures</span>
                                                                                                                                                            </div>
                                                                                                                                                            <div className="flex items-center gap-2">
                                                                                                                                                                {!matchingDefaultConfig && (
                                                                                                                                                                    <span className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-200 px-2 py-1 rounded">No fallback rule configured for {structTermsCount} terms</span>
                                                                                                                                                                )}
                                                                                                                                                                {editingFallbackForId !== s._id ? (
                                                                                                                                                                    <button
                                                                                                                                                                        type="button"
                                                                                                                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 text-[10px] font-bold transition"
                                                                                                                                                                        onClick={() => openFallbackEdit(s, matchingDefaultConfig)}
                                                                                                                                                                    >
                                                                                                                                                                        <Pencil size={11} /> Edit Rules
                                                                                                                                                                    </button>
                                                                                                                                                                ) : (
                                                                                                                                                                    <button
                                                                                                                                                                        type="button"
                                                                                                                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 text-[10px] font-bold transition"
                                                                                                                                                                        onClick={() => setEditingFallbackForId(null)}
                                                                                                                                                                    >
                                                                                                                                                                        ✕ Cancel
                                                                                                                                                                    </button>
                                                                                                                                                                )}
                                                                                                                                                            </div>
                                                                                                                                                        </div>

                                                                                                                                                        {/* READ VIEW */}
                                                                                                                                                        {editingFallbackForId !== s._id && (
                                                                                                                                                            matchingDefaultConfig ? (
                                                                                                                                                                <div className="space-y-2">
                                                                                                                                                                    <div className="flex items-center gap-3 text-xs">
                                                                                                                                                                        <span className="text-gray-500">Late Fee Demand Head:</span>
                                                                                                                                                                        <span className="font-bold text-blue-700">{(s.lateFeeHead || matchingDefaultConfig.lateFeeHead)?.name || '—'}{(s.lateFeeHead || matchingDefaultConfig.lateFeeHead)?.code ? ` (${(s.lateFeeHead || matchingDefaultConfig.lateFeeHead).code})` : ''}</span>
                                                                                                                                                                    </div>
                                                                                                                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                                                                                                                                                                        {(matchingDefaultConfig.terms || []).map(defT => {
                                                                                                                                                                            // Use structure's own term timing if saved, otherwise show default config
                                                                                                                                                                            const ownTerm = (s.terms || []).find(t => Number(t.termNumber) === Number(defT.termNumber)) || {};
                                                                                                                                                                            const hasCustomTiming = ownTerm.referenceSemester != null || (ownTerm.dueOffsetDays != null && ownTerm.dueOffsetDays !== 0) || ownTerm.fixedDueDate;
                                                                                                                                                                            const t = hasCustomTiming ? { ...defT, ...ownTerm } : defT;
                                                                                                                                                                            const appDate = getLateFeeApplicableDate(s, t);
                                                                                                                                                                            return (
                                                                                                                                                                            <div key={t.termNumber} className="bg-white border border-blue-100 rounded-lg p-3 space-y-1.5 shadow-sm">
                                                                                                                                                                                <div className="flex items-center justify-between">
                                                                                                                                                                                    <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Term {t.termNumber}</div>
                                                                                                                                                                                    {hasCustomTiming && <span className="text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-blue-100">Custom</span>}
                                                                                                                                                                                </div>
                                                                                                                                                                                <div className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">Due Mode: </span>{t.dueDateMode === 'fixed' ? 'Fixed Date' : 'Semester Offset'}</div>
                                                                                                                                                                                {t.dueDateMode === 'offset' ? (<>
                                                                                                                                                                                    <div className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">Ref Sem: </span>Semester {t.referenceSemester || '—'}</div>
                                                                                                                                                                                    <div className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">Offset: </span>+{t.dueOffsetDays ?? 0} days</div>
                                                                                                                                                                                </>) : (
                                                                                                                                                                                    <div className="text-[10px] text-gray-500"><span className="font-semibold text-gray-700">Date: </span>{t.fixedDueDate ? new Date(t.fixedDueDate).toLocaleDateString() : '—'}</div>
                                                                                                                                                                                )}
                                                                                                                                                                                
                                                                                                                                                                                {/* Late Fee Applicable Date Banner */}
                                                                                                                                                                                <div className="mt-2 pt-1.5 border-t border-blue-100/60 bg-blue-50/70 p-2 rounded-md space-y-0.5">
                                                                                                                                                                                    <div className="text-[10px] font-bold text-blue-900 flex items-center gap-1">
                                                                                                                                                                                        <Calendar size={11} className="text-blue-600 shrink-0" />
                                                                                                                                                                                        <span>Applicable Date:</span>
                                                                                                                                                                                        {appDate.dateStr ? (
                                                                                                                                                                                            <span className="text-blue-800 font-extrabold">{appDate.dateStr}</span>
                                                                                                                                                                                        ) : (
                                                                                                                                                                                            <span className="text-amber-700 font-normal italic text-[9px]">{appDate.reason}</span>
                                                                                                                                                                                        )}
                                                                                                                                                                                    </div>
                                                                                                                                                                                    {appDate.semStartDateStr && (
                                                                                                                                                                                        <div className="text-[9px] text-gray-500 pl-4">
                                                                                                                                                                                            (Sem {appDate.refSem} Start: {appDate.semStartDateStr} + {appDate.offsetDays}d offset)
                                                                                                                                                                                        </div>
                                                                                                                                                                                    )}
                                                                                                                                                                                </div>

                                                                                                                                                                                {t.dueDescription && <div className="text-[10px] text-gray-400 italic pt-1">{t.dueDescription}</div>}
                                                                                                                                                                            </div>
                                                                                                                                                                            );
                                                                                                                                                                        })}
                                                                                                                                                                    </div>
                                                                                                                                                                </div>
                                                                                                                                                            ) : (
                                                                                                                                                                <p className="text-xs text-gray-400 italic">Go to the <strong>Default Rules</strong> tab to configure a fallback rule for {structTermsCount}-term structures, or click <strong>Edit Rules</strong> to set custom rules for this fee head.</p>
                                                                                                                                                            )
                                                                                                                                                        )}

                                                                                                                                                        {/* EDIT FORM */}
                                                                                                                                                        {editingFallbackForId === s._id && (
                                                                                                                                                            <div className="space-y-4 border border-blue-200 rounded-xl bg-white p-4">
                                                                                                                                                                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Editing rules for this fee head only</div>
                                                                                                                                                                {/* Per-term editors */}
                                                                                                                                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                                                                                                                                                    {fallbackEditForm.terms.map((t, idx) => (
                                                                                                                                                                        <div key={t.termNumber} className="border border-gray-100 rounded-lg p-3 bg-gray-50 space-y-2">
                                                                                                                                                                            <div className="text-[10px] font-bold text-blue-700 uppercase">Term {t.termNumber}</div>
                                                                                                                                                                            <div className="flex flex-col gap-1">
                                                                                                                                                                                <label className="text-[10px] text-gray-500">Due Mode</label>
                                                                                                                                                                                <select
                                                                                                                                                                                    className="border border-gray-200 rounded px-2 py-1 text-[11px] bg-white"
                                                                                                                                                                                    value={t.dueDateMode}
                                                                                                                                                                                    onChange={e => setFallbackEditForm(f => { const terms = [...f.terms]; terms[idx] = { ...terms[idx], dueDateMode: e.target.value }; return { ...f, terms }; })}
                                                                                                                                                                                >
                                                                                                                                                                                    <option value="offset">Semester Offset</option>
                                                                                                                                                                                    <option value="fixed">Fixed Date</option>
                                                                                                                                                                                </select>
                                                                                                                                                                            </div>
                                                                                                                                                                            {t.dueDateMode === 'offset' ? (
                                                                                                                                                                                <>
                                                                                                                                                                                    <div className="flex flex-col gap-1">
                                                                                                                                                                                        <label className="text-[10px] text-gray-500">Ref. Semester</label>
                                                                                                                                                                                        <select
                                                                                                                                                                                            className="border border-gray-200 rounded px-2 py-1 text-[11px] bg-white w-full"
                                                                                                                                                                                            value={t.referenceSemester}
                                                                                                                                                                                            onChange={e => setFallbackEditForm(f => { const terms = [...f.terms]; terms[idx] = { ...terms[idx], referenceSemester: Number(e.target.value) }; return { ...f, terms }; })}
                                                                                                                                                                                        >
                                                                                                                                                                                            <option value="">-- Select --</option>
                                                                                                                                                                                            <option value={1}>Semester 1</option>
                                                                                                                                                                                            <option value={2}>Semester 2</option>
                                                                                                                                                                                        </select>
                                                                                                                                                                                    </div>
                                                                                                                                                                                    <div className="flex flex-col gap-1">
                                                                                                                                                                                        <label className="text-[10px] text-gray-500">Offset Days</label>
                                                                                                                                                                                        <input type="number" min="0" className="border border-gray-200 rounded px-2 py-1 text-[11px] bg-white w-full"
                                                                                                                                                                                            value={t.dueOffsetDays}
                                                                                                                                                                                            onChange={e => setFallbackEditForm(f => { const terms = [...f.terms]; terms[idx] = { ...terms[idx], dueOffsetDays: Number(e.target.value) }; return { ...f, terms }; })}
                                                                                                                                                                                        />
                                                                                                                                                                                    </div>
                                                                                                                                                                                </>
                                                                                                                                                                            ) : (
                                                                                                                                                                                <div className="flex flex-col gap-1">
                                                                                                                                                                                    <label className="text-[10px] text-gray-500">Fixed Date</label>
                                                                                                                                                                                    <input type="date" className="border border-gray-200 rounded px-2 py-1 text-[11px] bg-white w-full"
                                                                                                                                                                                        value={t.fixedDueDate ? t.fixedDueDate.substring(0, 10) : ''}
                                                                                                                                                                                        onChange={e => setFallbackEditForm(f => { const terms = [...f.terms]; terms[idx] = { ...terms[idx], fixedDueDate: e.target.value }; return { ...f, terms }; })}
                                                                                                                                                                                    />
                                                                                                                                                                                </div>
                                                                                                                                                                            )}
                                                                                                                                                                            <div className="flex flex-col gap-1">
                                                                                                                                                                                <label className="text-[10px] text-gray-500">Description</label>
                                                                                                                                                                                <input type="text" className="border border-gray-200 rounded px-2 py-1 text-[11px] bg-white w-full"
                                                                                                                                                                                    value={t.dueDescription}
                                                                                                                                                                                    onChange={e => setFallbackEditForm(f => { const terms = [...f.terms]; terms[idx] = { ...terms[idx], dueDescription: e.target.value }; return { ...f, terms }; })}
                                                                                                                                                                                />
                                                                                                                                                                            </div>
                                                                                                                                                                        </div>
                                                                                                                                                                    ))}
                                                                                                                                                                </div>
                                                                                                                                                                {/* Save / Cancel */}
                                                                                                                                                                <div className="flex items-center gap-2 pt-1">
                                                                                                                                                                    <button
                                                                                                                                                                        type="button"
                                                                                                                                                                        disabled={isSavingFallbackEdit}
                                                                                                                                                                        className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 transition"
                                                                                                                                                                        onClick={() => saveFallbackEdit(s)}
                                                                                                                                                                    >
                                                                                                                                                                        <RefreshCw size={12} className={isSavingFallbackEdit ? 'animate-spin' : ''} />
                                                                                                                                                                        {isSavingFallbackEdit ? 'Saving & Syncing…' : 'Save & Sync'}
                                                                                                                                                                    </button>
                                                                                                                                                                    <button
                                                                                                                                                                        type="button"
                                                                                                                                                                        className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-200 transition"
                                                                                                                                                                        onClick={() => setEditingFallbackForId(null)}
                                                                                                                                                                    >
                                                                                                                                                                        Cancel
                                                                                                                                                                    </button>
                                                                                                                                                                </div>
                                                                                                                                                            </div>
                                                                                                                                                        )}
                                                                                                                                                    </div>
                                                                                                                                                </td>
                                                                                                                                            </tr>
                                                                                                                                        )}
                                                                                                                                        </React.Fragment>
                                                                                                                                    );
                                                                                                                                });
                                                                                                                            })()}
                                                                                                                        </tbody>
                                                                                                                    </table>
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                        {false && (
                        <>
                        {/* Selector Section */}
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
                            
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">College</label>
                                    <select 
                                        className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors" 
                                        value={lateFeeForm.college} 
                                        onChange={e => setLateFeeForm({ ...lateFeeForm, college: e.target.value, course: '', branch: '' })}
                                    >
                                        <option value="">Select College...</option>
                                        {colleges.map(c => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Course</label>
                                    <select 
                                        className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors" 
                                        value={lateFeeForm.course} 
                                        onChange={e => setLateFeeForm({ ...lateFeeForm, course: e.target.value, branch: '' })} 
                                        disabled={!lateFeeForm.college}
                                    >
                                        <option value="">Select Course...</option>
                                        {(lateFeeForm.college ? Object.keys(metadata[lateFeeForm.college] || {}) : []).map(c => <option key={c}>{c}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Batch</label>
                                    <select 
                                        className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors" 
                                        value={lateFeeForm.batch} 
                                        onChange={e => setLateFeeForm({ ...lateFeeForm, batch: e.target.value })}
                                    >
                                        <option value="">Select Batch...</option>
                                        {batches.map(b => <option key={b} value={b}>{b}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Matching structures grouped by Branch -> Quota */}
                        {(() => {
                            const contextReady = !!(lateFeeForm.college && lateFeeForm.course && lateFeeForm.batch);
                            if (!contextReady) {
                                return (
                                    <div className="bg-white p-16 rounded-2xl border border-dashed border-gray-200 flex flex-col items-center justify-center text-center">
                                        <div className="w-14 h-14 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-3">
                                            <Calendar size={28} />
                                        </div>
                                        <h3 className="text-base font-bold text-gray-800">Select Context First</h3>
                                        <p className="text-gray-400 text-sm max-w-sm mt-1">Choose College, Course, and Batch to view and configure late fees branch-wise.</p>
                                    </div>
                                );
                            }

                            const filteredForLate = structures.filter(s =>
                                s.college === lateFeeForm.college &&
                                s.course === lateFeeForm.course &&
                                String(s.batch) === String(lateFeeForm.batch)
                            );

                            if (filteredForLate.length === 0) {
                                return (
                                    <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center text-gray-400">
                                        <AlertTriangle size={28} className="mx-auto mb-2 text-amber-400" />
                                        <p className="font-medium text-amber-700">No fee structures found for this context</p>
                                        <p className="text-[11px] mt-1 max-w-md mx-auto">Create a fee structure under Fee Structures (Definitions) first, then come back to configure late fees.</p>
                                    </div>
                                );
                            }

                            // Group by Branch
                            const groupedLate = {};
                            filteredForLate.forEach(st => {
                                const key = `${st.college}|${st.batch}|${st.course}|${st.branch}`;
                                if (!groupedLate[key]) {
                                    groupedLate[key] = {
                                        key,
                                        college: st.college,
                                        batch: st.batch,
                                        course: st.course,
                                        branch: st.branch,
                                        quotasMap: {},
                                        categories: []
                                    };
                                }
                                const grp = groupedLate[key];
                                const cat = st.category || 'General';
                                if (!grp.quotasMap[cat]) {
                                    grp.quotasMap[cat] = {
                                        category: cat,
                                        feeHeadsMap: {},
                                        matrix: {}
                                    };
                                    grp.categories.push(cat);
                                }
                                const qGrp = grp.quotasMap[cat];
                                const fhId = st.feeHead?._id || 'unknown';
                                const fhName = st.feeHead?.name || 'Unnamed';
                                const fhCode = st.feeHead?.code || '';
                                const yr = st.studentYear;

                                if (st.isTermsDivided) {
                                    if (!qGrp.feeHeadsMap[fhId]) {
                                        qGrp.feeHeadsMap[fhId] = {
                                            _id: fhId,
                                            name: fhName,
                                            code: fhCode,
                                            isTermsDivided: true,
                                            termsCount: st.terms?.length || 0,
                                            lateFeeAmount: st.terms ? (st.terms.find(t => Number(t.lateFeeAmount) > 0)?.lateFeeAmount || 0) : 0
                                        };
                                    }
                                    if (!qGrp.matrix[yr]) qGrp.matrix[yr] = {};
                                    if (!qGrp.matrix[yr][fhId]) qGrp.matrix[yr][fhId] = [];

                                    qGrp.matrix[yr][fhId].push({
                                        id: st._id,
                                        amount: Number(st.amount) || 0,
                                        semester: st.semester,
                                        terms: st.terms || [],
                                        lateFeeHead: st.lateFeeHead
                                    });
                                }
                            });

                            const groupedLateArray = Object.values(groupedLate).sort((a, b) => a.branch.localeCompare(b.branch));

                            const yearsCount = getEffectiveYearsCount(lateFeeForm.college, lateFeeForm.course, lateFeeForm.branch);
                            const matrixRows = Array.from({ length: yearsCount }, (_, i) => ({
                                year: i + 1,
                                rowKey: `${i + 1}-Y`,
                                label: `Year ${i + 1}`
                            }));

                            return (
                                <div className="space-y-4">
                                    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                                        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                                            <div>
                                                <h3 className="text-sm font-bold text-gray-800">Branch-wise Late Fee Setup</h3>
                                                <p className="text-[11px] text-gray-500 mt-0.5">Expand branch & quota to set late fee amounts for each fee head</p>
                                            </div>
                                            <span className="text-[11px] font-bold text-gray-500 bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                                                {groupedLateArray.length} branch(es) found
                                            </span>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs border-collapse">
                                                <thead className="bg-gray-50/80 border-b border-gray-100 text-gray-600 font-semibold">
                                                    <tr>
                                                        <th className="p-3">College / Batch</th>
                                                        <th className="p-3">Course & Branch</th>
                                                        <th className="p-3">Category (Quota)</th>
                                                        <th className="p-3 text-right">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {groupedLateArray.map((row, i) => {
                                                        const isBranchExpanded = !!expandedLateFeeBranches[row.key];

                                                        return (
                                                            <React.Fragment key={row.key || i}>
                                                                <tr
                                                                    onClick={() => toggleLateFeeBranchExpand(row.key)}
                                                                    className={`cursor-pointer hover:bg-blue-50/50 transition-colors group/row ${isBranchExpanded ? 'bg-blue-50/40' : ''}`}
                                                                >
                                                                    <td className="p-3 text-xs text-gray-700">
                                                                        <div className="flex items-center gap-2">
                                                                            <ChevronRight size={16} className={`text-gray-400 group-hover/row:text-blue-600 transition-transform duration-200 shrink-0 ${isBranchExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                            <span className="font-bold text-gray-900">{collegeCodes[row.college] || row.college}</span>
                                                                            <span className="text-blue-600 font-mono font-medium bg-blue-50 px-1.5 py-0.5 rounded text-[11px] border border-blue-100 shrink-0">{row.batch}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="p-3 text-xs">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="font-bold text-gray-800">{row.course}</span>
                                                                            <span className="text-gray-400 font-normal">-</span>
                                                                            <span className="text-gray-600 font-medium">{row.branch}</span>
                                                                        </div>
                                                                    </td>
                                                                    <td className="p-3">
                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                            {row.categories.map(cat => (
                                                                                <span key={cat} className="bg-purple-100 text-purple-800 text-xs px-2.5 py-0.5 rounded-full font-bold border border-purple-200">
                                                                                    {cat}
                                                                                </span>
                                                                            ))}
                                                                        </div>
                                                                    </td>
                                                                    <td className="p-3 text-right">
                                                                        <span className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition">
                                                                            {isBranchExpanded ? 'Collapse' : 'Expand Branch'}
                                                                        </span>
                                                                    </td>
                                                                </tr>

                                                                {/* EXPANDABLE QUOTAS SECTION FOR THIS BRANCH */}
                                                                {isBranchExpanded && (
                                                                    <tr>
                                                                        <td colSpan={4} className="p-0 bg-slate-50/70 border-y-2 border-blue-100">
                                                                            <div className="p-4 space-y-4">
                                                                                {row.categories.map(catName => {
                                                                                    const quotaKey = `latefee|${row.key}|${catName}`;
                                                                                    const isQuotaExpanded = !!expandedLateFeeQuotas[quotaKey];
                                                                                    const qData = row.quotasMap[catName];
                                                                                    const qFeeHeads = Object.values(qData?.feeHeadsMap || {});

                                                                                    return (
                                                                                        <div key={catName} className="border border-gray-200 rounded-xl bg-white shadow-xs overflow-hidden transition-all duration-200">
                                                                                            {/* Quota Header */}
                                                                                            <div
                                                                                                onClick={() => toggleLateFeeQuotaExpand(quotaKey)}
                                                                                                className={`px-4 py-2.5 flex items-center justify-between cursor-pointer select-none transition-colors ${isQuotaExpanded ? 'bg-slate-100/90 border-b border-gray-200 hover:bg-slate-200/60' : 'bg-white hover:bg-gray-50'}`}
                                                                                            >
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <ChevronRight size={16} className={`text-gray-500 transition-transform duration-200 shrink-0 ${isQuotaExpanded ? 'rotate-90 text-blue-600' : ''}`} />
                                                                                                    <span className="font-bold text-gray-800 text-xs md:text-sm">{catName}</span>
                                                                                                    <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-2 py-0.5 rounded border border-purple-200">Quota</span>
                                                                                                </div>
                                                                                                <div className="flex items-center gap-3 text-xs text-gray-600 font-medium">
                                                                                                    <span>Fee Heads: <span className="font-bold text-gray-900">{qFeeHeads.length}</span></span>
                                                                                                    <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${isQuotaExpanded ? 'rotate-180 text-blue-600' : ''}`} />
                                                                                                </div>
                                                                                            </div>

                                                                                            {/* Quota Matrix Table */}
                                                                                            {isQuotaExpanded && (
                                                                                                <div className="overflow-x-auto">
                                                                                                    <table className="w-full text-center text-xs border-collapse">
                                                                                                        <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                                                                                                            <tr>
                                                                                                                <th className="p-2.5 border-r border-gray-200 w-44 font-bold bg-gray-100/70 text-left">Fee Head</th>
                                                                                                                {matrixRows.map(rowInfo => (
                                                                                                                    <th key={rowInfo.rowKey} className="p-2.5 border-r border-gray-200 w-28 font-bold bg-gray-50 text-center">
                                                                                                                        {rowInfo.label}
                                                                                                                    </th>
                                                                                                                ))}
                                                                                                                <th className="p-2.5 border-r border-gray-200 w-52 font-bold bg-blue-50/70 text-center text-blue-900">
                                                                                                                    Late Fee Input (₹)
                                                                                                                </th>
                                                                                                            </tr>
                                                                                                        </thead>
                                                                                                        <tbody className="divide-y divide-gray-100">
                                                                                                            {qFeeHeads.map(fh => {
                                                                                                                const inputKey = `${row.key}|${catName}|${fh._id}`;

                                                                                                                // Calculate initial/existing late fee amount across years
                                                                                                                let existingLateFee = 0;
                                                                                                                Object.keys(qData.matrix || {}).forEach(yr => {
                                                                                                                    const items = qData.matrix[yr]?.[fh._id] || [];
                                                                                                                    items.forEach(it => {
                                                                                                                        (it.terms || []).forEach(t => {
                                                                                                                            if (Number(t.lateFeeAmount) > 0) existingLateFee = Number(t.lateFeeAmount);
                                                                                                                        });
                                                                                                                    });
                                                                                                                });

                                                                                                                const currentVal = lateFeeInputs[inputKey] !== undefined ? lateFeeInputs[inputKey] : (existingLateFee || '');

                                                                                                                return (
                                                                                                                    <tr key={fh._id} className="hover:bg-gray-50/80">
                                                                                                                        <td className="p-2.5 border-r border-gray-200 align-middle text-left bg-gray-50">
                                                                                                                            <div className="font-bold text-gray-900 text-xs">{fh.name}</div>
                                                                                                                            {fh.code && <div className="text-[10px] text-gray-400">{fh.code}</div>}
                                                                                                                        </td>
                                                                                                                        {matrixRows.map(rowInfo => {
                                                                                                                            const items = qData?.matrix?.[rowInfo.year]?.[fh._id] || [];
                                                                                                                            const matchItem = items[0];
                                                                                                                            const amt = matchItem ? matchItem.amount : 0;
                                                                                                                            return (
                                                                                                                                <td key={rowInfo.rowKey} className="p-2.5 border-r border-gray-200 align-middle text-center">
                                                                                                                                    <div className="font-mono font-bold text-gray-800 text-xs">
                                                                                                                                        {amt > 0 ? `₹${amt.toLocaleString('en-IN')}` : <span className="text-gray-300 font-normal italic">-</span>}
                                                                                                                                    </div>
                                                                                                                                </td>
                                                                                                                            );
                                                                                                                        })}
                                                                                                                        <td className="p-2 border-r border-gray-200 align-middle text-center bg-blue-50/20">
                                                                                                                            {existingLateFee > 0 && !editingLateFeeRows[inputKey] ? (
                                                                                                                                <div className="flex items-center justify-center gap-2">
                                                                                                                                    <span className="font-mono font-bold text-blue-900 text-xs">
                                                                                                                                        ₹{Number(existingLateFee).toLocaleString('en-IN')}
                                                                                                                                    </span>
                                                                                                                                    <button
                                                                                                                                        type="button"
                                                                                                                                        onClick={() => setEditingLateFeeRows({ ...editingLateFeeRows, [inputKey]: true })}
                                                                                                                                        className="text-gray-400 hover:text-blue-600 p-1 rounded-lg hover:bg-blue-50 transition"
                                                                                                                                        title="Edit Late Fee"
                                                                                                                                    >
                                                                                                                                        <Pencil size={13} />
                                                                                                                                    </button>
                                                                                                                                </div>
                                                                                                                            ) : (
                                                                                                                                <div className="flex items-center justify-center gap-2">
                                                                                                                                    <div className="relative inline-block w-28">
                                                                                                                                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-bold">₹</span>
                                                                                                                                        <input
                                                                                                                                            type="number"
                                                                                                                                            placeholder="Amount"
                                                                                                                                            className="w-full border border-gray-300 rounded-lg py-1.5 pl-6 pr-2 text-xs font-bold text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 bg-white"
                                                                                                                                            value={currentVal}
                                                                                                                                            onChange={e => setLateFeeInputs({ ...lateFeeInputs, [inputKey]: e.target.value })}
                                                                                                                                        />
                                                                                                                                    </div>
                                                                                                                                    <button
                                                                                                                                        type="button"
                                                                                                                                        disabled={isSavingLateFee}
                                                                                                                                        onClick={() => handleSaveLateFeeRow(row, catName, fh._id, currentVal, inputKey)}
                                                                                                                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition shadow-xs disabled:bg-gray-400"
                                                                                                                                    >
                                                                                                                                        Save
                                                                                                                                    </button>
                                                                                                                                    {existingLateFee > 0 && (
                                                                                                                                        <button
                                                                                                                                            type="button"
                                                                                                                                            onClick={() => {
                                                                                                                                                setEditingLateFeeRows({ ...editingLateFeeRows, [inputKey]: false });
                                                                                                                                                setLateFeeInputs({ ...lateFeeInputs, [inputKey]: existingLateFee });
                                                                                                                                            }}
                                                                                                                                            className="text-gray-400 hover:text-gray-600 font-bold px-2 py-1 text-xs hover:bg-gray-100 rounded"
                                                                                                                                        >
                                                                                                                                            Cancel
                                                                                                                                        </button>
                                                                                                                                    )}
                                                                                                                                </div>
                                                                                                                            )}
                                                                                                                        </td>
                                                                                                                    </tr>
                                                                                                                );
                                                                                                            })}
                                                                                                        </tbody>
                                                                                                    </table>
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}
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
                                    </div>
                                </div>
                            );
                        })()}
                        </>
                        )}

                        {lateFeeSubTab === 'hostel' && (
                            <div className="space-y-8">
                                <ServiceLateFeeConfigPanel type="HOSTEL" title="Hostel" feeHeads={feeHeads} />
                                <div className="border-t border-gray-200 pt-6">
                                    <HostelConfiguration embedded />
                                </div>
                            </div>
                        )}

                        {lateFeeSubTab === 'transport' && (
                            <div className="space-y-8">
                                <ServiceLateFeeConfigPanel type="TRANSPORT" title="Transport" feeHeads={feeHeads} />
                                <div className="border-t border-gray-200 pt-6">
                                    <TransportConfiguration embedded />
                                </div>
                            </div>
                        )}

                        {lateFeeSubTab === 'due-dates' && (
                            <div className="space-y-6">
                                {/* Default Config List / Form Wrapper */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    {/* Form Section */}
                                    <div className="lg:col-span-5 space-y-6">
                                        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
                                            <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                                                <span className="bg-blue-100 text-blue-600 p-1.5 rounded-lg"><Calendar size={18} /></span>
                                                {editingDefaultConfigId ? 'Edit Default Configuration' : 'Create Default Configuration'}
                                            </h2>
                                            <div className="space-y-4">
                                                <div>
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Fee Structure Terms Count</label>
                                                    <select
                                                        className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                                                        value={defaultConfigForm.termsCount || 3}
                                                        onChange={e => {
                                                            const newCount = Number(e.target.value);
                                                            let newTerms = [...(defaultConfigForm.terms || [])];
                                                            if (newTerms.length < newCount) {
                                                                while (newTerms.length < newCount) {
                                                                    const nextNum = newTerms.length + 1;
                                                                    newTerms.push({
                                                                        termNumber: nextNum,
                                                                        dueDateMode: 'offset',
                                                                        referenceSemester: 1,
                                                                        dueOffsetDays: 15,
                                                                        fixedDueDate: '',
                                                                        dueDescription: `Term ${nextNum} Late Fee`
                                                                    });
                                                                }
                                                            } else if (newTerms.length > newCount) {
                                                                newTerms = newTerms.slice(0, newCount);
                                                            }
                                                            setDefaultConfigForm({
                                                                ...defaultConfigForm,
                                                                termsCount: newCount,
                                                                terms: newTerms
                                                            });
                                                        }}
                                                    >
                                                        <option value={1}>1 Term (Full Payment)</option>
                                                        <option value={2}>2 Terms</option>
                                                        <option value={3}>3 Terms</option>
                                                        <option value={4}>4 Terms</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[10px] font-bold text-gray-400 uppercase">Late Fee Demand Head</label>
                                                    <select
                                                        className="w-full border-gray-200 border p-2 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                                                        value={defaultConfigForm.lateFeeHead}
                                                        onChange={e => setDefaultConfigForm({ ...defaultConfigForm, lateFeeHead: e.target.value })}
                                                    >
                                                        <option value="">Select Late Fee Head...</option>
                                                        {feeHeads
                                                            .filter(h => /late\s*fee/i.test(`${h.name || ''} ${h.code || ''}`))
                                                            .map(h => (
                                                                <option key={h._id} value={h._id}>
                                                                    {h.name}{h.code ? ` (${h.code})` : ''}
                                                                </option>
                                                            ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Default Terms Setup */}
                                        <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-bold text-gray-800 text-xs">Configure Installment Terms Timing</h3>
                                                {editingDefaultConfigId && (
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                                                        <Pencil size={9} /> Editing Default Config
                                                    </span>
                                                )}
                                            </div>

                                            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
                                                {(defaultConfigForm.terms || []).map((term, idx) => (
                                                    <div key={idx} className="p-3 bg-gray-50/50 rounded-lg border border-gray-100 space-y-2 relative">
                                                        <div className="flex items-center justify-between text-xs font-bold text-gray-700">
                                                            <span>Term {term.termNumber} Timing</span>
                                                        </div>
                                                        <div>
                                                            <label className="text-[9px] text-gray-400 font-semibold block">Due Mode</label>
                                                            <select
                                                                className="w-full border border-gray-200 rounded bg-white p-1 text-[11px]"
                                                                value={term.dueDateMode}
                                                                onChange={e => {
                                                                    const nTerms = [...defaultConfigForm.terms];
                                                                    nTerms[idx].dueDateMode = e.target.value;
                                                                    setDefaultConfigForm({ ...defaultConfigForm, terms: nTerms });
                                                                }}
                                                            >
                                                                <option value="offset">Sem Offset</option>
                                                                <option value="fixed">Fixed Date</option>
                                                            </select>
                                                        </div>

                                                        {term.dueDateMode === 'offset' ? (
                                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                                <div>
                                                                    <label className="text-[9px] text-gray-400 font-semibold block">Ref Semester</label>
                                                                    <select
                                                                        className="w-full border border-gray-200 rounded bg-white p-1 text-[11px]"
                                                                        value={term.referenceSemester || 1}
                                                                        onChange={e => {
                                                                            const nTerms = [...defaultConfigForm.terms];
                                                                            nTerms[idx].referenceSemester = Number(e.target.value);
                                                                            setDefaultConfigForm({ ...defaultConfigForm, terms: nTerms });
                                                                        }}
                                                                    >
                                                                        <option value={1}>Semester 1 Start</option>
                                                                        <option value={2}>Semester 2 Start</option>
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="text-[9px] text-gray-400 font-semibold block">Offset Days</label>
                                                                    <input
                                                                        type="number"
                                                                        className="w-full border border-gray-200 rounded px-1.5 py-1 text-[11px]"
                                                                        value={term.dueOffsetDays}
                                                                        onChange={e => {
                                                                            const nTerms = [...defaultConfigForm.terms];
                                                                            nTerms[idx].dueOffsetDays = Number(e.target.value);
                                                                            setDefaultConfigForm({ ...defaultConfigForm, terms: nTerms });
                                                                        }}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div>
                                                                <label className="text-[9px] text-gray-400 font-semibold block">Fixed Date</label>
                                                                <input
                                                                    type="date"
                                                                    className="w-full border border-gray-200 rounded px-1.5 py-1 text-[11px]"
                                                                    value={term.fixedDueDate ? String(term.fixedDueDate).slice(0, 10) : ''}
                                                                    onChange={e => {
                                                                        const nTerms = [...defaultConfigForm.terms];
                                                                        nTerms[idx].fixedDueDate = e.target.value;
                                                                        setDefaultConfigForm({ ...defaultConfigForm, terms: nTerms });
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                        <div>
                                                            <label className="text-[9px] text-gray-400 font-semibold block">Description</label>
                                                            <input
                                                                type="text"
                                                                placeholder="e.g. Term 1 penalty"
                                                                className="w-full border border-gray-200 rounded px-1.5 py-1 text-[11px]"
                                                                value={term.dueDescription || ''}
                                                                onChange={e => {
                                                                    const nTerms = [...defaultConfigForm.terms];
                                                                    nTerms[idx].dueDescription = e.target.value;
                                                                    setDefaultConfigForm({ ...defaultConfigForm, terms: nTerms });
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                                                <button
                                                    type="button"
                                                    className="bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg font-bold text-xs hover:bg-gray-50 transition"
                                                    onClick={() => {
                                                        setEditingDefaultConfigId(null);
                                                        setDefaultConfigForm({
                                                            termsCount: 3,
                                                            lateFeeHead: '',
                                                            terms: [
                                                                { termNumber: 1, dueDateMode: 'offset', referenceSemester: 1, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 1 Late Fee' },
                                                                { termNumber: 2, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 2 Late Fee' },
                                                                { termNumber: 3, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 60, fixedDueDate: '', dueDescription: 'Term 3 Late Fee' }
                                                            ]
                                                        });
                                                    }}
                                                >
                                                    Clear / Cancel
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={isSavingDefaultConfig}
                                                    onClick={async () => {
                                                        if (!defaultConfigForm.termsCount || !defaultConfigForm.lateFeeHead) {
                                                            return alert("Please select both the terms count and late fee demand head.");
                                                        }
                                                        setIsSavingDefaultConfig(true);
                                                        try {
                                                            const payload = {
                                                                ...defaultConfigForm,
                                                                _id: editingDefaultConfigId
                                                            };
                                                            await api.post('/late-fees/default-config', payload);
                                                            setMessage(editingDefaultConfigId ? "Default Configuration Updated Successfully!" : "Default Configuration Created Successfully!");
                                                            setEditingDefaultConfigId(null);
                                                            setDefaultConfigForm({
                                                                termsCount: 3,
                                                                lateFeeHead: '',
                                                                terms: [
                                                                    { termNumber: 1, dueDateMode: 'offset', referenceSemester: 1, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 1 Late Fee' },
                                                                    { termNumber: 2, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 15, fixedDueDate: '', dueDescription: 'Term 2 Late Fee' },
                                                                    { termNumber: 3, dueDateMode: 'offset', referenceSemester: 2, dueOffsetDays: 60, fixedDueDate: '', dueDescription: 'Term 3 Late Fee' }
                                                                ]
                                                            });
                                                            await fetchDefaultConfigs();
                                                            setTimeout(() => setMessage(''), 3000);
                                                        } catch (err) {
                                                            alert(err.response?.data?.message || "Failed to save configuration");
                                                        } finally {
                                                            setIsSavingDefaultConfig(false);
                                                        }
                                                    }}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold text-xs transition shadow-md shadow-blue-200 disabled:bg-gray-400"
                                                >
                                                    {isSavingDefaultConfig ? 'Saving...' : 'Save Rule'}
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* List Section */}
                                    <div className="lg:col-span-7 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden h-fit">
                                        <div className="px-5 py-4 border-b border-gray-100">
                                            <h3 className="font-bold text-gray-800">Default Late Fee Fallback Rules</h3>
                                            <p className="text-xs text-gray-500 mt-0.5">Rules configured to apply automatically to fee structures matching these criteria.</p>
                                        </div>

                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left text-xs border-collapse">
                                                <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 font-semibold">
                                                     <tr>
                                                         <th className="p-3">Terms Count</th>
                                                         <th className="p-3">Late Fee Head</th>
                                                         <th className="p-3">Terms Map</th>
                                                         <th className="p-3 text-right">Actions</th>
                                                     </tr>
                                                 </thead>
                                                 <tbody className="divide-y divide-gray-100">
                                                     {defaultConfigs.length === 0 ? (
                                                         <tr>
                                                             <td colSpan="4" className="px-6 py-12 text-center text-gray-400">
                                                                 <AlertTriangle size={24} className="mx-auto mb-2 text-gray-300" />
                                                                 <p className="font-medium text-xs">No default configurations found</p>
                                                                 <p className="text-[10px] mt-0.5">Configure one using the form on the left</p>
                                                             </td>
                                                         </tr>
                                                     ) : (
                                                         defaultConfigs.map(cfg => (
                                                             <tr key={cfg._id} className="hover:bg-gray-50/50">
                                                                 <td className="p-3 font-bold text-gray-800">
                                                                     {cfg.termsCount} Terms Config
                                                                 </td>
                                                                 <td className="p-3 font-semibold text-blue-700">
                                                                     {cfg.lateFeeHead?.name || '—'}
                                                                 </td>
                                                                 <td className="p-3">
                                                                     <div className="flex flex-wrap gap-1">
                                                                         {(cfg.terms || []).map(t => (
                                                                             <span key={t.termNumber} className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded font-bold text-[9px]">
                                                                                 T{t.termNumber}: {t.dueDateMode === 'fixed' ? `Fixed (${t.fixedDueDate ? String(t.fixedDueDate).slice(0, 10) : 'N/A'})` : `${t.dueOffsetDays}d offset (Sem ${t.referenceSemester || 1})`}
                                                                             </span>
                                                                         ))}
                                                                     </div>
                                                                 </td>
                                                                 <td className="p-3 text-right whitespace-nowrap">
                                                                     <div className="inline-flex items-center gap-1.5">
                                                                         <button
                                                                             type="button"
                                                                             className="text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded-lg transition"
                                                                             title="Edit Rule"
                                                                             onClick={() => {
                                                                                 setEditingDefaultConfigId(cfg._id);
                                                                                 setDefaultConfigForm({
                                                                                     termsCount: cfg.termsCount || (cfg.terms ? cfg.terms.length : 3),
                                                                                     lateFeeHead: cfg.lateFeeHead?._id || cfg.lateFeeHead || '',
                                                                                     terms: cfg.terms || []
                                                                                 });
                                                                             }}
                                                                         >
                                                                             <Pencil size={13} />
                                                                         </button>
                                                                         <button
                                                                             type="button"
                                                                             className="text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 p-1.5 rounded-lg transition"
                                                                             title="Delete Rule"
                                                                             onClick={() => handleDeleteDefaultConfig(cfg._id)}
                                                                         >
                                                                             <Trash2 size={13} />
                                                                         </button>
                                                                     </div>
                                                                 </td>
                                                             </tr>
                                                         ))
                                                     )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {lateFeeSubTab === 'setup' && (
                            <div className="space-y-6 text-left">
                                {/* Sleek Header Card */}
                                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="space-y-1">
                                            <div className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg">
                                                <BookOpen size={14} /> System Guide
                                            </div>
                                            <h2 className="text-xl font-bold text-gray-800">Late Fee System Administration</h2>
                                            <p className="text-xs text-gray-500 max-w-xl">
                                                A clean overview of how late fee timing offsets, default fallback rules, and the automated reconciliation engine operate.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 bg-gray-50 px-3 py-2 rounded-lg border border-gray-100">
                                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                                            <span className="text-xs font-bold text-gray-700">Sync Engine: Active</span>
                                        </div>
                                    </div>
                                </div>

                                {/* 2-Column Grid Layout */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                                    {/* Left Side: Workflow & Setup Steps */}
                                    <div className="lg:col-span-7 bg-white border border-gray-200 p-6 rounded-xl shadow-xs space-y-6 flex flex-col justify-between">
                                        <div>
                                            <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-100 pb-3">
                                                <span className="p-1 bg-gray-50 text-gray-600 rounded"><Layers size={14} /></span>
                                                Workflow & Setup Steps
                                            </h3>
                                            
                                            <div className="relative pl-6 border-l-2 border-gray-100 space-y-6 ml-3 mt-4">
                                                {/* Step 1 */}
                                                <div className="relative">
                                                    <div className="absolute -left-[33px] top-0.5 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xs">1</div>
                                                    <h4 className="text-xs font-bold text-gray-800">Create a Late Fee Head</h4>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Ensure a late fee demand head exists under the <strong>Fee Heads</strong> tab. The name or code should typically contain "Late Fee" (e.g. <em>Late Fee Term 1</em>) for clear categorization.
                                                    </p>
                                                </div>

                                                {/* Step 2 */}
                                                <div className="relative">
                                                    <div className="absolute -left-[33px] top-0.5 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xs">2</div>
                                                    <h4 className="text-xs font-bold text-gray-800">Establish Default Fallback Rules</h4>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Navigate to the <strong>Default Rules</strong> tab. Define installment timing rules mapped by terms count (e.g. 3 terms rules). This serves as the fallback template for all fee configurations.
                                                    </p>
                                                </div>

                                                {/* Step 3 */}
                                                <div className="relative">
                                                    <div className="absolute -left-[33px] top-0.5 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xs">3</div>
                                                    <h4 className="text-xs font-bold text-gray-800">Link on Fee Structure Creation</h4>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        When a new fee structure is configured, the system automatically checks for late fee applicability and links these default configuration timelines automatically.
                                                    </p>
                                                </div>

                                                {/* Step 4 */}
                                                <div className="relative">
                                                    <div className="absolute -left-[33px] top-0.5 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xs">4</div>
                                                    <h4 className="text-xs font-bold text-gray-800">Customize Specific Timings (Optional)</h4>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        If a course or batch requires custom timing, locate it in the <strong>Academic Config</strong> tab. Click <strong>Edit Rules</strong> to override offsets or specify fixed dates.
                                                    </p>
                                                </div>

                                                {/* Step 5 */}
                                                <div className="relative">
                                                    <div className="absolute -left-[33px] top-0.5 bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-xs">5</div>
                                                    <h4 className="text-xs font-bold text-gray-800">Trigger Reconcile & Sync</h4>
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Click <strong>Sync</strong> or <strong>Save & Sync</strong>. The system recalculates active student balances, checks academic calendar dates, and creates or updates late fee demands.
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Right Side: Timing Modes Comparison (Stacked) */}
                                    <div className="lg:col-span-5 flex flex-col gap-6">
                                        {/* Offset Mode Card */}
                                        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs space-y-3 flex-1 flex flex-col justify-between">
                                            <div className="space-y-3">
                                                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                                    <span className="p-1 bg-indigo-50 text-indigo-600 rounded"><Clock size={14} /></span>
                                                    Semester Offset Mode
                                                </h3>
                                                <p className="text-xs text-gray-500 leading-relaxed">
                                                    Dynamically calculates late fee start dates relative to the active semester's start date in the academic calendar. This prevents needing to re-configure hardcoded dates each year.
                                                </p>
                                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono text-[10px] text-gray-700 flex items-center justify-center gap-1.5 flex-wrap">
                                                    <span className="bg-white px-1.5 py-0.5 rounded border border-gray-200">Sem Start</span>
                                                    <span>+</span>
                                                    <span className="bg-white px-1.5 py-0.5 rounded border border-gray-200">Offset Days</span>
                                                    <span>=</span>
                                                    <span className="bg-indigo-600 text-white px-1.5 py-0.5 rounded">Due Date</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-gray-400 italic mt-2">
                                                Example: Jan 1 Start + 15 Days Offset = Jan 16 Due Date. Late fee starts Jan 17.
                                            </p>
                                        </div>

                                        {/* Fixed Mode Card */}
                                        <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs space-y-3 flex-1 flex flex-col justify-between">
                                            <div className="space-y-3">
                                                <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                                    <span className="p-1 bg-amber-50 text-amber-600 rounded"><Calendar size={14} /></span>
                                                    Fixed Due Date Mode
                                                </h3>
                                                <p className="text-xs text-gray-500 leading-relaxed">
                                                    Uses an exact calendar date for the installment limit. Highly recommended for one-off charges, final deadlines, or non-semester-aligned fees.
                                                </p>
                                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 font-mono text-[10px] text-gray-700 flex items-center justify-center gap-1.5">
                                                    <span className="bg-white px-1.5 py-0.5 rounded border border-gray-200">Specified Date</span>
                                                    <span>➔</span>
                                                    <span className="bg-amber-600 text-white px-1.5 py-0.5 rounded">Absolute Due Date</span>
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-gray-400 italic mt-2">
                                                Example: Hardcoded to Oct 31, 2026. Late fee starts Nov 01, 2026.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Guardrails Section */}
                                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs space-y-4">
                                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-100 pb-3">
                                        <span className="p-1 bg-emerald-50 text-emerald-600 rounded"><Database size={14} /></span>
                                        Database Reconcile Guardrails
                                    </h3>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                                                <CheckCircle2 size={14} className="text-emerald-500" />
                                                Preventing Over-billing
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                Late fees are only added if the student still has an active unpaid balance for the corresponding term on the parent fee demand. Paid students are never charged.
                                            </p>
                                        </div>

                                        <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
                                                <RefreshCw size={14} className="text-blue-500" />
                                                Automatic Demands Cleanup
                                            </div>
                                            <p className="text-xs text-gray-500">
                                                If timings are extended or due dates pushed forward, running a Sync will automatically remove any generated unpaid late fee demands that are no longer overdue.
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                {/* Impact of Editing Active Rules Section */}
                                <div className="bg-white border border-gray-200 p-6 rounded-xl shadow-xs space-y-4">
                                    <h3 className="font-bold text-gray-800 text-sm flex items-center gap-2 border-b border-gray-100 pb-3">
                                        <span className="p-1 bg-amber-50 text-amber-600 rounded"><Info size={14} /></span>
                                        Impact of Editing Active Rules
                                    </h3>
                                    <p className="text-xs text-gray-500 leading-relaxed">
                                        When modifying an existing late fee configuration, the <strong>Save & Sync</strong> button ensures all student ledgers immediately align with the new rules:
                                    </p>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                                        <div className="space-y-1 bg-gray-50/50 p-3.5 rounded-lg border border-gray-100">
                                            <h4 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                                                <RefreshCw size={13} className="text-blue-500 animate-spin-slow" />
                                                Automatic Alignment
                                            </h4>
                                            <p className="text-[11px] text-gray-500 leading-relaxed">
                                                The system recalculates the due date for each term immediately. A background sync job is triggered to align student records with the updated timelines.
                                            </p>
                                        </div>

                                        <div className="space-y-1 bg-gray-50/50 p-3.5 rounded-lg border border-gray-100">
                                            <h4 className="text-xs font-bold text-red-800 flex items-center gap-1.5">
                                                <Trash2 size={13} className="text-red-500" />
                                                Rollback of Unpaid Fees
                                            </h4>
                                            <p className="text-[11px] text-gray-500 leading-relaxed">
                                                If you extend the due date (e.g. from 15 to 30 days offset) and a term is no longer overdue, any generated <strong>unpaid</strong> late fee demands are automatically deleted from the student's ledger.
                                            </p>
                                        </div>

                                        <div className="space-y-1 bg-gray-50/50 p-3.5 rounded-lg border border-gray-100">
                                            <h4 className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                                                <CheckCircle2 size={13} className="text-emerald-500" />
                                                Protected Paid History
                                            </h4>
                                            <p className="text-[11px] text-gray-500 leading-relaxed">
                                                Any student late fee demand that has already been <strong>partially or fully paid</strong> is locked. The system never deletes or alters paid transaction history, even if dates change.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};


export default FeeConfiguration;
