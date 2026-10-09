import React, { useState, useEffect } from 'react';
import api from '../lib/api';
import Swal from 'sweetalert2';
import { Search, Upload, X, Check, Save, Calendar, Filter, Landmark, Users, Printer, Edit2, ShieldAlert, Menu, CheckCircle2, History, RefreshCw, Camera, FlipHorizontal, Eye, FileText, Lock, Image, ZoomIn, ZoomOut, RotateCw, Trash2, Tag } from 'lucide-react';
import Sidebar from './Sidebar';
import { useReactToPrint } from 'react-to-print';
import ConcessionReportPrint from '../components/ConcessionReportPrint';
import { printHtmlDocument } from '../utils/printService';

const ConcessionManagement = () => {
    const [activeTab, setActiveTab] = useState('request'); // 'request', 'approvals', 'approvers'
    const [user, setUser] = useState(null);
    const [isOpenMobile, setIsOpenMobile] = useState(false);
    const [successModalData, setSuccessModalData] = useState(null);

    const searchInputRef = React.useRef(null);

    useEffect(() => {
        if (activeTab === 'request' && searchInputRef.current) {
            searchInputRef.current.focus();
        }
    }, [activeTab]);

    // Request State
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [allStudents, setAllStudents] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedStudents, setSelectedStudents] = useState([]); // Array of selected students
    const [previewStudent, setPreviewStudent] = useState(null); // For displaying details

    const [feeHeads, setFeeHeads] = useState([]);
    const [formData, setFormData] = useState({
        feeHeadId: '',
        amount: '',
        reason: '',
        studentYear: '',
        semester: '',
        college: '',
        course: '',
        branch: '',
        batch: '',
        concessionGivenBy: ''
    });
    const [imageFile, setImageFile] = useState(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
    const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
    const [cameraFacingMode, setCameraFacingMode] = useState('environment'); // 'environment' (back) or 'user' (front)
    const [isCameraLoading, setIsCameraLoading] = useState(false);
    const [cameraError, setCameraError] = useState(null);
    const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
    const [proofImageModalUrl, setProofImageModalUrl] = useState(null);
    const [zoomScale, setZoomScale] = useState(1);
    const [rotationDeg, setRotationDeg] = useState(0);
    const [imgPosition, setImgPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [nextVoucherId, setNextVoucherId] = useState('');
    const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);

    const videoRef = React.useRef(null);
    const streamRef = React.useRef(null);

    // Auto-generate preview URL for staged imageFile
    useEffect(() => {
        if (!imageFile) {
            setImagePreviewUrl(null);
            return;
        }
        if (imageFile.type && imageFile.type.startsWith('image/')) {
            const objectUrl = URL.createObjectURL(imageFile);
            setImagePreviewUrl(objectUrl);
            return () => URL.revokeObjectURL(objectUrl);
        } else {
            setImagePreviewUrl(null);
        }
    }, [imageFile]);

    // Clean up camera stream on unmount
    useEffect(() => {
        return () => {
            if (streamRef.current) {
                streamRef.current.getTracks().forEach(track => track.stop());
            }
        };
    }, []);

    const startCamera = async (mode = cameraFacingMode) => {
        setIsCameraLoading(true);
        setCameraError(null);
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        try {
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: mode },
                        width: { ideal: 1200 },
                        height: { ideal: 1600 },
                        aspectRatio: { ideal: 0.75 } // 3:4 portrait aspect ratio
                    }
                });
            } catch (e) {
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
            }
        } catch (err) {
            console.error('Camera error:', err);
            setCameraError(
                err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
                    ? 'Camera access denied. Please grant camera permission in your browser settings.'
                    : 'Unable to access camera. Ensure camera is connected and not in use by another application.'
            );
        } finally {
            setIsCameraLoading(false);
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    };

    const openCameraModal = () => {
        setIsCameraModalOpen(true);
        startCamera(cameraFacingMode);
    };

    const closeCameraModal = () => {
        stopCamera();
        setIsCameraModalOpen(false);
        setCameraError(null);
    };

    const toggleCameraFacingMode = () => {
        const nextMode = cameraFacingMode === 'environment' ? 'user' : 'environment';
        setCameraFacingMode(nextMode);
        startCamera(nextMode);
    };

    const handleCapturePhoto = () => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;

        // Calculate 3:4 portrait crop region from center of video frame
        let cropWidth, cropHeight, offsetX, offsetY;
        if (vWidth / vHeight > 3 / 4) {
            cropHeight = vHeight;
            cropWidth = Math.round(vHeight * (3 / 4));
            offsetX = Math.round((vWidth - cropWidth) / 2);
            offsetY = 0;
        } else {
            cropWidth = vWidth;
            cropHeight = Math.round(vWidth * (4 / 3));
            offsetX = 0;
            offsetY = Math.round((vHeight - cropHeight) / 2);
        }

        const canvas = document.createElement('canvas');
        canvas.width = 900;
        canvas.height = 1200; // 3:4 portrait dimensions
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, offsetX, offsetY, cropWidth, cropHeight, 0, 0, 900, 1200);

        canvas.toBlob((blob) => {
            if (blob) {
                const timestamp = new Date().toISOString().replace(/[-:.]/g, '');
                const capturedFile = new File([blob], `captured_concession_proof_${timestamp}.jpg`, { type: 'image/jpeg' });
                setImageFile(capturedFile);
                closeCameraModal();
            }
        }, 'image/jpeg', 0.92);
    };

    // Approval State
    const [pendingRequests, setPendingRequests] = useState([]);
    const [approvalLoading, setApprovalLoading] = useState(false);

    const [filters, setFilters] = useState({
        status: 'PENDING',
        college: '',
        course: '',
        branch: '',
        batch: '',
        search: ''
    });

    // Configurable Fee Heads & User History states
    const [settings, setSettings] = useState(null);
    const [selectedAllowedHeads, setSelectedAllowedHeads] = useState([]);
    const [userRequests, setUserRequests] = useState([]);
    const [isUserRequestsLoading, setIsUserRequestsLoading] = useState(false);

    // Modal State
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [modalAmount, setModalAmount] = useState('');
    const [rejectionReason, setRejectionReason] = useState('');
    const [bulkAmounts, setBulkAmounts] = useState({}); // {requestId: amount}


    const reportPrintRef = React.useRef();
    const historyPrintRef = React.useRef();
    const actionFormRef = React.useRef(null);

    const handleHistoryPrint = useReactToPrint({
        contentRef: historyPrintRef,
    });

    useEffect(() => {
        if (selectedStudents.length > 0 && actionFormRef.current) {
            actionFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [selectedStudents.length]);
    const handlePrint = async () => {
        try {
            const response = await api.post('/print', {
                template: 'concession-report',
                data: {
                    reportData,
                    filters: reportFilters
                }
            });
            printHtmlDocument(response.data);
        } catch (err) {
            console.error('Print failed:', err);
            alert('Failed to generate print document');
        }
    };

    // Metadata for filters
    const [metadata, setMetadata] = useState({ hierarchy: {}, batches: [] });
    // Derived lists based on selection
    const [collegeList, setCollegeList] = useState([]);
    const [courseList, setCourseList] = useState([]);
    const [branchList, setBranchList] = useState([]);
    const [batchList, setBatchList] = useState([]);
    // New state for filtered student list
    const [filteredStudents, setFilteredStudents] = useState([]);
    const [isFetchingStudents, setIsFetchingStudents] = useState(false);
    const [selectionMode, setSelectionMode] = useState('single'); // 'single' or 'multi'
    
    // Approver Management State
    const [approvers, setApprovers] = useState([]);
    const [newApprover, setNewApprover] = useState({ name: '', designation: '' });
    const [isApproverLoading, setIsApproverLoading] = useState(false);

    // Reports State
    const [reportFilters, setReportFilters] = useState({
        startDate: new Date(new Date().setDate(1)).toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
        concessionGivenBy: '',
        college: '',
        course: '',
        branch: '',
        batch: '',
        status: 'APPROVED'
    });
    const [reportData, setReportData] = useState([]);
    const [isReportLoading, setIsReportLoading] = useState(false);

    // Permission Check
    const storedUser = JSON.parse(localStorage.getItem('user')) || {};
    const permissions = storedUser.permissions || [];
    const role = storedUser.role;
    const hasPermission = role === 'superadmin' || role === 'admin' || permissions.includes('/concessions');

    const fetchSettings = async () => {
        try {
            const res = await api.get('/settings');
            setSettings(res.data);
            setSelectedAllowedHeads((res.data.allowedConcessionFeeHeads || []).map(id => id?.toString()));
        } catch (err) {
            console.error('Failed to load settings:', err);
        }
    };

    const fetchUserRequests = async (currentUser = user) => {
        const u = currentUser || JSON.parse(localStorage.getItem('user'));
        if (!u) return;
        setIsUserRequestsLoading(true);
        try {
            const userName = u.name || u.username;
            const res = await api.get(`/concessions`, {
                params: { requestedBy: userName }
            });
            setUserRequests(res.data || []);
        } catch (e) {
            console.error('Error fetching user concession requests:', e);
        }
        setIsUserRequestsLoading(false);
    };

    const handleEditRequest = async (req) => {
        if (req.status === 'APPROVED') {
            Swal.fire({
                icon: 'info',
                title: 'Approved Concession',
                text: 'Approved concessions cannot be edited directly from history. Please use the Reports tab.',
                customClass: { popup: 'rounded-2xl border border-gray-100 shadow-xl' }
            });
            return;
        }

        const { value: formValues } = await Swal.fire({
            title: 'Edit Concession Request',
            html: `
                <div class="space-y-3 text-left">
                    <div>
                        <label class="text-xs font-bold text-gray-600 block mb-1">Student</label>
                        <input type="text" class="w-full border border-gray-200 p-2 rounded-lg text-xs font-bold bg-gray-100 text-gray-700" value="${req.studentName} (${req.studentPin || req.studentId})" disabled />
                    </div>
                    <div>
                        <label class="text-xs font-bold text-gray-600 block mb-1">Concession Amount (₹) <span class="text-red-500">*</span></label>
                        <input id="swal-edit-amount" type="number" class="w-full border border-gray-300 p-2.5 rounded-lg text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none" value="${req.amount}" placeholder="Enter amount" />
                    </div>
                    <div>
                        <label class="text-xs font-bold text-gray-600 block mb-1">Reason / Justification</label>
                        <textarea id="swal-edit-reason" class="w-full border border-gray-300 p-2 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none" rows="2">${req.reason || ''}</textarea>
                    </div>
                </div>
            `,
            focusConfirm: false,
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#6b7280',
            customClass: {
                popup: 'rounded-2xl border border-gray-100 shadow-xl'
            },
            preConfirm: () => {
                const amountVal = document.getElementById('swal-edit-amount').value;
                const reasonVal = document.getElementById('swal-edit-reason').value;
                if (!amountVal || isNaN(amountVal) || Number(amountVal) <= 0) {
                    Swal.showValidationMessage('Please enter a valid amount greater than 0');
                    return false;
                }
                return { amount: Number(amountVal), reason: reasonVal };
            }
        });

        if (formValues) {
            try {
                await api.put(`/concessions/${req._id}`, {
                    amount: formValues.amount,
                    reason: formValues.reason
                });
                Swal.fire({
                    icon: 'success',
                    title: 'Updated!',
                    text: 'Concession request updated successfully.',
                    timer: 1500,
                    showConfirmButton: false,
                    customClass: { popup: 'rounded-2xl border border-gray-100 shadow-xl' }
                });
                fetchUserRequests();
            } catch (err) {
                console.error('Failed to update concession request:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Update Failed',
                    text: err.response?.data?.message || 'Could not update concession request.',
                    customClass: { popup: 'rounded-2xl border border-gray-100 shadow-xl' }
                });
            }
        }
    };

    const handleDeleteRequest = async (id) => {
        const result = await Swal.fire({
            title: 'Delete Request?',
            text: 'Are you sure you want to delete this concession request?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, Delete',
            cancelButtonText: 'Cancel',
            customClass: {
                popup: 'rounded-2xl border border-gray-100 shadow-xl'
            }
        });

        if (result.isConfirmed) {
            try {
                await api.delete(`/concessions/${id}`);
                Swal.fire({
                    icon: 'success',
                    title: 'Deleted',
                    text: 'Concession request deleted successfully.',
                    timer: 1500,
                    showConfirmButton: false,
                    customClass: {
                        popup: 'rounded-2xl border border-gray-100 shadow-xl'
                    }
                });
                fetchUserRequests();
            } catch (err) {
                console.error('Failed to delete concession request:', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Delete Failed',
                    text: err.response?.data?.message || 'Could not delete concession request.',
                    customClass: {
                        popup: 'rounded-2xl border border-gray-100 shadow-xl'
                    }
                });
            }
        }
    };

    const handleSaveAllowedFeeHeads = async () => {
        try {
            const res = await api.put('/settings', {
                ...settings,
                allowedConcessionFeeHeads: selectedAllowedHeads
            });
            setSettings(res.data);
            setSelectedAllowedHeads((res.data.allowedConcessionFeeHeads || []).map(id => id?.toString()));
            Swal.fire({
                icon: 'success',
                title: 'Settings Saved',
                text: 'Allowed Fee Heads configuration updated successfully.',
                timer: 1500,
                showConfirmButton: false,
                customClass: {
                    popup: 'rounded-2xl border border-gray-100 shadow-xl'
                }
            });
        } catch (err) {
            console.error(err);
            Swal.fire({
                icon: 'error',
                title: 'Failed to Save',
                text: 'Could not update Allowed Fee Heads configuration.'
            });
        }
    };

    useEffect(() => {
        if (!hasPermission) return;
        const u = JSON.parse(localStorage.getItem('user'));
        setUser(u);
        fetchFeeHeads();
        fetchMetadata();
        fetchSettings();
        if (activeTab === 'request') {
            fetchActiveApprovers();
            fetchUserRequests(u);
        }
        if (activeTab === 'approvals') {
            fetchPendingRequests();
        }
        if (activeTab === 'approvers' || activeTab === 'reports') {
            fetchAllApprovers();
        }
    }, [activeTab, hasPermission]);

    useEffect(() => {
        if (!hasPermission) return;
        if (activeTab === 'reports') {
            fetchReports();
        }
    }, [activeTab, reportFilters, hasPermission]);

    useEffect(() => {
        if (!hasPermission || activeTab !== 'request') return;

        const course = selectedStudents[0]?.course;
        if (!course) {
            setNextVoucherId('');
            return;
        }

        const fetchNextVoucherId = async () => {
            try {
                const res = await api.get(`/concessions/next-voucher-id`, {
                    params: { course },
                });
                setNextVoucherId(res.data.nextVoucherId);
            } catch (e) {
                console.error('Failed to fetch next voucher id', e);
                setNextVoucherId('');
            }
        };

        fetchNextVoucherId();
    }, [selectedStudents, activeTab, hasPermission]);

    const fetchReports = async () => {
        setIsReportLoading(true);
        try {
            const params = new URLSearchParams(reportFilters);
            Object.keys(reportFilters).forEach(key => {
                if (!reportFilters[key] && key !== 'status') params.delete(key);
            });

            const res = await api.get(`/concessions?${params.toString()}`);
            setReportData(res.data);
        } catch (e) { console.error(e); }
        setIsReportLoading(false);
    };

    // Load student dataset for FeeCollection-style instant search
    useEffect(() => {
        if (!hasPermission || activeTab !== 'request') return;
        const loadAllStudents = async () => {
            try {
                const u = JSON.parse(localStorage.getItem('user') || 'null');
                const isSuperAdmin = u?.role === 'superadmin';
                const queryParams = [];
                if (!isSuperAdmin) {
                    if (u?.colleges && u.colleges.length > 0) {
                        queryParams.push(`college=${encodeURIComponent(u.colleges.join(','))}`);
                    } else if (u?.college) {
                        queryParams.push(`college=${encodeURIComponent(u.college)}`);
                    }
                    if (u?.courses && u.courses.length > 0) {
                        const courseNames = [...new Set(u.courses.map(c => c.split('|')[1]))];
                        queryParams.push(`course=${encodeURIComponent(courseNames.join(','))}`);
                    }
                }
                const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';
                const res = await api.get(`/students${queryString}`);
                setAllStudents(res.data || []);
            } catch (e) {
                console.error('Failed to pre-fetch students for search', e);
            }
        };
        loadAllStudents();
    }, [activeTab, hasPermission]);

    // Search Logic (FeeCollection style client-side filter with server fallback)
    useEffect(() => {
        if (!hasPermission || activeTab !== 'request') return;

        const query = searchTerm ? searchTerm.toLowerCase().trim() : '';
        if (!query) {
            setSearchResults([]);
            setIsSearching(false);
            return;
        }

        setIsSearching(true);
        const cleanQuery = query.replace(/[^a-z0-9]/g, '');

        if (allStudents && allStudents.length > 0) {
            const matches = allStudents.filter(s => {
                const admNum = s.admission_number ? String(s.admission_number).toLowerCase().trim() : '';
                const admNo = s.admission_no ? String(s.admission_no).toLowerCase().trim() : '';
                const mobile = s.student_mobile ? String(s.student_mobile).toLowerCase().trim() : '';
                const pin = s.pin_no ? String(s.pin_no).toLowerCase().trim() : '';
                const name = s.student_name ? s.student_name.toLowerCase().trim() : '';

                const cleanAdmNum = admNum.replace(/[^a-z0-9]/g, '');
                const cleanAdmNo = admNo.replace(/[^a-z0-9]/g, '');
                const cleanPin = pin.replace(/[^a-z0-9]/g, '');

                return (
                    name.includes(query) ||
                    pin.includes(query) ||
                    admNum.includes(query) ||
                    admNo.includes(query) ||
                    mobile.includes(query) ||
                    (cleanQuery.length > 0 && cleanPin.includes(cleanQuery)) ||
                    (cleanQuery.length > 0 && cleanAdmNum.includes(cleanQuery)) ||
                    (cleanQuery.length > 0 && cleanAdmNo.includes(cleanQuery))
                );
            });

            matches.sort((a, b) => {
                const aName = (a.student_name || '').toLowerCase();
                const bName = (b.student_name || '').toLowerCase();
                const aPin = (a.pin_no || '').toLowerCase();
                const bPin = (b.pin_no || '').toLowerCase();
                const aAdm = (a.admission_number || '').toLowerCase();
                const bAdm = (b.admission_number || '').toLowerCase();

                const aExact = aName === query || aPin === query || aAdm === query;
                const bExact = bName === query || bPin === query || bAdm === query;
                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;

                const aPrefix = aName.startsWith(query) || aPin.startsWith(query) || aAdm.startsWith(query);
                const bPrefix = bName.startsWith(query) || bPin.startsWith(query) || bAdm.startsWith(query);
                if (aPrefix && !bPrefix) return -1;
                if (!aPrefix && bPrefix) return 1;

                return 0;
            });

            setSearchResults(matches.slice(0, 20));
            setIsSearching(false);
        } else {
            const delayDebounceFn = setTimeout(async () => {
                try {
                    const res = await api.get(`/students/search?q=${encodeURIComponent(query)}`);
                    setSearchResults(res.data || []);
                } catch (error) {
                    console.error('Search request error:', error);
                    setSearchResults([]);
                } finally {
                    setIsSearching(false);
                }
            }, 300);
            return () => clearTimeout(delayDebounceFn);
        }
    }, [searchTerm, allStudents, activeTab, hasPermission]);

    const applyStudentContextToForm = (s) => {
        if (!s) return;
        setFormData(prev => ({
            ...prev,
            studentYear: s.current_year,
            semester: s.current_semester,
            college: s.college,
            course: s.course,
            branch: s.branch,
            batch: s.batch
        }));
    };

    const toggleStudentSelection = (s) => {
        // Toggle selection
        const alreadySelected = selectedStudents.some(sel => sel.admission_number === s.admission_number);
        if (alreadySelected) {
            setSelectedStudents(prev => prev.filter(sel => sel.admission_number !== s.admission_number));
        } else {
            setSelectedStudents(prev => [...prev, s]);
            applyStudentContextToForm(s);
        }
        // Set preview for details view
        setPreviewStudent(s);
        setSearchTerm('');
        setSearchResults([]);
    };

    const fetchMetadata = async () => {
        try {
            const res = await api.get(`/students/metadata`);
            setMetadata(res.data);
            setCollegeList(Object.keys(res.data.hierarchy || {}));
            setBatchList(res.data.batches || []);
        } catch (e) { console.error(e); }
    };

    const openEditModal = (req) => {
        setEditingRequest(req);
        setEditAmount(req.amount);
        setEditReason(req.reason);
        setEditConcessionGivenBy(req.concessionGivenBy || '');
        setIsEditModalOpen(true);
    };

    const handleEditSubmit = async () => {
        if (!editAmount || isNaN(editAmount) || Number(editAmount) <= 0) {
            alert('Please enter a valid amount');
            return;
        }

        setEditLoading(true);
        try {
            await api.put(`/concessions/modify-approved/${editingRequest._id}`, {
                amount: Number(editAmount),
                reason: editReason,
                concessionGivenBy: editConcessionGivenBy
            });
            
            setIsEditModalOpen(false);
            fetchReports(); // Refresh report data
            alert('Concession updated successfully');
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || 'Update failed');
        } finally {
            setEditLoading(false);
        }
    };

    const fetchFilteredStudents = async () => {
        if (!formData.college) return alert('Please select a college at least');
        setIsFetchingStudents(true);
        try {
            const params = new URLSearchParams();
            if (formData.college) params.append('college', formData.college);
            if (formData.course) params.append('course', formData.course);
            if (formData.branch) params.append('branch', formData.branch);
            if (formData.batch) params.append('batch', formData.batch);

            const res = await api.get(`/students?${params.toString()}`);
            setFilteredStudents(res.data);
            // Optionally clear existing selections if filters majorly change, 
            // but user might want to select from different filters sequentially.
            // For now, let's keep it simple and clear.
            setSelectedStudents([]);
        } catch (e) { console.error(e); }
        setIsFetchingStudents(false);
    };

    // Consolidated effect to update dropdown lists based on active tab filtering
    useEffect(() => {
        if (!hasPermission) return;
        // Decide which filter source to use
        let currentCollege = '';
        let currentCourse = '';

        if (activeTab === 'request') {
            currentCollege = formData.college;
            currentCourse = formData.course;
        } else if (activeTab === 'approvals') {
            currentCollege = filters.college;
            currentCourse = filters.course;
        } else if (activeTab === 'reports') {
            currentCollege = reportFilters.college;
            currentCourse = reportFilters.course;
        }

        if (!currentCollege) {
            setCourseList([]);
            setBranchList([]);
            return;
        }

        const courses = metadata.hierarchy[currentCollege] ? Object.keys(metadata.hierarchy[currentCollege]) : [];
        setCourseList(courses);

        if (!currentCourse) {
            setBranchList([]);
            return;
        }

        const branches = metadata.hierarchy[currentCollege][currentCourse] ? metadata.hierarchy[currentCollege][currentCourse].branches : [];
        setBranchList(branches);

    }, [activeTab, formData.college, formData.course, filters.college, filters.course, reportFilters.college, reportFilters.course, metadata, hasPermission]);


    const fetchFeeHeads = async () => {
        try {
            const res = await api.get(`/fee-heads`);
            setFeeHeads(res.data);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        if (!hasPermission) return;
        if (activeTab === 'approvals') {
            fetchPendingRequests();
        }
    }, [activeTab, filters, hasPermission]); // Refetch when filters change

    const fetchPendingRequests = async () => {
        setApprovalLoading(true);
        try {
            const params = new URLSearchParams(filters);
            Object.keys(filters).forEach(key => {
                if (!filters[key] && key !== 'status') params.delete(key);
            });

            const res = await api.get(`/concessions?${params.toString()}`);

            // Group requests by college + course + voucherId for bulk display so different students with same voucher ID in different colleges/courses don't overlap
            const grouped = [];
            const voucherMap = {};

            res.data.forEach(req => {
                const groupKey = req.voucherId ? `${req.college || ''}_${req.course || ''}_${req.voucherId}` : `single-${req._id}`;
                if (!voucherMap[groupKey]) {
                    voucherMap[groupKey] = {
                        groupKey,
                        isBulk: false,
                        voucherId: req.voucherId,
                        createdAt: req.createdAt,
                        college: req.college,
                        course: req.course,
                        branch: req.branch,
                        batch: req.batch,
                        requestedBy: req.requestedBy || 'N/A',
                        feeHead: req.feeHead,
                        feeHeads: [], // Track unique fee heads
                        reason: req.reason,
                        requests: [],
                        totalAmount: 0
                    };
                    grouped.push(voucherMap[groupKey]);
                }
                voucherMap[groupKey].requests.push(req);
                voucherMap[groupKey].totalAmount += req.amount;
                
                // Track unique fee heads in the group
                if (req.feeHead) {
                    const headId = req.feeHead._id || req.feeHead;
                    if (!voucherMap[groupKey].feeHeads.some(h => (h._id || h) === headId)) {
                        voucherMap[groupKey].feeHeads.push(req.feeHead);
                    }
                }
            });

            grouped.forEach(g => {
                g.isBulk = g.requests.length > 1;
            });

            setPendingRequests(grouped);
        } catch (error) {
            console.error(error);
        } finally {
            setApprovalLoading(false);
        }
    };

    // Approver CRUD
    const fetchActiveApprovers = async () => {
        try {
            const res = await api.get('/concession-approvers');
            setApprovers(res.data);
        } catch (e) {
            console.error('Failed to load approvers', e);
        }
    };

    const fetchAllApprovers = async () => {
        try {
            const res = await api.get('/concession-approvers/all');
            setApprovers(res.data);
        } catch (e) {
            console.error('Failed to load approvers', e);
        }
    };

    const fetchApprovers = fetchAllApprovers;

    const handleAddApprover = async (e) => {
        e.preventDefault();
        if (!newApprover.name || !newApprover.designation) return alert('Please fill all fields');
        setIsApproverLoading(true);
        try {
            await api.post(`/concession-approvers`, newApprover);
            setNewApprover({ name: '', designation: '' });
            fetchApprovers();
        } catch (e) { alert('Failed to add'); }
        setIsApproverLoading(false);
    };

    const toggleApprover = async (id) => {
        try {
            await api.put(`/concession-approvers/${id}/toggle`);
            fetchApprovers();
        } catch (e) { alert('Failed to toggle'); }
    };

    const deleteApprover = async (id) => {
        if (!window.confirm('Are you sure?')) return;
        try {
            await api.delete(`/concession-approvers/${id}`);
            fetchApprovers();
        } catch (e) { alert('Failed to delete'); }
    };

    const handleSubmitRequest = async (e) => {
        if (e) e.preventDefault();
        if (selectedStudents.length === 0) return alert('Please select at least one student');
        if (isSubmittingRequest) return;

        setIsSubmittingRequest(true);
        try {
            const formDataObjs = new FormData();

            // Bulk Students Array
            const studentsData = selectedStudents.map(s => ({
                studentId: s.admission_number,
                studentName: s.student_name,
                studentPin: s.pin_no, // [NEW]
                college: s.college,
                course: s.course,
                branch: s.branch,
                batch: s.batch
            }));
            formDataObjs.append('students', JSON.stringify(studentsData));

            // Append other fields
            formDataObjs.append('feeHeadId', formData.feeHeadId);
            formDataObjs.append('amount', formData.amount);
            formDataObjs.append('reason', formData.reason);
            formDataObjs.append('studentYear', formData.studentYear || '1');
            if (formData.semester) formDataObjs.append('semester', formData.semester);

            if (formData.concessionGivenBy) {
                formDataObjs.append('concessionGivenBy', formData.concessionGivenBy);
            }

            if (imageFile) {
                formDataObjs.append('image', imageFile);
            }

            const response = await api.post(`/concessions`, formDataObjs, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            const createdVoucherId = response.data.data?.[0]?.voucherId || 'N/A';
            const submittedCourse = selectedStudents[0]?.course;
            const selectedFeeHead = feeHeads.find(f => f._id === formData.feeHeadId)?.name || 'Fee Component';
            const studentDisplayName = selectedStudents.length === 1 
                ? `${selectedStudents[0].student_name} (${selectedStudents[0].pin_number || selectedStudents[0].admission_number || selectedStudents[0].pin_no || 'N/A'})` 
                : `${selectedStudents.length} Students`;

            setSuccessModalData({
                voucherId: createdVoucherId,
                count: selectedStudents.length,
                studentName: studentDisplayName,
                feeHeadName: selectedFeeHead,
                amount: formData.amount,
                mode: selectionMode
            });
            // Reset selections and form
            setSelectedStudents([]);
            setFormData({ feeHeadId: '', amount: '', reason: '', studentYear: '', semester: '', college: '', course: '', branch: '', batch: '', concessionGivenBy: '' });
            setImageFile(null);
            setNextVoucherId('');

            if (submittedCourse) {
                try {
                    const res = await api.get(`/concessions/next-voucher-id`, {
                        params: { course: submittedCourse },
                    });
                    setNextVoucherId(res.data.nextVoucherId);
                } catch (e) {
                    console.error('Failed to refresh next voucher id', e);
                }
            }

            fetchUserRequests();
        } catch (error) {
            console.error(error);
            alert(error.response?.data?.message || error.response?.data?.error || 'Failed to submit request');
        } finally {
            setIsSubmittingRequest(false);
        }
    };

    const openModal = (group) => {
        setSelectedRequest(group);
        if (group.isBulk) {
            const initialAmounts = {};
            group.requests.forEach(r => initialAmounts[r._id] = r.amount);
            setBulkAmounts(initialAmounts);
        } else {
            setModalAmount(group.requests[0].amount);
        }
        setRejectionReason('');
    };

    const closeModal = () => {
        setSelectedRequest(null);
        setModalAmount('');
        setBulkAmounts({});
        setRejectionReason('');
    };

    const handleApprovalAction = async (action) => {
        if (!selectedRequest) return;
        if (!window.confirm(`Are you sure you want to ${action} this request?`)) return;

        setApprovalLoading(true);
        try {
            if (selectedRequest.requests[0].status === 'APPROVED' && action === 'APPROVE') {
                // MODIFICATION logic for already approved requests
                const promises = selectedRequest.requests.map(r => {
                    const newAmount = selectedRequest.isBulk ? bulkAmounts[r._id] : modalAmount;
                    return api.put(`/concessions/modify-approved/${r._id}`, {
                        amount: Number(newAmount),
                        reason: r.reason // Keep existing reason or you could add a way to edit it
                    });
                });
                await Promise.all(promises);
            } else if (selectedRequest.isBulk) {
                // Bulk Process (Regular Approval)
                const requestsPayload = selectedRequest.requests.map(r => ({
                    id: r._id,
                    approvedAmount: action === 'APPROVE' ? bulkAmounts[r._id] : r.amount
                }));

                await api.put(`/concessions/bulk-process`, {
                    requests: requestsPayload,
                    action,
                    rejectionReason
                });
            } else {
                // Single Process (Regular Approval)
                const payload = { action };
                if (action === 'APPROVE') {
                    payload.approvedAmount = modalAmount;
                } else if (action === 'REJECT') {
                    payload.rejectionReason = rejectionReason;
                }

                await api.put(`/concessions/${selectedRequest.requests[0]._id}/process`, payload);
            }

            closeModal();
            fetchPendingRequests();
        } catch (error) {
            console.error(error);
            alert(error.response?.data?.message || 'Action Failed');
        } finally {
            setApprovalLoading(false);
        }
    };

    if (!hasPermission) {
        return (
            <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
                <Sidebar isOpenMobile={isOpenMobile} onCloseMobile={() => setIsOpenMobile(false)} />
                <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
                    <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl border border-red-100 max-w-md w-full text-center animate-in fade-in zoom-in duration-300">
                        <div className="w-16 sm:w-20 h-16 sm:h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6">
                            <ShieldAlert size={36} className="text-red-500" />
                        </div>
                        <h2 className="text-xl sm:text-2xl font-black text-slate-800 mb-2">Access Denied</h2>
                        <p className="text-slate-500 text-xs sm:text-sm font-medium leading-relaxed">
                            You don't have the required permissions to view or manage Concession Approvals. Please contact your administrator.
                        </p>
                        <button 
                            onClick={() => window.history.back()}
                            className="mt-6 sm:mt-8 w-full py-3 px-6 bg-slate-800 text-white text-sm font-bold rounded-2xl hover:bg-slate-900 transition-all shadow-lg shadow-slate-200 cursor-pointer"
                        >
                            Go Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const isSuperAdmin = user?.role === 'superadmin';

    return (
        <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
            <Sidebar isOpenMobile={isOpenMobile} onCloseMobile={() => setIsOpenMobile(false)} />
            <div className="flex-1 flex flex-col h-full overflow-y-auto min-w-0">
                {/* Header Section */}
                <header className="bg-white border-b px-4 sm:px-6 py-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0">
                    <div className="flex items-center justify-between w-full sm:w-auto">
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setIsOpenMobile(true)}
                                className="md:hidden p-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 focus:outline-none"
                                title="Open navigation menu"
                            >
                                <Menu size={20} />
                            </button>
                            <div>
                                <h1 className="text-lg sm:text-xl font-bold text-gray-800 leading-tight">Concession Management</h1>
                                <p className="text-[11px] sm:text-xs text-gray-500">Manage student fee concessions and approvals</p>
                            </div>
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex bg-gray-100 p-1 rounded-xl shadow-inner border border-gray-200 overflow-x-auto max-w-full w-full sm:w-auto scrollbar-none gap-1">
                        <button
                            className={`px-3.5 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-all duration-300 whitespace-nowrap ${activeTab === 'request' ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                            onClick={() => setActiveTab('request')}
                        >
                            Raise Request
                        </button>
                        {(isSuperAdmin || (user?.permissions || []).includes('concession_approvals')) && (
                            <button
                                className={`px-3.5 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-all duration-300 flex items-center gap-1.5 whitespace-nowrap ${activeTab === 'approvals' ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                                onClick={() => setActiveTab('approvals')}
                            >
                                Requests
                                {pendingRequests.length > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activeTab === 'approvals' ? 'bg-red-500 text-white' : 'bg-red-100 text-red-600'}`}>
                                        {pendingRequests.length}
                                    </span>
                                )}
                            </button>
                        )}
                        {(isSuperAdmin || (user?.permissions || []).includes('concession_approvers')) && (
                            <button
                                className={`px-3.5 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-all duration-300 whitespace-nowrap ${activeTab === 'approvers' ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                                onClick={() => setActiveTab('approvers')}
                            >
                                Approvers
                            </button>
                        )}
                        {(isSuperAdmin || (user?.permissions || []).includes('concession_approvals')) && (
                            <button
                                className={`px-3.5 sm:px-5 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg transition-all duration-300 whitespace-nowrap ${activeTab === 'reports' ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200'}`}
                                onClick={() => setActiveTab('reports')}
                            >
                                Reports
                            </button>
                        )}
                    </div>
                </header>

                {/* Content Area - Request Tab */}
                {activeTab === 'request' && (
                    <div className="p-3 sm:p-6 flex flex-col gap-6 max-w-[1700px] mx-auto w-full">
                        <div className="flex flex-col lg:flex-row items-start gap-4 sm:gap-6 w-full">
                        {/* LEFT COLUMN: Student Context & Filters */}
                        <div className="w-full lg:w-1/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col shrink-0">
                            <div className="p-3 sm:p-4 border-b bg-gray-50 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-gray-600 uppercase block font-sans tracking-tight">Find Student</label>
                                    {/* Single vs Multi Sub-Tabs */}
                                    <div className="flex bg-gray-200/80 p-0.5 rounded-lg border border-gray-300/60">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectionMode('single');
                                                if (selectedStudents.length > 1) {
                                                    setSelectedStudents([selectedStudents[0]]);
                                                }
                                            }}
                                            className={`px-3 py-1 text-xs font-extrabold rounded-md transition-all ${
                                                selectionMode === 'single'
                                                    ? 'bg-white text-blue-600 shadow-xs'
                                                    : 'text-gray-500 hover:text-gray-800'
                                            }`}
                                        >
                                            Single
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setSelectionMode('multi')}
                                            className={`px-3 py-1 text-xs font-extrabold rounded-md transition-all ${
                                                selectionMode === 'multi'
                                                    ? 'bg-white text-blue-600 shadow-xs'
                                                    : 'text-gray-500 hover:text-gray-800'
                                            }`}
                                        >
                                            Multi
                                        </button>
                                    </div>
                                </div>

                                {/* Search Bar */}
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <Search className="h-4 w-4 text-gray-400" />
                                    </div>
                                    <input
                                        ref={searchInputRef}
                                        type="text"
                                        className="pl-10 w-full border border-gray-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition"
                                        placeholder="Search Name, Adm No, Pin, Mobile..."
                                        value={searchTerm}
                                        onChange={e => { setSearchTerm(e.target.value); if (e.target.value === '') setSearchResults([]); }}
                                    />
                                    {isSearching && <div className="absolute right-3 top-2.5 text-xs text-gray-400">...</div>}

                                    {/* Search Dropdown */}
                                    {(searchResults.length > 0 || isSearching) && (
                                        <div className="absolute z-20 w-full bg-white border rounded-lg shadow-xl max-h-60 overflow-y-auto mt-1 left-0">
                                            {searchResults.map(s => (
                                                <div
                                                    key={s.admission_number}
                                                    onClick={() => {
                                                        if (selectionMode === 'single') {
                                                            setSelectedStudents([s]);
                                                            applyStudentContextToForm(s);
                                                            setPreviewStudent(s);
                                                            setSearchTerm('');
                                                            setSearchResults([]);
                                                        } else {
                                                            toggleStudentSelection(s);
                                                        }
                                                    }}
                                                    className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0 transition-colors"
                                                >
                                                    <div className="font-bold text-gray-800 text-sm flex items-center justify-between">
                                                        <span>{s.student_name}</span>
                                                        {s.pin_no && <span className="text-xs font-mono font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{s.pin_no}</span>}
                                                    </div>
                                                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                                                        <span>
                                                            Adm: <strong className="text-gray-700">{s.admission_number}</strong>
                                                            {s.pin_no ? ` | Pin: ${s.pin_no}` : ''}
                                                            {s.student_mobile ? ` | Mob: ${s.student_mobile}` : ''}
                                                        </span>
                                                        <span className="font-medium text-gray-600">{s.course} - {s.branch}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Filters For Bulk Selection - ONLY DISPLAYED IN MULTI MODE */}
                                {selectionMode === 'multi' && (
                                    <div className="space-y-3 pt-2 animate-fade-in">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <select
                                                className="w-full border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={formData.college}
                                                onChange={e => setFormData({ ...formData, college: e.target.value, course: '', branch: '' })}
                                            >
                                                <option value="">Select College</option>
                                                {collegeList.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            <select
                                                className="w-full border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={formData.course}
                                                onChange={e => setFormData({ ...formData, course: e.target.value, branch: '' })}
                                            >
                                                <option value="">Select Course</option>
                                                {courseList.map(c => <option key={c} value={c}>{c}</option>)}
                                            </select>
                                            <select
                                                className="w-full border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={formData.branch}
                                                onChange={e => setFormData({ ...formData, branch: e.target.value })}
                                            >
                                                <option value="">Select Branch</option>
                                                {branchList.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                            <select
                                                className="w-full border border-gray-300 rounded-lg p-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={formData.batch}
                                                onChange={e => setFormData({ ...formData, batch: e.target.value })}
                                            >
                                                <option value="">Select Batch</option>
                                                {batchList.map(b => <option key={b} value={b}>{b}</option>)}
                                            </select>
                                        </div>
                                        <button
                                            onClick={fetchFilteredStudents}
                                            disabled={isFetchingStudents || !formData.college}
                                            className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                                        >
                                            <Filter className="w-4 h-4" />
                                            {isFetchingStudents ? 'Loading Students...' : 'Load Student List'}
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Bottom Student Display Panel */}
                            <div className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50/50 min-h-[160px]">
                                {selectionMode === 'single' ? (
                                    /* Single Mode Display: Card if selected, or Search Prompt */
                                    selectedStudents.length > 0 ? (
                                        <div className="p-4 bg-white rounded-xl m-3 border border-blue-200 shadow-xs space-y-3">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-0.5 rounded border border-blue-100">Selected Student</span>
                                                    <h4 className="font-extrabold text-gray-900 text-base mt-1.5">{selectedStudents[0].student_name}</h4>
                                                    <p className="text-xs text-gray-500 font-mono font-bold">{selectedStudents[0].admission_number} | {selectedStudents[0].pin_no}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => setSelectedStudents([])}
                                                    className="text-xs font-bold text-red-500 hover:text-red-700 bg-red-50 px-2.5 py-1 rounded-md border border-red-100 hover:bg-red-100 transition-all"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-xs border-t border-gray-100 pt-3">
                                                <div>
                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">College</span>
                                                    <span className="font-semibold text-gray-800">{selectedStudents[0].college || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Course</span>
                                                    <span className="font-semibold text-gray-800">{selectedStudents[0].course || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Branch</span>
                                                    <span className="font-semibold text-gray-800">{selectedStudents[0].branch || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Batch</span>
                                                    <span className="font-semibold text-gray-800">{selectedStudents[0].batch || 'N/A'}</span>
                                                </div>
                                                <div>
                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Year / Sem</span>
                                                    <span className="font-semibold text-gray-800">Year {selectedStudents[0].current_year || '1'} {selectedStudents[0].current_semester ? `/ Sem ${selectedStudents[0].current_semester}` : ''}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-400 p-6 text-center space-y-3">
                                            <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center">
                                                <Search className="w-6 h-6 opacity-30" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-500 text-xs">Single Student Mode</p>
                                                <p className="text-[11px] mt-1 text-gray-400">Search for a student above by Name, ID or Pin number.</p>
                                            </div>
                                        </div>
                                    )
                                ) : (
                                    /* Multi Mode Display: Filtered List or Prompt */
                                    filteredStudents.length > 0 ? (
                                        <div className="divide-y divide-gray-200">
                                            <div className="p-3 bg-white sticky top-0 z-10 border-b flex items-center justify-between shadow-sm">
                                                <span className="text-xs font-bold text-gray-500 uppercase">Filtered Students ({filteredStudents.length})</span>
                                                <button 
                                                    onClick={() => {
                                                        if (selectedStudents.length === filteredStudents.length) {
                                                            setSelectedStudents([]);
                                                        } else {
                                                            setSelectedStudents(filteredStudents);
                                                            if (filteredStudents.length > 0) {
                                                                applyStudentContextToForm(filteredStudents[0]);
                                                            }
                                                        }
                                                    }}
                                                    className="text-xs text-blue-600 font-extrabold hover:underline"
                                                >
                                                    {selectedStudents.length === filteredStudents.length ? 'Deselect All' : 'Select All'}
                                                </button>
                                            </div>
                                            {filteredStudents.map(s => {
                                                const isSelected = selectedStudents.some(sel => sel.admission_number === s.admission_number);
                                                return (
                                                    <div 
                                                        key={s.admission_number}
                                                        className={`p-3 border-b hover:bg-blue-50 transition-colors flex items-center gap-3 cursor-pointer ${isSelected ? 'bg-blue-50' : ''}`}
                                                        onClick={() => toggleStudentSelection(s)}
                                                    >
                                                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-blue-600 border-blue-600 scale-110' : 'border-gray-300 bg-white'}`}>
                                                            {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="font-bold text-gray-800 text-sm truncate">{s.student_name}</div>
                                                            <div className="flex justify-between text-xs text-gray-500">
                                                                <span>{s.pin_number || s.admission_number}</span>
                                                                <span className="truncate ml-2">{s.course}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="h-full flex flex-col items-center justify-center text-gray-400 p-6 sm:p-8 text-center space-y-3">
                                            <div className="w-14 sm:w-16 h-14 sm:h-16 bg-gray-100 rounded-full flex items-center justify-center">
                                                <Filter className="w-6 sm:w-8 h-6 sm:h-8 opacity-20" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-500 text-xs sm:text-sm">No Students Loaded</p>
                                                <p className="text-[11px] sm:text-xs mt-1">Select college and course above to load students for bulk selection, or use search for individual students.</p>
                                            </div>
                                        </div>
                                    )
                                )}
                            </div>
                        </div>

                        {/* RIGHT COLUMN: Action Form */}
                        <div ref={actionFormRef} className={`w-full lg:w-2/3 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col transition-all duration-300 ${selectedStudents.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="p-3 sm:p-4 border-b flex flex-wrap items-center justify-between bg-gray-50 gap-2">
                                <div className={`items-center gap-3 ${selectionMode === 'single' ? 'hidden sm:flex' : 'flex'}`}>
                                    <div className="bg-blue-600 text-white rounded p-1.5 shadow-sm"><Check size={18} /></div>
                                    <div>
                                        <h2 className="font-bold text-gray-800 text-sm sm:text-base">Concession Details</h2>
                                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">
                                            {selectionMode === 'single' ? 'Single Student Request' : `Raising for ${selectedStudents.length} Students`}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
                                    {nextVoucherId && selectedStudents.length > 0 && (
                                        <span className="text-sm sm:text-base font-extrabold bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 text-white px-4 py-1.5 rounded-xl border border-emerald-400/30 shadow-md flex items-center gap-2 tracking-wide ring-2 ring-emerald-500/20">
                                            <Tag size={16} className="text-emerald-200 shrink-0" />
                                            <span>Next Voucher: <strong className="font-mono bg-white/20 px-2 py-0.5 rounded-md text-white">#{nextVoucherId}</strong></span>
                                        </span>
                                    )}
                                    {selectionMode === 'multi' && selectedStudents.length > 0 && (
                                        <button 
                                            onClick={() => setSelectedStudents([])}
                                            className="text-xs text-red-500 font-bold flex items-center gap-1 hover:text-red-700"
                                        >
                                            <X size={14} /> Clear Selection
                                        </button>
                                    )}
                                </div>
                            </div>

                            <form onSubmit={handleSubmitRequest} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                                {/* Selected Students Summary Badge (Only in Multi Mode) */}
                                {selectionMode === 'multi' && selectedStudents.length > 0 && (
                                    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 sm:p-4">
                                        <h3 className="text-xs font-extrabold text-blue-800 uppercase mb-3 flex items-center gap-2">
                                            <Calendar className="w-3.5 h-3.5" /> Selected Students ({selectedStudents.length})
                                        </h3>
                                        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-2">
                                            {selectedStudents.map(s => (
                                                <div key={s.admission_number} className="bg-white px-2 py-1 rounded border border-blue-200 flex items-center gap-2 text-[11px] font-bold text-blue-700 animate-fade-in">
                                                    <span>{s.student_name}</span>
                                                    <button onClick={(e) => { e.stopPropagation(); toggleStudentSelection(s); }} className="hover:text-red-500"><X size={10} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-600 mb-1 block">Fee Head <span className="text-red-500">*</span></label>
                                        <select
                                            className="w-full border border-gray-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition hover:border-blue-300"
                                            value={formData.feeHeadId}
                                            onChange={e => setFormData({ ...formData, feeHeadId: e.target.value })}
                                            required
                                        >
                                            <option value="">Select Fee Component</option>
                                             {feeHeads.filter(fh => {
                                                 if (!settings || !settings.allowedConcessionFeeHeads || settings.allowedConcessionFeeHeads.length === 0) return true;
                                                 return settings.allowedConcessionFeeHeads.map(id => id?.toString()).includes(fh._id?.toString());
                                             }).map(fh => <option key={fh._id} value={fh._id}>{fh.name}</option>)}
                                        </select>
                                        {selectedStudents.length > 0 && formData.studentYear && (
                                            <p className="text-[10px] text-indigo-600 font-semibold mt-1">
                                                Credit applies to Year {formData.studentYear}
                                                {formData.semester ? ` · Semester ${formData.semester}` : ''} (student&apos;s current year)
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-600 mb-1 block">Amount (₹) <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-2.5 text-gray-400 text-sm font-bold">₹</span>
                                            <input
                                                type="number"
                                                className="w-full border border-gray-300 pl-8 p-2.5 rounded-lg text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition"
                                                value={formData.amount}
                                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                                required
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 block mb-1">Concession Authorized By / Given By <span className="text-red-500">*</span></label>
                                    <select
                                        className="w-full border border-gray-300 p-2.5 rounded-lg text-sm font-bold text-gray-800 bg-white focus:ring-2 focus:ring-blue-500 outline-none transition hover:border-blue-300"
                                        value={formData.concessionGivenBy}
                                        onChange={e => setFormData({ ...formData, concessionGivenBy: e.target.value })}
                                        required
                                    >
                                        <option value="">-- Select Authority --</option>
                                        {approvers.map(a => (
                                            <option key={a._id} value={a.name}>{a.name} ({a.designation})</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-600 block">Justification / Reason <span className="text-red-500">*</span></label>
                                    <textarea
                                        className="w-full border border-gray-300 p-3 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition h-24 resize-none shadow-sm"
                                        value={formData.reason}
                                        onChange={e => setFormData({ ...formData, reason: e.target.value })}
                                        required
                                        placeholder="Enter detailed reason for this concession request..."
                                    ></textarea>
                                </div>

                                <div className="bg-gradient-to-br from-slate-50 to-blue-50/40 border border-dashed border-blue-200 rounded-xl p-3 sm:p-5 transition-all shadow-xs space-y-3">
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                                        <label className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5 uppercase tracking-wider">
                                            <Upload size={14} className="text-blue-600" />
                                            Supporting Document (Proof)
                                        </label>
                                        <span className="text-[10px] text-blue-800 font-bold bg-blue-100/80 px-2.5 py-1 rounded-full flex items-center gap-1 self-start sm:self-auto border border-blue-200 shadow-2xs">
                                            <Lock size={10} className="text-blue-600" />
                                        </span>
                                    </div>

                                    {!imageFile ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                            <label className="flex items-center justify-center gap-2 bg-white hover:bg-blue-50/80 text-gray-700 hover:text-blue-700 border border-gray-300 hover:border-blue-300 px-4 py-3 rounded-xl text-xs sm:text-sm font-bold cursor-pointer transition shadow-xs active:scale-98 min-h-[44px]">
                                                <Upload size={18} className="text-blue-600 shrink-0" />
                                                <span>Choose File / Upload</span>
                                                <input
                                                    type="file"
                                                    accept="image/*,.pdf"
                                                    onChange={e => {
                                                        if (e.target.files && e.target.files[0]) {
                                                            setImageFile(e.target.files[0]);
                                                        }
                                                    }}
                                                    className="hidden"
                                                />
                                            </label>

                                            <button
                                                type="button"
                                                onClick={openCameraModal}
                                                className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-4 py-3 rounded-xl text-xs sm:text-sm font-extrabold cursor-pointer transition shadow-md hover:shadow-lg active:scale-98 min-h-[44px]"
                                            >
                                                <Camera size={18} className="shrink-0" />
                                                <span>Capture Live Photo</span>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="bg-white rounded-xl border border-blue-200 p-3 sm:p-4 shadow-sm space-y-3">
                                            <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shrink-0">
                                                        {imageFile.type && imageFile.type.startsWith('image/') ? <Image size={18} /> : <FileText size={18} />}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-xs font-bold text-gray-800 truncate">{imageFile.name}</p>
                                                        <p className="text-[10px] text-gray-500 font-medium">
                                                            {(imageFile.size / 1024).toFixed(1)} KB • Staged for submission
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 shrink-0">
                                                    {imagePreviewUrl && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsPreviewModalOpen(true)}
                                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                            title="Preview full image"
                                                        >
                                                            <Eye size={16} />
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => setImageFile(null)}
                                                        className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                                                        title="Remove file"
                                                    >
                                                        <X size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {imagePreviewUrl ? (
                                                <div className="relative group rounded-xl overflow-hidden bg-gray-900 border border-gray-200 aspect-[3/4] w-36 sm:w-44 max-h-56 flex justify-center items-center mx-auto shadow-xs">
                                                    <img
                                                        src={imagePreviewUrl}
                                                        alt="Staged proof (3:4 portrait)"
                                                        className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition"
                                                        onClick={() => setIsPreviewModalOpen(true)}
                                                    />
                                                    <div className="absolute bottom-1.5 right-1.5 bg-slate-900/80 text-white text-[9px] px-1.5 py-0.5 rounded backdrop-blur-xs font-bold">
                                                        3:4 Portrait
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-3 bg-gray-50 rounded-lg text-center text-xs text-gray-500 font-medium border border-gray-100">
                                                    Document ready: <span className="font-bold text-gray-700">{imageFile.name}</span>
                                                </div>
                                            )}

                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                                <label className="text-[11px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg border border-blue-200 transition">
                                                    Replace File
                                                    <input
                                                        type="file"
                                                        accept="image/*,.pdf"
                                                        onChange={e => {
                                                            if (e.target.files && e.target.files[0]) {
                                                                setImageFile(e.target.files[0]);
                                                            }
                                                        }}
                                                        className="hidden"
                                                    />
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={openCameraModal}
                                                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition flex items-center gap-1"
                                                >
                                                    <Camera size={12} /> Retake Photo
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </form>

                            <div className="p-3 sm:p-4 border-t bg-gray-50 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                                <div className="text-xs font-bold text-gray-500 text-center sm:text-left">
                                    {selectedStudents.length > 0 && (
                                        selectionMode === 'single'
                                            ? 'Ready to raise single student concession.'
                                            : `Ready to raise concession for ${selectedStudents.length} students.`
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleSubmitRequest}
                                    disabled={selectedStudents.length === 0 || isSubmittingRequest}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-extrabold shadow-lg flex items-center justify-center gap-2 transition transform active:scale-95 disabled:opacity-50 disabled:scale-100 w-full sm:w-auto cursor-pointer"
                                >
                                    {isSubmittingRequest ? (
                                        <>
                                            <RefreshCw size={18} className="animate-spin" />
                                            <span>Submitting...</span>
                                        </>
                                    ) : (
                                        <>
                                            <Save size={18} />
                                            <span>{selectionMode === 'single' ? 'Submit Concession' : 'Submit Bulk Concession'}</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* BOTTOM: Raised Concessions by User History */}
                        <div className="w-full bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="p-3 sm:p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between px-4 sm:px-6">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                                        <History size={16} strokeWidth={3} />
                                    </div>
                                    <h3 className="font-extrabold text-gray-800 text-xs sm:text-sm uppercase tracking-wider">Your Raised Concessions History</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button 
                                        type="button" 
                                        onClick={() => handleHistoryPrint()} 
                                        className="text-xs text-gray-700 hover:text-gray-900 font-extrabold flex items-center gap-1.5 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-xs transition cursor-pointer"
                                        title="Print Raised Concessions History"
                                    >
                                        <Printer size={13} /> Print
                                    </button>
                                    <button 
                                        type="button" 
                                        onClick={() => fetchUserRequests()} 
                                        className="text-xs text-blue-600 hover:text-blue-800 font-extrabold flex items-center gap-1 bg-white border border-gray-200 px-3 py-1.5 rounded-lg shadow-xs transition"
                                    >
                                        <RefreshCw size={12} className={isUserRequestsLoading ? 'animate-spin' : ''} /> Refresh History
                                    </button>
                                </div>
                            </div>
                            
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-500 font-extrabold">
                                        <tr>
                                            <th className="py-3 px-6">Date</th>
                                            <th className="py-3 px-6">Voucher #</th>
                                            <th className="py-3 px-6">Student Detail</th>
                                            <th className="py-3 px-6">Course / Branch</th>
                                            <th className="py-3 px-6">Fee Component</th>
                                            <th className="py-3 px-6 text-right">Amount</th>
                                            <th className="py-3 px-6">Given By</th>
                                            <th className="py-3 px-6 text-center">Status</th>
                                            <th className="py-3 px-6 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-100">
                                        {isUserRequestsLoading ? (
                                            <tr>
                                                <td colSpan="9" className="py-16 text-center">
                                                    <div className="flex flex-col items-center justify-center gap-2">
                                                        <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                                        <p className="text-xs font-extrabold text-blue-600 uppercase tracking-widest animate-pulse">Loading History...</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : userRequests.length === 0 ? (
                                            <tr>
                                                <td colSpan="9" className="py-16 text-center text-xs font-bold text-gray-400 uppercase tracking-wider">
                                                    No concessions raised yet.
                                                </td>
                                            </tr>
                                        ) : (
                                            userRequests.map(req => (
                                                <tr key={req._id} className="hover:bg-gray-50/80 transition-all duration-200 text-xs">
                                                    <td className="py-3 px-6 font-bold text-gray-600">
                                                        {new Date(req.createdAt).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                                                    </td>
                                                    <td className="py-3 px-6">
                                                        <span className="font-mono text-[10px] font-black bg-gray-100 px-2 py-1 rounded border border-gray-200 text-gray-800">
                                                            #{req.voucherId || '---'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-6">
                                                        <div className="font-bold text-gray-800 italic">{req.studentName}</div>
                                                        <div className="text-[9px] text-gray-400 font-black uppercase tracking-widest">{req.studentPin || req.studentId}</div>
                                                    </td>
                                                    <td className="py-3 px-6">
                                                        <div className="text-[10px] font-extrabold text-blue-600 uppercase tracking-tight">{req.college || 'N/A'}</div>
                                                        <div className="font-bold text-gray-700">{req.course}</div>
                                                        <div className="text-[10px] text-gray-500 font-semibold">{req.branch} ({req.batch})</div>
                                                    </td>
                                                    <td className="py-3 px-6">
                                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{req.feeHead?.name}</span>
                                                    </td>
                                                    <td className="py-3 px-6 font-black text-gray-900 text-right">
                                                        ₹{req.amount.toLocaleString('en-IN')}
                                                    </td>
                                                    <td className="py-3 px-6 font-semibold text-gray-700">
                                                        {req.concessionGivenBy || 'Not Specified'}
                                                    </td>
                                                    <td className="py-3 px-6 text-center">
                                                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                                                            req.status === 'APPROVED' ? 'bg-green-50 text-green-700 border-green-200' :
                                                            req.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                                            'bg-amber-50 text-amber-700 border-amber-200'
                                                        }`}>
                                                            {req.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-6 text-center">
                                                        {req.status !== 'APPROVED' ? (
                                                            <div className="flex items-center justify-center gap-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleEditRequest(req)}
                                                                    className="p-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition border border-transparent hover:border-blue-200 inline-flex items-center justify-center cursor-pointer"
                                                                    title="Edit Concession Request"
                                                                >
                                                                    <Edit2 size={15} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDeleteRequest(req._id)}
                                                                    className="p-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition border border-transparent hover:border-red-200 inline-flex items-center justify-center cursor-pointer"
                                                                    title="Delete Concession Request"
                                                                >
                                                                    <Trash2 size={15} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-300 font-extrabold select-none" title="Approved requests cannot be edited/deleted here">—</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* Content Area - Approvals Tab */}
                {activeTab === 'approvals' && (
                    <div className="p-3 sm:p-6 flex flex-col max-w-[1700px] mx-auto w-full">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
                            {/* Filters Toolbar */}
                            <div className="p-2.5 sm:p-3 border-b border-gray-100 bg-gray-50/80 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Filter size={13} className="text-gray-400 shrink-0" />
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={filters.status}
                                            onChange={e => setFilters({ ...filters, status: e.target.value })}
                                        >
                                            <option value="PENDING">Pending Action</option>
                                            <option value="APPROVED">Approved Requests</option>
                                            <option value="REJECTED">Rejected Requests</option>
                                            <option value="ALL">All Statuses</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Landmark size={13} className="text-gray-400 shrink-0" />
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={filters.college}
                                            onChange={e => setFilters({ ...filters, college: e.target.value, course: '', branch: '' })}
                                        >
                                            <option value="">All Colleges</option>
                                            {collegeList.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={filters.course}
                                            onChange={e => setFilters({ ...filters, course: e.target.value, branch: '' })}
                                        >
                                            <option value="">All Courses</option>
                                            {courseList.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={filters.branch}
                                            onChange={e => setFilters({ ...filters, branch: e.target.value })}
                                        >
                                            <option value="">All Branches</option>
                                            {branchList.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={filters.batch}
                                            onChange={e => setFilters({ ...filters, batch: e.target.value })}
                                        >
                                            <option value="">All Batches</option>
                                            {batchList.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs focus-within:ring-2 focus-within:ring-blue-500 transition-all">
                                        <Search size={13} className="text-gray-400 shrink-0" />
                                        <input
                                            type="text"
                                            placeholder="Search students..."
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 outline-none w-32 sm:w-40"
                                            value={filters.search}
                                            onChange={e => setFilters({ ...filters, search: e.target.value })}
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={fetchPendingRequests}
                                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold bg-blue-600 text-white hover:bg-blue-700 transition shadow-xs active:scale-95 cursor-pointer whitespace-nowrap ml-auto"
                                >
                                    <Filter size={13} /> Filter Requests
                                </button>
                            </div>

                            {/* Table */}
                            <div className="flex-1 overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-500 font-extrabold sticky top-0 z-10">
                                        <tr>
                                            <th className="py-3.5 px-4 whitespace-nowrap">Requested Date</th>
                                            <th className="py-3.5 px-4 whitespace-nowrap">Voucher ID</th>
                                            <th className="py-3.5 px-4 min-w-[180px]">Student Information</th>
                                            <th className="py-3.5 px-4 whitespace-nowrap">College / Course / Branch</th>
                                            <th className="py-3.5 px-4 whitespace-nowrap">Fee Head</th>
                                            <th className="py-3.5 px-4 whitespace-nowrap">Raised By</th>
                                            <th className="py-3.5 px-4 text-right whitespace-nowrap">Requested Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-100">
                                        {pendingRequests.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" className="py-40 text-center">
                                                    <div className="flex flex-col items-center justify-center opacity-40">
                                                        <div className="bg-gray-100 p-6 rounded-full border-2 border-dashed border-gray-300 mb-4">
                                                            <Search size={40} className="text-gray-400" />
                                                        </div>
                                                        <h4 className="text-xl font-bold text-gray-800">No matching requests found</h4>
                                                        <p className="text-sm text-gray-500 mt-1">Try broadening your search or filters.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            pendingRequests.map(group => (
                                                <tr 
                                                    key={group.groupKey || group.requests[0]._id} 
                                                    onClick={() => openModal(group)}
                                                    className="hover:bg-blue-50/60 cursor-pointer transition-all border-b border-gray-100 last:border-0"
                                                >
                                                    <td className="py-3.5 px-4 whitespace-nowrap">
                                                        <span className="text-xs font-bold text-gray-500">{new Date(group.createdAt).toLocaleDateString()}</span>
                                                    </td>
                                                    <td className="py-3.5 px-4 whitespace-nowrap">
                                                        <div className="flex flex-col">
                                                            <span className="font-mono text-[10px] font-black bg-gray-100 px-2 py-1 rounded border border-gray-200 text-gray-800 w-fit">
                                                                #{group.voucherId || 'SINGLE'}
                                                            </span>
                                                            {group.requests.length > 1 && (
                                                                <span className="text-[9px] font-bold text-blue-600 mt-1 uppercase tracking-tighter">Bulk ({group.requests.length})</span>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3.5 px-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-bold text-gray-800">
                                                                {group.requests.length === 1 ? group.requests[0].studentName : `${group.requests[0].studentName} + ${group.requests.length - 1} more`}
                                                            </span>
                                                            <span className="text-[10px] text-gray-400 font-bold uppercase">{group.requests[0].studentPin || group.requests[0].studentId}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3.5 px-4 whitespace-nowrap">
                                                        <div className="flex flex-col">
                                                            <span className="text-[10px] font-extrabold text-blue-600 uppercase tracking-tight">{group.college || group.requests[0]?.college || 'N/A'}</span>
                                                            <span className="text-xs font-bold text-gray-700">{group.course}</span>
                                                            <span className="text-[10px] text-gray-400">{group.branch}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-3.5 px-4 whitespace-nowrap">
                                                        {group.feeHeads.length > 1 ? (
                                                            <span className="px-2.5 py-1 rounded bg-amber-50 text-amber-700 text-xs font-bold border border-amber-100 uppercase tracking-tight">
                                                                Mixed Heads ({group.feeHeads.length})
                                                            </span>
                                                        ) : (
                                                            <span className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 text-xs font-bold border border-indigo-100 uppercase tracking-tight">
                                                                {group.feeHeads[0]?.name || 'N/A'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-3.5 px-4 whitespace-nowrap">
                                                        <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded border border-gray-200 inline-block">
                                                            {group.requests[0]?.requestedBy || group.requestedBy || 'N/A'}
                                                        </span>
                                                    </td>
                                                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                                                        <div>
                                                            <span className="text-sm font-black text-gray-900">₹{group.totalAmount.toLocaleString('en-IN')}</span>
                                                            {group.requests.length > 1 && <div className="text-[10px] text-gray-400 font-bold">Total for {group.requests.length} students</div>}
                                                        </div>
                                                    </td>
                                                    <td className="hidden">
                                                            <button
                                                                onClick={() => openModal(group)}
                                                                className={`px-4 py-2 text-white text-xs font-bold rounded-lg transition shadow-sm active:scale-95 ${filters.status === 'APPROVED' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                                            >
                                                                {filters.status === 'APPROVED' ? 'Modify' : 'Review'}
                                                            </button>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* Content Area - Approvers Tab */}
                {activeTab === 'approvers' && (
                    <div className="p-3 sm:p-6 flex flex-col max-w-[1700px] mx-auto w-full animate-fade-in">
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6 flex-1 h-full">
                            {/* Left: Add Form (Sidebar style) */}
                            <div className="lg:col-span-1 space-y-6">
                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6 flex flex-col h-fit">
                                    <div className="mb-4 sm:mb-6">
                                        <h3 className="text-sm font-extrabold text-gray-800 uppercase tracking-wider mb-1">Add Authority</h3>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">Register new permission giver</p>
                                    </div>
                                    <form onSubmit={handleAddApprover} className="space-y-4">
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest block ml-1">Full Name</label>
                                            <input 
                                                type="text" 
                                                className="w-full border border-gray-200 p-2.5 rounded-lg text-sm font-bold text-gray-800 focus:ring-2 focus:ring-blue-500 outline-none transition bg-gray-50/50"
                                                value={newApprover.name}
                                                onChange={e => setNewApprover({...newApprover, name: e.target.value})}
                                                placeholder="e.g. Dr. Ramesh Babu"
                                                required
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest block ml-1">Designation</label>
                                            <select 
                                                className="w-full border border-gray-200 p-2.5 rounded-lg text-sm font-bold text-gray-800 bg-gray-50/50 outline-none focus:ring-2 focus:ring-blue-500 transition cursor-pointer"
                                                value={newApprover.designation}
                                                onChange={e => setNewApprover({...newApprover, designation: e.target.value})}
                                                required
                                            >
                                                <option value="">-- Choose Role --</option>
                                                <option value="Principal">Principal</option>
                                                <option value="Dean">Dean</option>
                                                <option value="Vice Principal">Vice Principal</option>
                                                <option value="Manager">Manager</option>
                                                <option value="Academic Director">Academic Director</option>
                                                <option value="Academic Coordinator">Academic Coordinator</option>
                                                <option value="Secretary">Secretary</option>
                                                <option value="Joint Secretary">Joint Secretary</option>
                                                <option value="Finance Officer">Chairman</option>
                                            </select>
                                        </div>
                                        <button 
                                            type="submit"
                                            disabled={isApproverLoading}
                                            className="w-full bg-blue-600 text-white font-extrabold py-3 rounded-lg hover:bg-blue-700 transition shadow-lg active:scale-95 disabled:opacity-50 disabled:scale-100 mt-2 flex items-center justify-center gap-2"
                                        >
                                            <Save size={16} /> Save Approver
                                        </button>
                                    </form>
                                </div>

                                {/* Allowed Fee Heads Configuration Card */}
                                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6 flex flex-col h-fit">
                                    <div className="mb-4 sm:mb-6">
                                        <h3 className="text-sm font-extrabold text-gray-800 uppercase tracking-wider mb-1">Allowed Fee Heads</h3>
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">Concession Component restrictions</p>
                                    </div>
                                    <div className="space-y-2 max-h-60 overflow-y-auto mb-4 border border-gray-100 rounded-lg p-2.5 bg-gray-50/30">
                                        {feeHeads.map(fh => {
                                            const isChecked = selectedAllowedHeads.includes(fh._id);
                                            return (
                                                <label key={fh._id} className="flex items-center gap-2.5 text-xs text-gray-700 font-bold cursor-pointer hover:bg-gray-50 p-1.5 rounded transition select-none">
                                                    <input 
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => {
                                                            if (isChecked) {
                                                                setSelectedAllowedHeads(prev => prev.filter(id => id !== fh._id));
                                                            } else {
                                                                setSelectedAllowedHeads(prev => [...prev, fh._id]);
                                                            }
                                                        }}
                                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                    />
                                                    <span>{fh.name}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <button 
                                        type="button"
                                        onClick={handleSaveAllowedFeeHeads}
                                        className="w-full bg-blue-600 text-white font-extrabold py-2.5 rounded-lg hover:bg-blue-700 transition shadow-md text-xs active:scale-95 flex items-center justify-center gap-1.5"
                                    >
                                        <Save size={14} /> Save Configuration
                                    </button>
                                </div>
                            </div>

                            {/* Center/Right: List */}
                            <div className="lg:col-span-3 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
                                <div className="p-3 sm:p-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center px-4 sm:px-6">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                                            <Users size={16} strokeWidth={3} />
                                        </div>
                                        <h3 className="font-extrabold text-gray-800 text-xs sm:text-sm uppercase tracking-wider">Authority Database</h3>
                                    </div>
                                    <span className="text-[10px] text-blue-700 font-extrabold bg-blue-100 px-3 py-1 rounded-full border border-blue-200 uppercase tracking-widest">{approvers.length} Records</span>
                                </div>
                                <div className="flex-1 overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-500 font-extrabold sticky top-0 z-10">
                                            <tr>
                                                <th className="py-4 px-6">Person Name</th>
                                                <th className="py-4 px-6">Official Role</th>
                                                <th className="py-4 px-6">Availability</th>
                                                <th className="py-4 px-6 text-right">Management Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-100">
                                            {approvers.map(a => (
                                                <tr key={a._id} className="hover:bg-gray-50/80 transition-all duration-200 group">
                                                    <td className="py-4 px-6 font-bold text-gray-800 text-sm flex items-center gap-2">
                                                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-[10px] text-gray-500 font-black uppercase">
                                                            {a.name.substring(0,2)}
                                                        </div>
                                                        {a.name}
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">{a.designation}</span>
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <div className="flex items-center gap-2">
                                                            <div className={`w-2 h-2 rounded-full ${a.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`}></div>
                                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${a.isActive ? 'bg-emerald-50 text-emerald-700':'bg-gray-100 text-gray-500'}`}>
                                                                {a.isActive ? 'Active' : 'Disabled'}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-6 text-right space-x-2">
                                                        <button 
                                                            onClick={() => toggleApprover(a._id)}
                                                            className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border transition-all ${a.isActive ? 'border-orange-200 text-orange-600 bg-orange-50/50 hover:bg-orange-100':'border-emerald-200 text-emerald-600 bg-emerald-50/50 hover:bg-emerald-100'}`}
                                                        >
                                                            {a.isActive ? 'Turn Off' : 'Turn On'}
                                                        </button>
                                                        <button 
                                                            onClick={() => deleteApprover(a._id)}
                                                            className="text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-red-200 text-red-600 bg-red-50/50 hover:bg-red-100 transition-all"
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {approvers.length === 0 && (
                                                <tr>
                                                    <td colSpan="4" className="py-40 text-center">
                                                        <div className="flex flex-col items-center justify-center opacity-40">
                                                            <div className="bg-gray-100 p-6 rounded-full border border-dashed border-gray-300 mb-4">
                                                                <Users size={40} className="text-gray-400" />
                                                            </div>
                                                            <h4 className="text-xl font-bold text-gray-800">No authorities defined</h4>
                                                            <p className="text-sm text-gray-500 mt-1">Add your first permission giver using the form on the left.</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                )}


                {/* Content Area - Reports Tab */}
                {activeTab === 'reports' && (
                    <div className="p-3 sm:p-6 flex flex-col max-w-[1700px] mx-auto w-full animate-fade-in">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col h-full">
                            {/* Toolbar (Filters) */}
                            <div className="p-2.5 sm:p-3 border-b border-gray-100 bg-gray-50/80 flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Calendar size={13} className="text-gray-400 shrink-0" />
                                        <input
                                            type="date"
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer w-22 sm:w-24 outline-none"
                                            value={reportFilters.startDate}
                                            onChange={e => setReportFilters({ ...reportFilters, startDate: e.target.value })}
                                        />
                                        <span className="text-gray-300 mx-0.5">-</span>
                                        <input
                                            type="date"
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer w-22 sm:w-24 outline-none"
                                            value={reportFilters.endDate}
                                            onChange={e => setReportFilters({ ...reportFilters, endDate: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Users size={13} className="text-gray-400 shrink-0" />
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.concessionGivenBy}
                                            onChange={e => setReportFilters({ ...reportFilters, concessionGivenBy: e.target.value })}
                                        >
                                            <option value="">All Approvers</option>
                                            {approvers.map(a => <option key={a._id} value={a.name}>{a.name}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Landmark size={13} className="text-gray-400 shrink-0" />
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.college}
                                            onChange={e => setReportFilters({ ...reportFilters, college: e.target.value, course: '', branch: '' })}
                                        >
                                            <option value="">All Colleges</option>
                                            {collegeList.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.course}
                                            onChange={e => setReportFilters({ ...reportFilters, course: e.target.value, branch: '' })}
                                        >
                                            <option value="">All Courses</option>
                                            {courseList.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.branch}
                                            onChange={e => setReportFilters({ ...reportFilters, branch: e.target.value })}
                                        >
                                            <option value="">All Branches</option>
                                            {branchList.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.batch}
                                            onChange={e => setReportFilters({ ...reportFilters, batch: e.target.value })}
                                        >
                                            <option value="">All Batches</option>
                                            {batchList.map(b => <option key={b} value={b}>{b}</option>)}
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-1.5 bg-white px-2.5 py-1.5 rounded-lg border border-gray-200 shadow-2xs">
                                        <Filter size={13} className="text-gray-400 shrink-0" />
                                        <select
                                            className="bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer outline-none"
                                            value={reportFilters.status}
                                            onChange={e => setReportFilters({ ...reportFilters, status: e.target.value })}
                                        >
                                            <option value="ALL">All Statuses</option>
                                            <option value="APPROVED">Approved Only</option>
                                            <option value="PENDING">Pending Only</option>
                                            <option value="REJECTED">Rejected Only</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 ml-auto">
                                    <button
                                        onClick={fetchReports}
                                        className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-gray-900 text-white hover:bg-black transition shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
                                    >
                                        <Filter size={13} /> Update Report
                                    </button>
                                    
                                    {reportData.length > 0 && (
                                        <button
                                            onClick={handlePrint}
                                            className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-extrabold bg-emerald-600 text-white hover:bg-emerald-700 transition shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
                                        >
                                            <Printer size={13} /> Print Advice
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Reports Table */}
                            <div className="flex-1 overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 border-b border-gray-200 text-[10px] uppercase tracking-widest text-gray-500 font-extrabold sticky top-0 z-10">
                                        <tr>
                                            <th className="py-4 px-6">Entry Date</th>
                                            <th className="py-4 px-6">Voucher #</th>
                                            <th className="py-4 px-6">Student Detail</th>
                                            <th className="py-4 px-6">Fee Component</th>
                                            <th className="py-4 px-6 text-right">Net Amount</th>
                                            <th className="py-4 px-6">Approving Authority</th>
                                            <th className="py-4 px-6 text-right">Final Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-100">
                                        {isReportLoading ? (
                                            <tr>
                                                <td colSpan="7" className="py-40 text-center">
                                                    <div className="flex flex-col items-center justify-center gap-4">
                                                        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                                        <p className="text-sm font-extrabold text-blue-600 uppercase tracking-widest animate-pulse">Syncing Audit Logs...</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : reportData.length === 0 ? (
                                            <tr>
                                                <td colSpan="7" className="py-40 text-center">
                                                    <div className="flex flex-col items-center justify-center opacity-40">
                                                        <div className="bg-gray-100 p-6 rounded-full border border-dashed border-gray-300 mb-4">
                                                            <Search size={40} className="text-gray-400" />
                                                        </div>
                                                        <h4 className="text-xl font-bold text-gray-800">No report data found</h4>
                                                        <p className="text-sm text-gray-500 mt-1">Adjust your date range or filters above.</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            reportData.map(req => (
                                                <tr key={req._id} className="hover:bg-gray-50/80 transition-all duration-200">
                                                    <td className="py-4 px-6 text-sm font-bold text-gray-600">{new Date(req.createdAt).toLocaleDateString()}</td>
                                                    <td className="py-4 px-6">
                                                        <span className="font-mono text-[10px] font-black bg-gray-100 px-2 py-1 rounded border border-gray-200 text-gray-800">
                                                            #{req.voucherId || '---'}
                                                        </span>
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <div className="font-bold text-gray-800 text-sm italic">{req.studentName}</div>
                                                        <div className="text-[10px] text-gray-400 font-black uppercase tracking-widest">{req.studentPin || req.studentId}</div>
                                                        <div className="text-[10px] text-blue-600 font-extrabold uppercase tracking-tight">{req.college || 'N/A'} - {req.course}</div>
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{req.feeHead?.name}</span>
                                                    </td>
                                                    <td className="py-4 px-6 text-sm font-black text-gray-900 text-right">
                                                        ₹{req.amount.toLocaleString('en-IN')}
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <div className="flex items-center gap-2">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-purple-400"></div>
                                                            <span className="text-xs font-bold text-purple-700">{req.concessionGivenBy || 'Not Specified'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-4 px-6 text-right">
                                                        <span className={`px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border border-gray-100 ${req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                            req.status === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' :
                                                                'bg-amber-50 text-amber-700 border-amber-200'
                                                            }`}>
                                                            {req.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                    {!isReportLoading && reportData.length > 0 && (
                                        <tfoot className="bg-gray-50/50 border-t-2 border-gray-200">
                                            <tr>
                                                <td colSpan="4" className="py-5 px-6 text-right font-black text-gray-500 text-[10px] uppercase tracking-[0.2em]">Grand Aggregate Totals</td>
                                                <td className="py-5 px-6 text-right">
                                                    <span className="text-xl font-black text-blue-900 bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 shadow-sm">
                                                        ₹{reportData.reduce((sum, item) => sum + item.amount, 0).toLocaleString('en-IN')}
                                                    </span>
                                                </td>
                                                <td colSpan="2" className="py-5 px-6"></td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    </div>
                )}


                {/* MODAL (Review Concession Request) */}
                {selectedRequest && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 z-50">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full p-4 sm:p-6 animate-fade-in flex flex-col max-h-[95vh] overflow-hidden">
                            {/* Modal Header */}
                            <div className="flex justify-between items-start mb-4 shrink-0 border-b pb-3">
                                <div>
                                    <h2 className="text-lg sm:text-xl font-black text-gray-800 tracking-tight">
                                        {selectedRequest.requests[0].status === 'APPROVED' 
                                            ? 'Modify Approved Concession' 
                                            : selectedRequest.requests.length > 1 
                                                ? 'Bulk Concession Review' 
                                                : 'Concession Request Review'}
                                    </h2>
                                    <p className="text-xs text-gray-500 font-medium mt-0.5">
                                        {selectedRequest.requests[0].status === 'APPROVED' 
                                            ? 'Adjust concession amounts for finalized request' 
                                            : selectedRequest.requests.length > 1 
                                                ? `Reviewing concession applications for ${selectedRequest.requests.length} students` 
                                                : 'Review student concession application and authorize credit'}
                                    </p>
                                </div>
                                <button onClick={closeModal} className="bg-gray-100 hover:bg-gray-200 p-2 rounded-full transition"><X size={16} className="text-gray-600" /></button>
                            </div>

                            {/* Modal Content - 2 Column Side by Side Layout */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden pr-1">
                                {/* LEFT COLUMN: Details & Inputs */}
                                <div className="lg:col-span-7 space-y-4 flex flex-col justify-between overflow-y-auto pr-1">
                                    <div className="space-y-3.5">
                                        {selectedRequest.requests.length === 1 ? (
                                            /* SINGLE REQUEST DISPLAY */
                                            <div className="bg-gradient-to-br from-blue-50/60 to-slate-50 border border-blue-100 rounded-2xl p-4 space-y-3 shadow-xs">
                                                <div className="flex flex-wrap justify-between items-start gap-2 border-b border-blue-100/60 pb-2.5">
                                                    <div>
                                                        <h3 className="text-base font-black text-gray-900">{selectedRequest.requests[0].studentName}</h3>
                                                        <p className="text-xs text-gray-500 font-mono font-bold mt-0.5">{selectedRequest.requests[0].studentPin || selectedRequest.requests[0].studentId}</p>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block">Voucher Number</span>
                                                        <span className="font-mono text-sm font-black text-blue-700 bg-white px-2.5 py-0.5 rounded-lg border border-blue-200 shadow-xs inline-block mt-0.5">
                                                            #{selectedRequest.voucherId || '---'}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                                                    <div className="bg-white p-2 rounded-xl border border-gray-200/80">
                                                        <span className="text-gray-400 font-bold block text-[9px] uppercase">College</span>
                                                        <span className="font-bold text-gray-800 truncate block">{selectedRequest.college || selectedRequest.requests[0].college || 'N/A'}</span>
                                                    </div>
                                                    <div className="bg-white p-2 rounded-xl border border-gray-200/80">
                                                        <span className="text-gray-400 font-bold block text-[9px] uppercase">Course & Branch</span>
                                                        <span className="font-bold text-gray-800 truncate block">{selectedRequest.course} - {selectedRequest.branch}</span>
                                                    </div>
                                                    <div className="bg-white p-2 rounded-xl border border-gray-200/80">
                                                        <span className="text-gray-400 font-bold block text-[9px] uppercase">Fee Component</span>
                                                        <span className="font-bold text-indigo-600 truncate block">
                                                            {selectedRequest.feeHead?.name || selectedRequest.requests[0]?.feeHead?.name || (typeof selectedRequest.feeHead === 'string' ? selectedRequest.feeHead : (typeof selectedRequest.requests[0]?.feeHead === 'string' ? selectedRequest.requests[0]?.feeHead : 'N/A'))}
                                                        </span>
                                                    </div>
                                                    <div className="bg-white p-2 rounded-xl border border-gray-200/80">
                                                        <span className="text-gray-400 font-bold block text-[9px] uppercase">Authorized By</span>
                                                        <span className="font-bold text-purple-700 truncate block">{selectedRequest.requests[0].concessionGivenBy || 'Not Specified'}</span>
                                                    </div>
                                                    <div className="bg-white p-2 rounded-xl border border-blue-200 col-span-2 flex items-center justify-between px-3">
                                                        <span className="text-gray-500 font-extrabold text-[9px] uppercase">Requested Amount</span>
                                                        <span className="text-lg font-black text-blue-700 font-sans">₹{selectedRequest.totalAmount.toLocaleString('en-IN')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            /* BULK REQUEST DISPLAY */
                                            <div className="bg-gray-50 p-3 sm:p-4 rounded-2xl border border-gray-200 space-y-3">
                                                <div className="flex justify-between items-center bg-white p-2.5 rounded-xl border border-gray-200 shadow-xs">
                                                    <div>
                                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest block">Voucher Number</span>
                                                        <span className="font-mono text-sm font-black text-blue-600">#{selectedRequest.voucherId}</span>
                                                    </div>
                                                    <div className="text-right">
                                                        <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest block">Fee Component</span>
                                                        <span className="font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-xs border border-indigo-100">
                                                            {selectedRequest.feeHead?.name || selectedRequest.requests[0]?.feeHead?.name || 'N/A'}
                                                        </span>
                                                    </div>
                                                </div>
                                                
                                                <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-xs max-h-40 overflow-y-auto">
                                                    <table className="w-full text-xs text-left">
                                                        <thead className="bg-gray-100 uppercase text-[9px] font-black tracking-wider text-gray-500 sticky top-0">
                                                            <tr>
                                                                <th className="p-2">Student / PIN</th>
                                                                <th className="p-2">Requested</th>
                                                                <th className="p-2 text-right">Approved Amount</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-gray-100">
                                                            {selectedRequest.requests.map(r => (
                                                                <tr key={r._id} className="hover:bg-gray-50">
                                                                    <td className="p-2">
                                                                        <div className="font-bold text-gray-800 text-xs">{r.studentName}</div>
                                                                        <div className="text-[9px] text-gray-400 font-mono font-bold uppercase">{r.studentPin || r.studentId}</div>
                                                                        <div className="text-[9px] text-blue-600 font-bold">{r.college || 'N/A'} - {r.course}</div>
                                                                    </td>
                                                                    <td className="p-2 font-black text-gray-700">₹{r.amount.toLocaleString('en-IN')}</td>
                                                                    <td className="p-2 text-right">
                                                                        <input
                                                                            type="number"
                                                                            className="w-20 border border-gray-300 p-1 rounded font-black text-blue-600 focus:ring-1 focus:ring-blue-500 outline-none text-right text-xs"
                                                                            value={bulkAmounts[r._id] || ''}
                                                                            onChange={e => setBulkAmounts({...bulkAmounts, [r._id]: e.target.value})}
                                                                        />
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}

                                        {/* Reason / Justification Box */}
                                        <div>
                                            <label className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest block mb-1">Reason / Justification</label>
                                            <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 p-2.5 rounded-xl italic">"{selectedRequest.reason}"</div>
                                        </div>

                                        {/* Approval Action Inputs */}
                                        {(isSuperAdmin || (user?.permissions || []).includes('concession_approvals')) && (
                                            <div className="pt-2 border-t space-y-2">
                                                {selectedRequest.requests.length === 1 && (
                                                    <div>
                                                        <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-widest mb-1">Approval Amount (₹)</label>
                                                        <input
                                                            type="number"
                                                            className="w-full border border-gray-300 p-2 rounded-xl font-black text-base text-gray-800 focus:ring-2 focus:ring-emerald-500 outline-none bg-white shadow-xs"
                                                            value={modalAmount}
                                                            onChange={e => setModalAmount(e.target.value)}
                                                        />
                                                    </div>
                                                )}
                                                <div>
                                                    <label className="block text-[10px] font-extrabold text-gray-500 uppercase tracking-widest mb-1">Rejection Remarks (Optional if approving)</label>
                                                    <textarea
                                                        className="w-full border border-gray-300 p-2 rounded-xl text-xs focus:ring-2 focus:ring-red-500 outline-none bg-white resize-none shadow-xs"
                                                        placeholder="Enter reason if rejecting request..."
                                                        value={rejectionReason}
                                                        onChange={e => setRejectionReason(e.target.value)}
                                                        rows={2}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="pt-3 border-t flex gap-3">
                                        {(isSuperAdmin || (user?.permissions || []).includes('concession_approvals')) ? (
                                            selectedRequest.requests[0].status === 'PENDING' ? (
                                                <>
                                                    <button
                                                        onClick={() => handleApprovalAction('APPROVE')}
                                                        className="flex-1 bg-emerald-600 text-white font-extrabold py-2.5 rounded-xl hover:bg-emerald-700 shadow-md transition flex justify-center items-center gap-2 active:scale-95 text-xs"
                                                        disabled={approvalLoading}
                                                    >
                                                        <Check size={16} /> Approve Concession
                                                    </button>
                                                    <button
                                                        onClick={() => handleApprovalAction('REJECT')}
                                                        className="flex-1 bg-white border border-red-200 text-red-600 font-extrabold py-2.5 rounded-xl hover:bg-red-50 transition active:scale-95 text-xs"
                                                        disabled={approvalLoading}
                                                    >
                                                        Reject Request
                                                    </button>
                                                </>
                                            ) : selectedRequest.requests[0].status === 'APPROVED' ? (
                                                <button
                                                    onClick={() => handleApprovalAction('APPROVE')}
                                                    className="w-full bg-indigo-600 text-white font-extrabold py-2.5 rounded-xl hover:bg-indigo-700 shadow-md transition flex justify-center items-center gap-2 active:scale-95 text-xs"
                                                    disabled={approvalLoading}
                                                >
                                                    {approvalLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Save size={16} />}
                                                    Update Approved Concession
                                                </button>
                                            ) : (
                                                <button onClick={closeModal} className="w-full bg-gray-100 text-gray-700 font-extrabold py-2.5 rounded-xl hover:bg-gray-200 text-xs">Close</button>
                                            )
                                        ) : (
                                            <button onClick={closeModal} className="w-full bg-gray-100 text-gray-700 font-extrabold py-2.5 rounded-xl hover:bg-gray-200 text-xs">Close</button>
                                        )}
                                    </div>
                                </div>

                                {/* RIGHT COLUMN: Proof Document / Image Preview */}
                                <div className="lg:col-span-5 bg-gray-50 rounded-2xl border border-gray-200 p-3.5 flex flex-col justify-between items-center min-h-[320px] max-h-[460px]">
                                    <div className="w-full flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-extrabold text-gray-500 uppercase tracking-widest">Proof Attachment</span>
                                        {selectedRequest.requests[0].imageUrl && (
                                            <button type="button"
                                                onClick={() => setProofImageModalUrl(selectedRequest.requests[0].imageUrl)} 


                                                className="text-xs font-extrabold text-blue-600 hover:underline flex items-center gap-1 cursor-pointer"
                                            >
                                                Full Screen ↗
                                            </button>
                                        )}
                                    </div>

                                    {selectedRequest.requests[0].imageUrl ? (
                                        selectedRequest.requests[0].imageUrl.toLowerCase().endsWith('.pdf') ? (
                                            <a 
                                                href={selectedRequest.requests[0].imageUrl} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                className="w-full h-full flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-blue-200 rounded-xl bg-blue-50/50 hover:bg-blue-100/50 transition group text-center"
                                            >
                                                <div className="bg-blue-600 text-white p-3 rounded-xl shadow-md"><Upload size={22} /></div>
                                                <div>
                                                    <div className="text-xs font-extrabold text-blue-900 group-hover:underline">Attached PDF Document</div>
                                                    <div className="text-[10px] text-blue-600 mt-1">Click to open PDF file in new browser tab</div>
                                                </div>
                                            </a>
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center relative group overflow-hidden">
                                                <img 
                                                    src={selectedRequest.requests[0].imageUrl} 
                                                    alt="Concession Proof Attachment" 
                                                    className="max-h-[380px] w-full object-contain rounded-xl border border-gray-200 shadow-sm bg-white cursor-pointer hover:scale-[1.01] transition-all"
                                                    onClick={() => setProofImageModalUrl(selectedRequest.requests[0].imageUrl)}
                                                />
                                                <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wider mt-2 text-center">Click image to expand full resolution</p>
                                            </div>
                                        )
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-400 p-6 text-center space-y-2 opacity-60">
                                            <div className="w-12 h-12 bg-gray-200/80 rounded-full flex items-center justify-center">
                                                <Upload className="w-6 h-6 text-gray-400" />
                                            </div>
                                            <p className="text-xs font-bold text-gray-500">No Proof Attachment</p>
                                            <p className="text-[10px] text-gray-400">No supporting image or document was uploaded for this request.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
                {/* SUCCESS MODAL */}
                {successModalData && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-100 transform transition-all scale-100">
                            {/* Top Green Accent Header */}
                            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 p-6 text-center text-white relative">
                                <button 
                                    onClick={() => setSuccessModalData(null)}
                                    className="absolute top-3 right-3 text-white/80 hover:text-white p-1.5 rounded-full hover:bg-white/10 transition"
                                >
                                    <X size={18} />
                                </button>
                                <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-md border border-white/30 shadow-inner">
                                    <CheckCircle2 className="w-10 h-10 text-white" />
                                </div>
                                <h3 className="text-xl font-extrabold tracking-tight">Request Submitted!</h3>
                                <p className="text-xs text-emerald-100 mt-1 font-medium">Concession application successfully created</p>
                            </div>

                            {/* Content Details */}
                            <div className="p-5 sm:p-6 space-y-4">
                                <div className="bg-emerald-50 border border-emerald-200/80 rounded-xl p-3.5 text-center">
                                    <span className="text-[10px] font-extrabold text-emerald-700 uppercase tracking-widest block mb-1">Voucher Number</span>
                                    <span className="text-2xl font-black text-emerald-900 font-mono tracking-wider">#{successModalData.voucherId}</span>
                                </div>

                                <div className="divide-y divide-gray-100 text-xs font-semibold text-gray-600">
                                    <div className="py-2.5 flex justify-between items-center">
                                        <span className="text-gray-400 font-medium uppercase text-[10px]">Application Type</span>
                                        <span className="font-extrabold text-gray-800 uppercase px-2 py-0.5 bg-gray-100 rounded border border-gray-200 text-[10px]">
                                            {successModalData.mode === 'single' ? 'Single Student' : `Bulk (${successModalData.count} Students)`}
                                        </span>
                                    </div>
                                    <div className="py-2.5 flex justify-between items-center">
                                        <span className="text-gray-400 font-medium uppercase text-[10px]">Target Student</span>
                                        <span className="font-extrabold text-gray-800 truncate max-w-[200px] text-right">{successModalData.studentName}</span>
                                    </div>
                                    <div className="py-2.5 flex justify-between items-center">
                                        <span className="text-gray-400 font-medium uppercase text-[10px]">Fee Component</span>
                                        <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{successModalData.feeHeadName}</span>
                                    </div>
                                    <div className="py-2.5 flex justify-between items-center">
                                        <span className="text-gray-400 font-medium uppercase text-[10px]">Concession Amount</span>
                                        <span className="font-black text-emerald-600 text-base">₹{Number(successModalData.amount).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>

                                <button
                                    onClick={() => setSuccessModalData(null)}
                                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-3 rounded-xl shadow-lg transition active:scale-95 text-sm flex items-center justify-center gap-2"
                                >
                                    <Check size={18} /> Done & Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Live Camera Capture Modal */}
                {isCameraModalOpen && (
                    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 z-50 animate-fade-in">
                        <div className="bg-slate-900 text-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-700 flex flex-col max-h-[90vh]">
                            <div className="p-3.5 sm:p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
                                <div className="flex items-center gap-2">
                                    <Camera className="text-blue-400 shrink-0" size={18} />
                                    <h3 className="font-extrabold text-xs sm:text-sm tracking-wide">Capture Proof Document</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={toggleCameraFacingMode}
                                        className="p-1.5 sm:p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition flex items-center gap-1.5 text-xs font-bold"
                                        title="Flip Camera (Front/Back)"
                                    >
                                        <FlipHorizontal size={15} />
                                        <span className="hidden sm:inline">{cameraFacingMode === 'environment' ? 'Rear Cam' : 'Front Cam'}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={closeCameraModal}
                                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>

                            <div className="relative bg-slate-950 flex-1 min-h-[320px] sm:min-h-[420px] flex items-center justify-center overflow-hidden p-2">
                                {isCameraLoading && (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900 text-slate-300 gap-3 z-10">
                                        <RefreshCw className="animate-spin text-blue-500" size={32} />
                                        <p className="text-xs font-semibold">Initializing 3:4 camera feed...</p>
                                    </div>
                                )}

                                {cameraError ? (
                                    <div className="p-6 text-center space-y-4 max-w-sm">
                                        <div className="w-12 h-12 bg-red-500/20 text-red-400 rounded-full flex items-center justify-center mx-auto">
                                            <Camera size={24} />
                                        </div>
                                        <p className="text-xs text-red-300 font-medium leading-relaxed">{cameraError}</p>
                                        <button
                                            type="button"
                                            onClick={() => startCamera(cameraFacingMode)}
                                            className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold px-4 py-2 rounded-xl border border-slate-600"
                                        >
                                            Retry Camera
                                        </button>
                                    </div>
                                ) : (
                                    <div className="relative aspect-[3/4] h-[300px] sm:h-[380px] rounded-xl overflow-hidden border-2 border-slate-700 shadow-2xl bg-black">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            muted
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute inset-3 border-2 border-dashed border-white/50 rounded-lg pointer-events-none flex flex-col justify-between p-2.5">
                                           
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-3.5 sm:p-4 bg-slate-950/90 border-t border-slate-800 flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={closeCameraModal}
                                    className="text-xs font-bold text-slate-400 hover:text-white px-4 py-2.5 rounded-xl hover:bg-slate-800 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCapturePhoto}
                                    disabled={isCameraLoading || !!cameraError}
                                    className="flex-1 max-w-[220px] bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-extrabold py-3 px-5 rounded-xl shadow-lg flex items-center justify-center gap-2 transition transform active:scale-95 disabled:opacity-50 text-xs sm:text-sm"
                                >
                                    <Camera size={18} /> Take Photo
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Staged Image Full Zoom Modal */}
                {isPreviewModalOpen && imagePreviewUrl && (
                    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 z-50 animate-fade-in">
                        <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden border border-gray-200 flex flex-col max-h-[90vh]">
                            <div className="p-3.5 sm:p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Image size={18} className="text-blue-600 shrink-0" />
                                    <h3 className="font-extrabold text-xs sm:text-sm text-gray-800 truncate">{imageFile?.name}</h3>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsPreviewModalOpen(false)}
                                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-lg transition"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="p-4 flex-1 overflow-auto flex items-center justify-center bg-gray-100 min-h-[250px]">
                                <img
                                    src={imagePreviewUrl}
                                    alt="Proof preview"
                                    className="max-h-[68vh] w-auto object-contain rounded-lg shadow-md"
                                />
                            </div>
                            <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                                <span className="font-medium text-gray-600">🔒 Staged locally — Will be uploaded to AWS S3 on submit</span>
                                <button
                                    type="button"
                                    onClick={() => setIsPreviewModalOpen(false)}
                                    className="bg-blue-600 text-white font-bold px-4 py-1.5 rounded-lg hover:bg-blue-700 transition"
                                >
                                    Close Preview
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Proof Image View Popup Modal */}
                {proofImageModalUrl && (
                    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 z-[60] animate-fade-in" onClick={() => { setProofImageModalUrl(null); setZoomScale(1); setRotationDeg(0); setImgPosition({ x: 0, y: 0 }); setIsDragging(false); }}>
                        <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden border border-gray-200 flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
                            <div className="p-3.5 sm:p-4 border-b border-gray-100 flex flex-wrap items-center justify-between bg-gray-50 gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Image size={18} className="text-blue-600 shrink-0" />
                                    <h3 className="font-extrabold text-xs sm:text-sm text-gray-800">Proof Attachment Viewer</h3>
                                </div>

                                {/* Zoom & Rotation Toolbar */}
                                <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shadow-xs">
                                    <button
                                        type="button"
                                        onClick={() => setZoomScale(prev => Math.max(Number((prev - 0.25).toFixed(2)), 0.5))}
                                        disabled={zoomScale <= 0.5}
                                        className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                                        title="Zoom Out (-)"
                                    >
                                        <ZoomOut size={16} />
                                    </button>
                                    <span className="text-xs font-black text-blue-700 min-w-[45px] text-center font-mono select-none px-1">
                                        {Math.round(zoomScale * 100)}%
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setZoomScale(prev => Math.min(Number((prev + 0.25).toFixed(2)), 4))}
                                        disabled={zoomScale >= 4}
                                        className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
                                        title="Zoom In (+)"
                                    >
                                        <ZoomIn size={16} />
                                    </button>
                                    <div className="w-[1px] h-4 bg-gray-200 mx-0.5"></div>
                                    <button
                                        type="button"
                                        onClick={() => setRotationDeg(prev => (prev + 90) % 360)}
                                        className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-700 transition cursor-pointer"
                                        title="Rotate 90°"
                                    >
                                        <RotateCw size={16} />
                                    </button>
                                    {(zoomScale !== 1 || rotationDeg !== 0 || imgPosition.x !== 0 || imgPosition.y !== 0) && (
                                        <button
                                            type="button"
                                            onClick={() => { setZoomScale(1); setRotationDeg(0); setImgPosition({ x: 0, y: 0 }); }}
                                            className="text-[10px] font-extrabold text-gray-600 hover:text-blue-600 px-2 py-1 hover:bg-gray-100 rounded-lg transition cursor-pointer"
                                        >
                                            Reset
                                        </button>
                                    )}
                                </div>

                                <button
                                    type="button"
                                    onClick={() => { setProofImageModalUrl(null); setZoomScale(1); setRotationDeg(0); setImgPosition({ x: 0, y: 0 }); setIsDragging(false); }}
                                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-200/60 rounded-lg transition cursor-pointer"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div 
                                className={`p-4 flex-1 overflow-hidden flex items-center justify-center bg-slate-950 min-h-[350px] relative select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                                onWheel={(e) => {
                                    if (e.deltaY < 0) {
                                        setZoomScale(prev => Math.min(Number((prev + 0.15).toFixed(2)), 4));
                                    } else {
                                        setZoomScale(prev => Math.max(Number((prev - 0.15).toFixed(2)), 0.5));
                                    }
                                }}
                                onMouseDown={(e) => {
                                    if (e.button !== 0) return;
                                    setIsDragging(true);
                                    setDragStart({ x: e.clientX - imgPosition.x, y: e.clientY - imgPosition.y });
                                }}
                                onMouseMove={(e) => {
                                    if (!isDragging) return;
                                    setImgPosition({
                                        x: e.clientX - dragStart.x,
                                        y: e.clientY - dragStart.y
                                    });
                                }}
                                onMouseUp={() => setIsDragging(false)}
                                onMouseLeave={() => setIsDragging(false)}
                            >
                                <div className="flex items-center justify-center min-w-full min-h-full">
                                    <img
                                        src={proofImageModalUrl}
                                        alt="Proof attachment full resolution"
                                        onDoubleClick={() => {
                                            if (zoomScale === 1 && imgPosition.x === 0 && imgPosition.y === 0) {
                                                setZoomScale(2);
                                            } else {
                                                setZoomScale(1);
                                                setImgPosition({ x: 0, y: 0 });
                                            }
                                        }}
                                        style={{ 
                                            transform: `translate(${imgPosition.x}px, ${imgPosition.y}px) scale(${zoomScale}) rotate(${rotationDeg}deg)`,
                                            transition: isDragging ? 'none' : 'transform 0.15s ease-out'
                                        }}
                                        className="max-h-[76vh] w-auto object-contain rounded-lg shadow-2xl origin-center"
                                        title="Double-click to quick zoom/reset, drag mouse to move up & down"
                                    />
                                </div>
                            </div>
                            <div className="p-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                                
                                <button
                                    type="button"
                                    onClick={() => { setProofImageModalUrl(null); setZoomScale(1); setRotationDeg(0); setImgPosition({ x: 0, y: 0 }); setIsDragging(false); }}
                                    className="bg-blue-600 text-white font-bold px-4 py-1.5 rounded-lg hover:bg-blue-700 transition cursor-pointer"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hidden Print Components */}
                <div style={{ display: 'none' }}>
                    <ConcessionReportPrint ref={reportPrintRef} data={reportData} filters={{ ...reportFilters, reportedBy: user?.name || user?.username || user?.displayName || 'Employee' }} />
                    <ConcessionReportPrint ref={historyPrintRef} data={userRequests} filters={{ startDate: 'All Time', endDate: 'Today', reportedBy: user?.name || user?.username || user?.displayName || 'Employee' }} />
                </div>
            </div>
        </div>
    );
};

export default ConcessionManagement;
