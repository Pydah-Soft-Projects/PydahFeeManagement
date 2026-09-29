import React, { useState, useEffect, useRef, useMemo } from 'react';
import api from '../lib/api';
import Sidebar from './Sidebar';
import { Edit2, Trash2, Key, UserX, UserCheck } from 'lucide-react';
import { useCampuses, getCollegeNamesForCampuses } from '../hooks/useCampuses';


const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [roles, setRoles] = useState([]);
    const [activeTab, setActiveTab] = useState('users'); // 'users' or 'roles'
    const [showRoleModal, setShowRoleModal] = useState(false);
    const [editingRoleId, setEditingRoleId] = useState(null);
    const [roleFormData, setRoleFormData] = useState({ name: '', description: '', permissions: [] });
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [colleges, setColleges] = useState([]);
    const [hierarchy, setHierarchy] = useState({});
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [editingUserId, setEditingUserId] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [campusFilter, setCampusFilter] = useState('All');
    const [collegeFilter, setCollegeFilter] = useState('All');
    const [roleFilter, setRoleFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All'); // New: 'All', 'Active', 'Inactive'
    const [viewPermissionsModal, setViewPermissionsModal] = useState({ show: false, user: null });

    const currentUser = JSON.parse(localStorage.getItem('user')) || {};
    const isSuperAdminUser = currentUser.role === 'superadmin' || currentUser.role === 'admin' || (currentUser.permissions || []).includes('/user-management');

    const [formData, setFormData] = useState({
        name: '',
        username: '',
        password: '',
        role: '',
        campuses: [],
        colleges: [],
        courses: [],
        permissions: [],
        employeeId: null,
        email: '',
        mobile: '',
        isActive: true
    });

    const { campuses: campusList } = useCampuses();

    const visibleColleges = useMemo(() => {
        if (!formData.campuses?.length) return [];
        const campusCollegeNames = getCollegeNamesForCampuses(campusList, formData.campuses);
        return colleges.filter((c) => campusCollegeNames.includes(c));
    }, [formData.campuses, campusList, colleges]);

    const availablePages = [
        { name: 'Dashboard', path: '/dashboard' },
        { name: 'Students', path: '/students' },
        { name: 'Fee Collection', path: '/fee-collection' },
        { name: 'Concessions (Declaration)', path: '/overall-concessions' },
        { name: 'Concessions (Application)', path: '/concessions' },
        { name: 'Bulk Fee Upload', path: '/bulk-fee-upload' },
        { name: 'Proceedings', path: '/proceedings' },
        { name: 'Reports & Analytics', path: '/reports' },
        { name: 'Due Reports', path: '/due-reports' },
        { name: 'Fee Configuration', path: '/fee-config' },
        { name: 'Payment Config', path: '/payment-config' },
        { name: 'Settings', path: '/settings' },
        { name: 'Reminder Config', path: '/reminders' },
        { name: 'Academic Calendar', path: '/academic-calendar' },
        { name: 'Caution Deposit', path: '/caution-deposit' },
        { name: 'User Management', path: '/user-management' },
        { name: 'Permissions', path: '/permissions' }
    ];

    const OVERALL_CONCESSION_SUBS = [
        'overall_concession_add',
        'overall_concession_view',
        'overall_concession_bulk',
        'overall_concession_requests_read',
        'overall_concession_requests_write',
    ];
    const OVERALL_CONCESSION_SUB_LABELS = {
        overall_concession_add: 'Add / Manage',
        overall_concession_view: 'View Overview',
        overall_concession_bulk: 'Bulk Load',
        overall_concession_requests_read: 'Requests (Read)',
        overall_concession_requests_write: 'Requests (Write)',
    };

    const PROCEEDINGS_SUBS = [
        'proceedings_view',
        'proceedings_edit',
        'proceedings_verify',
        'proceedings_approve',
    ];
    const PROCEEDINGS_SUB_LABELS = {
        proceedings_view: 'Create Proceedings',
        proceedings_edit: 'Edit Proceeding',
        proceedings_verify: 'Verify Proceeding',
        proceedings_approve: 'Approve Proceeding',
    };

    const handleEmployeeSearch = async (e) => {
        const query = e.target.value;
        if (query.trim().length >= 2) {
            setSearchLoading(true);
            try {
                const res = await api.get(`/employees/search?name=${query}`);
                setSearchResults(res.data);
            } catch (error) {
                console.error("Search failed", error);
            } finally {
                setSearchLoading(false);
            }
        } else {
            setSearchResults([]);
            setSearchLoading(false);
        }
    };

    const selectEmployee = (emp) => {
        setFormData({
            ...formData,
            name: emp.employee_name,
            username: emp.emp_no,
            employeeId: emp._id, // Store ID for backend linking
            password: '' // Clear password as it's not needed
        });
        setSearchResults([]);
    };

    const clearSelectedEmployee = () => {
        setFormData({
            ...formData,
            name: '',
            username: '',
            employeeId: null,
            password: ''
        });
    };

    useEffect(() => {
        fetchUsers();
        fetchRoles();
        fetchMetadata(); // [NEW]
    }, []);

    const fetchRoles = async () => {
        try {
            const res = await api.get(`/roles`);
            setRoles(res.data);
        } catch (error) {
            console.error('Error fetching roles:', error);
        }
    };

    const fetchMetadata = async () => {
        try {
            const response = await api.get(`/students/metadata`);
            if (response.data && response.data.hierarchy) {
                setColleges(Object.keys(response.data.hierarchy));
                setHierarchy(response.data.hierarchy);
            }
        } catch (error) { console.error('Error fetching metadata', error); }
    };

    const fetchUsers = async () => {
        try {
            const res = await api.get(`/users`);
            setUsers(res.data);
            setLoading(false);
        } catch (error) {
            console.error(error);
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'role') {
            const matchedRole = roles.find(r => r.name === value);
            setFormData(prev => ({
                ...prev,
                role: value,
                permissions: matchedRole ? matchedRole.permissions : prev.permissions
            }));
        } else {
            setFormData({ ...formData, [name]: value });
        }
    };

    const handleCampusToggle = (campusId) => {
        const numericId = Number(campusId);
        const currentCampuses = (formData.campuses || []).map(Number);
        const campus = campusList.find((c) => Number(c.id) === numericId);
        const campusCollegeNames = campus?.colleges?.map((c) => c.name) || [];

        let updatedCampuses;
        let updatedColleges = [...(formData.colleges || [])];
        let updatedCourses = [...(formData.courses || [])];

        if (currentCampuses.includes(numericId)) {
            updatedCampuses = currentCampuses.filter((id) => id !== numericId);
            updatedColleges = updatedColleges.filter((c) => !campusCollegeNames.includes(c));
            updatedCourses = updatedCourses.filter((c) => !campusCollegeNames.some((name) => c.startsWith(`${name}|`)));
        } else {
            updatedCampuses = [...currentCampuses, numericId];
        }

        setFormData({
            ...formData,
            campuses: updatedCampuses,
            colleges: updatedColleges,
            courses: updatedCourses,
        });
    };

    const handleCollegeToggle = (collegeName) => {
        const currentColleges = formData.colleges || [];
        const currentCourses = formData.courses || [];
        let updatedColleges;
        let updatedCourses = [...currentCourses];

        if (currentColleges.includes(collegeName)) {
            updatedColleges = currentColleges.filter(c => c !== collegeName);
            updatedCourses = currentCourses.filter(c => !c.startsWith(`${collegeName}|`));
        } else {
            updatedColleges = [...currentColleges, collegeName];
        }

        setFormData({
            ...formData,
            colleges: updatedColleges,
            courses: updatedCourses
        });
    };

    const handleCourseToggle = (collegeName, courseName) => {
        const courseKey = `${collegeName}|${courseName}`;
        const currentCourses = formData.courses || [];
        let updatedCourses;

        if (currentCourses.includes(courseKey)) {
            updatedCourses = currentCourses.filter(c => c !== courseKey);
        } else {
            updatedCourses = [...currentCourses, courseKey];
        }

        setFormData({
            ...formData,
            courses: updatedCourses
        });
    };

    const handleSelectAllCourses = (collegeName) => {
        const coursesOfCollege = Object.keys(hierarchy[collegeName] || {});
        const currentCourses = formData.courses || [];
        const otherCourses = currentCourses.filter(c => !c.startsWith(`${collegeName}|`));
        const newCourses = coursesOfCollege.map(c => `${collegeName}|${c}`);
        setFormData({
            ...formData,
            courses: [...otherCourses, ...newCourses]
        });
    };

    const handleClearAllCourses = (collegeName) => {
        const currentCourses = formData.courses || [];
        const updatedCourses = currentCourses.filter(c => !c.startsWith(`${collegeName}|`));
        setFormData({
            ...formData,
            courses: updatedCourses
        });
    };

    const prevRoleRef = useRef(formData.role);

    // Effect to handle default permissions based on role
    useEffect(() => {
        const cashierPermissions = ['/fee-collection', 'fee_collection_pay'];

        if (formData.role === 'cashier') {
            let currentPermissions = [...(formData.permissions || [])];
            let changed = false;

            cashierPermissions.forEach(p => {
                if (!currentPermissions.includes(p)) {
                    currentPermissions.push(p);
                    changed = true;
                }
            });

            if (changed) {
                setFormData(prev => ({ ...prev, permissions: currentPermissions }));
            }
        } else if (prevRoleRef.current === 'cashier' && formData.role !== 'cashier') {
            // Transitioning away from cashier - clean up auto-added permissions
            let currentPermissions = [...(formData.permissions || [])];
            const updatedPermissions = currentPermissions.filter(p => !cashierPermissions.includes(p));

            if (updatedPermissions.length !== currentPermissions.length) {
                setFormData(prev => ({ ...prev, permissions: updatedPermissions }));
            }
        }
        prevRoleRef.current = formData.role;
    }, [formData.role]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage('');
        if (!formData.role) {
            setMessage('Please select a role');
            return;
        }
        setIsSubmitting(true);
        try {
            if (editingUserId) {
                const res = await api.put(`/users/${editingUserId}`, formData);
                setUsers(users.map(u => u._id === editingUserId ? res.data : u));
                setMessage('User updated successfully!');
                setEditingUserId(null);
            } else {
                const res = await api.post(`/users`, formData);
                setUsers([res.data, ...users]);
                setMessage('User created successfully!');
            }
            setFormData({ name: '', username: '', password: '', role: '', campuses: [], colleges: [], courses: [], permissions: [], employeeId: null, email: '', mobile: '', isActive: true });
            setShowCreateEditModal(false);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage(error.response?.data?.message || 'Error saving user');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEdit = (user) => {
        setFormData({
            name: user.name,
            username: user.username,
            password: '',
            role: user.role,
            college: user.college || '',
            campuses: user.campuses || [],
            colleges: user.colleges || [],
            courses: user.courses || [],
            employeeId: user.employeeId || null,
            permissions: user.permissions || [],
            email: user.email || '',
            mobile: user.mobile || '',
            isActive: user.isActive !== undefined ? user.isActive : true
        });
        setEditingUserId(user._id);
        setShowCreateEditModal(true);
    };

    const handleCancelEdit = () => {
        setFormData({ name: '', username: '', password: '', role: '', campuses: [], colleges: [], courses: [], employeeId: null, permissions: [], email: '', mobile: '', isActive: true });
        setEditingUserId(null);
        setShowCreateEditModal(false);
    };

    const openCreateModal = () => {
        setFormData({ name: '', username: '', password: '', role: '', campuses: [], colleges: [], courses: [], permissions: [], employeeId: null, email: '', mobile: '', isActive: true });
        setEditingUserId(null);
        setShowCreateEditModal(true);
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this user?')) return;
        try {
            await api.delete(`/users/${id}`);
            setUsers(users.filter(u => u._id !== id));
            if (editingUserId === id) handleCancelEdit();
        } catch (error) {
            alert('Failed to delete user');
        }
    };

    const handleRolePermissionToggle = (path) => {
        let currentPermissions = roleFormData.permissions || [];
        if (currentPermissions.includes(path)) {
            currentPermissions = currentPermissions.filter(p => p !== path);
            if (path === '/fee-collection') {
                currentPermissions = currentPermissions.filter(p => p !== 'fee_collection_pay' && p !== 'fee_collection_concession' && p !== 'fee_collection_edit');
            }
            if (path === '/reports') {
                currentPermissions = currentPermissions.filter(p => p !== 'reports_daily_collection' && p !== 'reports_cashier_summary' && p !== 'reports_fee_head_summary' && p !== 'reports_account_wise');
            }
            if (path === '/proceedings') {
                currentPermissions = currentPermissions.filter(p => p !== 'proceedings_approve' && p !== 'proceedings_verify' && p !== 'proceedings_edit' && p !== 'proceedings_view');
            }
            if (path === '/overall-concessions') {
                currentPermissions = currentPermissions.filter(p => !OVERALL_CONCESSION_SUBS.includes(p) && p !== 'overall_concession_requests');
            }
        } else {
            currentPermissions = [...currentPermissions, path];
            if (path === '/fee-collection') {
                if (!currentPermissions.includes('fee_collection_pay')) currentPermissions.push('fee_collection_pay');
                if (!currentPermissions.includes('fee_collection_concession')) currentPermissions.push('fee_collection_concession');
            }
            if (path === '/reports') {
                if (!currentPermissions.includes('reports_daily_collection')) currentPermissions.push('reports_daily_collection');
                if (!currentPermissions.includes('reports_cashier_summary')) currentPermissions.push('reports_cashier_summary');
                if (!currentPermissions.includes('reports_fee_head_summary')) currentPermissions.push('reports_fee_head_summary');
                if (!currentPermissions.includes('reports_account_wise')) currentPermissions.push('reports_account_wise');
            }
            if (path === '/concessions') {
                if (!currentPermissions.includes('concession_approvals')) currentPermissions.push('concession_approvals');
                if (!currentPermissions.includes('concession_approvers')) currentPermissions.push('concession_approvers');
            }
            if (path === '/proceedings') {
                if (!currentPermissions.includes('proceedings_view')) currentPermissions.push('proceedings_view');
            }
            if (path === '/overall-concessions') {
                if (!currentPermissions.includes('overall_concession_view')) currentPermissions.push('overall_concession_view');
            }
        }
        setRoleFormData(prev => ({ ...prev, permissions: currentPermissions }));
    };

    const handleRoleSubPermissionToggle = (permission) => {
        let currentPermissions = roleFormData.permissions || [];
        const hasWriteLegacy = currentPermissions.includes('overall_concession_requests');
        const has = currentPermissions.includes(permission)
            || (permission === 'overall_concession_requests_write' && hasWriteLegacy);

        if (has) {
            currentPermissions = currentPermissions.filter(p => p !== permission);
            if (permission === 'overall_concession_requests_write') {
                currentPermissions = currentPermissions.filter(p => p !== 'overall_concession_requests');
            }
            if (permission === 'overall_concession_requests_read') {
                currentPermissions = currentPermissions.filter(p =>
                    p !== 'overall_concession_requests_write' && p !== 'overall_concession_requests'
                );
            }
        } else {
            currentPermissions = [...currentPermissions, permission];
            if (permission === 'overall_concession_requests_write'
                && !currentPermissions.includes('overall_concession_requests_read')) {
                currentPermissions.push('overall_concession_requests_read');
            }
            currentPermissions = currentPermissions.filter(p => p !== 'overall_concession_requests');
        }
        setRoleFormData(prev => ({ ...prev, permissions: currentPermissions }));
    };

    const handleSaveRole = async (e) => {
        e.preventDefault();
        setMessage('');
        setIsSubmitting(true);
        try {
            if (editingRoleId) {
                const res = await api.put(`/roles/${editingRoleId}`, roleFormData);
                setRoles(roles.map(r => r._id === editingRoleId ? res.data : r));
                setMessage('Role updated successfully!');
                setEditingRoleId(null);
            } else {
                const res = await api.post(`/roles`, roleFormData);
                setRoles([...roles, res.data]);
                setMessage('Role created successfully!');
            }
            setRoleFormData({ name: '', description: '', permissions: [] });
            setShowRoleModal(false);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            setMessage(error.response?.data?.message || 'Error saving role');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEditRole = (role) => {
        setRoleFormData({
            name: role.name,
            description: role.description || '',
            permissions: role.permissions || []
        });
        setEditingRoleId(role._id);
        setShowRoleModal(true);
    };

    const handleDeleteRole = async (id) => {
        const role = roles.find(r => r._id === id);
        if (!role) return;
        if (['superadmin', 'admin', 'office_staff', 'cashier'].includes(role.name)) {
            alert(`System default role '${role.name}' cannot be deleted.`);
            return;
        }
        if (!window.confirm(`Are you sure you want to delete custom role '${role.name}'?`)) return;
        try {
            await api.delete(`/roles/${id}`);
            setRoles(roles.filter(r => r._id !== id));
            setMessage('Role deleted successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            alert(error.response?.data?.message || 'Failed to delete role');
        }
    };

    const openRoleCreateModal = () => {
        setRoleFormData({ name: '', description: '', permissions: [] });
        setEditingRoleId(null);
        setShowRoleModal(true);
    };

    // Password Reset Modal State
    const [resetModal, setResetModal] = useState({ show: false, user: null, newPassword: '' });
    // Create/Edit User Modal State
    const [showCreateEditModal, setShowCreateEditModal] = useState(false);
    // Deactivate User Modal State
    const [deactivateModal, setDeactivateModal] = useState({ show: false, user: null });

    const openResetModal = (user) => {
        const currentUser = JSON.parse(localStorage.getItem('user'));
        if (user.employeeId && currentUser?.role !== 'superadmin') {
            alert("Cannot reset password for Employee-linked users. They must use their Employee DB credentials.");
            return;
        }
        setResetModal({ show: true, user: user, newPassword: '' });
    };

    const closeResetModal = () => {
        setResetModal({ show: false, user: null, newPassword: '' });
    };

    const openDeactivateModal = (user) => {
        setDeactivateModal({ show: true, user });
    };

    const closeDeactivateModal = () => {
        setDeactivateModal({ show: false, user: null });
    };

    const handleDeactivateUser = async () => {
        if (!deactivateModal.user) return;
        try {
            await api.put(`/users/${deactivateModal.user._id}`, { isActive: false });
            setUsers(users.map(u => u._id === deactivateModal.user._id ? { ...u, isActive: false } : u));
            setMessage('User deactivated successfully!');
            closeDeactivateModal();
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            alert('Failed to deactivate user');
            console.error(error);
        }
    };

    const handleReactivateUser = async (userId) => {
        try {
            await api.put(`/users/${userId}`, { isActive: true });
            setUsers(users.map(u => u._id === userId ? { ...u, isActive: true } : u));
            setMessage('User reactivated successfully!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            alert('Failed to reactivate user');
            console.error(error);
        }
    };

    const openViewPermissionsModal = (user) => {
        console.log('Opening permissions modal for user:', user);
        console.log('User permissions:', user.permissions);
        setViewPermissionsModal({ show: true, user });
    };

    const closeViewPermissionsModal = () => {
        setViewPermissionsModal({ show: false, user: null });
    };

    const handleSavePassword = async (e) => {
        e.preventDefault();
        try {
            await api.put(`/users/${resetModal.user._id}`, { password: resetModal.newPassword });
            alert('Password updated successfully!');
            closeResetModal();
        } catch (error) {
            console.error(error);
            alert('Failed to reset password.');
        }
    };

    return (
        <div className="flex min-h-screen bg-gray-50 font-sans">
            <Sidebar />
            <div className="flex-1 min-w-0 p-4 md:p-6">
                <header className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">User Management</h1>
                        <p className="text-sm text-gray-500 mt-1">Create and manage access for system users.</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                        <div className="relative w-full md:w-72">
                            <input
                                type="text"
                                placeholder="Search users (name, username)..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-gray-200 rounded-xl shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all font-semibold"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                            </div>
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm font-black"
                                >
                                    ×
                                </button>
                            )}
                        </div>
                        <div className="flex border border-gray-200 bg-white p-1 rounded-xl shadow-sm gap-1 w-full sm:w-auto">
                            <button
                                onClick={() => setActiveTab('users')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${activeTab === 'users' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-150'}`}
                            >
                                Users
                            </button>
                            <button
                                onClick={() => setActiveTab('roles')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${activeTab === 'roles' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-150'}`}
                            >
                                Roles
                            </button>
                        </div>
                    </div>
                </header>

                <div className="space-y-4">
                    {/* User List */}
                    {activeTab === 'users' && (
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 transition-all duration-500 ease-in-out">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b border-gray-100 pb-3">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                    <h2 className="font-bold text-gray-800 whitespace-nowrap">Existing Users</h2>
                                    <div className="flex flex-wrap gap-2">
                                        {/* Status Filter */}
                                        <select
                                            value={statusFilter}
                                            onChange={(e) => setStatusFilter(e.target.value)}
                                            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 text-slate-700 font-bold"
                                        >
                                            <option value="All">All Status</option>
                                            <option value="Active">Active</option>
                                            <option value="Inactive">Inactive</option>
                                        </select>

                                        {/* Campus Filter */}
                                        <select
                                            value={campusFilter}
                                            onChange={(e) => setCampusFilter(e.target.value)}
                                            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 text-slate-700 font-bold"
                                        >
                                            <option value="All">All Campuses</option>
                                            {campusList.map(c => (
                                                <option key={c.id} value={c.id}>{c.name}</option>
                                            ))}
                                        </select>

                                        {/* College Filter */}
                                        <select
                                            value={collegeFilter}
                                            onChange={(e) => setCollegeFilter(e.target.value)}
                                            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 text-slate-700 font-bold max-w-[260px]"
                                        >
                                            <option value="All">All Colleges</option>
                                            {colleges.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>

                                        {/* Role Filter */}
                                        <select
                                            value={roleFilter}
                                            onChange={(e) => setRoleFilter(e.target.value)}
                                            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-100 text-slate-700 font-bold capitalize"
                                        >
                                            <option value="All">All Roles</option>
                                            {roles.map(r => (
                                                <option key={r._id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>
                                            ))}
                                            {roles.length === 0 && (
                                                <>
                                                    <option value="superadmin">Super Admin</option>
                                                    <option value="admin">Admin</option>
                                                    <option value="office_staff">Office Staff</option>
                                                    <option value="cashier">Cashier</option>
                                                </>
                                            )}
                                        </select>
                                    </div>
                                </div>
                                {isSuperAdminUser && (
                                    <button
                                        onClick={openCreateModal}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition text-xs whitespace-nowrap self-start md:self-auto"
                                    >
                                        Create New User
                                    </button>
                                )}
                            </div>

                            {loading ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-50 border-b border-gray-200">
                                            <tr>
                                                <th className="p-3 font-semibold text-gray-600">Name</th>
                                                <th className="p-3 font-semibold text-gray-600">Username</th>
                                                <th className="p-3 font-semibold text-gray-600">Role</th>
                                                <th className="p-3 font-semibold text-gray-600">Email</th>
                                                <th className="p-3 font-semibold text-gray-600">Mobile</th>
                                                <th className="p-3 font-semibold text-gray-600">Status</th>
                                                <th className="p-3 font-semibold text-gray-600">College Scope</th>
                                                {isSuperAdminUser && <th className="p-3 font-semibold text-right">Action</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {[1, 2, 3, 4, 5].map((idx) => (
                                                <tr key={idx} className="animate-pulse">
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-28"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-20"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-32"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-24"></div></td>
                                                    <td className="p-3"><div className="h-5 bg-gray-200 rounded-full w-14"></div></td>
                                                    <td className="p-3"><div className="h-4 bg-gray-200 rounded w-36"></div></td>
                                                    {isSuperAdminUser && (
                                                        <td className="p-3 text-right">
                                                            <div className="h-7 bg-gray-200 rounded w-20 ml-auto"></div>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-50 border-b">
                                            <tr>
                                                <th className="p-3 font-semibold text-gray-600">Name</th>
                                                <th className="p-3 font-semibold text-gray-600">Username</th>
                                                <th className="p-3 font-semibold text-gray-600">Role</th>
                                                <th className="p-3 font-semibold text-gray-600">Email</th>
                                                <th className="p-3 font-semibold text-gray-600">Mobile</th>
                                                <th className="p-3 font-semibold text-gray-600">Status</th>
                                                <th className="p-3 font-semibold text-gray-600">College Scope</th>
                                                {isSuperAdminUser && <th className="p-3 font-semibold text-right">Action</th>}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {users
                                                .filter(user => {
                                                    // Search Term Filter
                                                    if (searchTerm.trim()) {
                                                        const term = searchTerm.toLowerCase().trim();
                                                        const nameMatch = (user.name || '').toLowerCase().includes(term);
                                                        const usernameMatch = (user.username || '').toLowerCase().includes(term);
                                                        if (!nameMatch && !usernameMatch) return false;
                                                    }

                                                    // Status Filter
                                                    if (statusFilter !== 'All') {
                                                        const isUserActive = user.isActive !== false && !(user.employeeId && user.hrmsActive === false);
                                                        if (statusFilter === 'Active' && !isUserActive) return false;
                                                        if (statusFilter === 'Inactive' && isUserActive) return false;
                                                    }

                                                    // Campus Filter
                                                    if (campusFilter !== 'All') {
                                                        const numericCampusId = Number(campusFilter);
                                                        const userCampuses = (user.campuses || []).map(Number);
                                                        if (!userCampuses.includes(numericCampusId)) return false;
                                                    }

                                                    // College Filter
                                                    if (collegeFilter !== 'All') {
                                                        const userColleges = user.colleges || [];
                                                        if (!userColleges.includes(collegeFilter)) return false;
                                                    }

                                                    // Role Filter
                                                    if (roleFilter !== 'All') {
                                                        if (user.role !== roleFilter) return false;
                                                    }

                                                    // Display both active and inactive users
                                                    return true;
                                                })
                                                .map(user => (
                                                <tr key={user._id} className="hover:bg-gray-50">
                                                    <td className="p-3 font-medium text-gray-900">
                                                        <button
                                                            onClick={() => openViewPermissionsModal(user)}
                                                            className="text-blue-600 hover:text-blue-800 hover:underline font-bold cursor-pointer"
                                                            title="Click to view permissions"
                                                        >
                                                            {user.name}
                                                        </button>
                                                    </td>
                                                    <td className="p-3 text-gray-500 font-mono">{user.username}</td>
                                                    <td className="p-3">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${user.role === 'superadmin' ? 'bg-purple-100 text-purple-700' :
                                                            user.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                                                                 user.role === 'cashier' ? 'bg-green-100 text-green-700' :
                                                                     'bg-gray-100 text-gray-700'
                                                             }`}>
                                                             {user.role}
                                                         </span>
                                                    </td>
                                                    <td className="p-3 text-gray-500 text-xs">{user.email || '—'}</td>
                                                    <td className="p-3 text-gray-500 text-xs">{user.mobile || '—'}</td>
                                                    <td className="p-3">
                                                        {user.isActive === false ? (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200">
                                                                Deactivated (Manual)
                                                            </span>
                                                        ) : user.employeeId && user.hrmsActive === false ? (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200" title="Deactivated in external HRMS database">
                                                                Deactivated (HRMS)
                                                            </span>
                                                        ) : (
                                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">
                                                                Active
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-gray-500">
                                                        {user.campuses && user.campuses.length > 0 && (
                                                            <div className="text-[10px] text-indigo-600 font-bold mb-1">
                                                                Campuses: {user.campuses.map((id) => campusList.find((c) => c.id === id)?.code || id).join(', ')}
                                                            </div>
                                                        )}
                                                        {user.colleges && user.colleges.length > 0 ? (
                                                            <div className="space-y-1">
                                                                <div className="font-semibold text-xs text-gray-700">
                                                                     {user.colleges.join(', ')}
                                                                </div>
                                                                {user.courses && user.courses.length > 0 && (
                                                                    <div className="text-[10px] text-gray-400 max-w-xs truncate" title={user.courses.map(c => c.split('|')[1]).join(', ')}>
                                                                        Courses: {user.courses.map(c => c.split('|')[1]).join(', ')}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            user.college || 'All Colleges'
                                                        )}
                                                    </td>
                                                    {isSuperAdminUser && (
                                                        <td className="p-3 text-right whitespace-nowrap">
                                                            <button
                                                                onClick={() => handleEdit(user)}
                                                                className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded mr-1.5 transition shadow-sm"
                                                                title="Edit User"
                                                            >
                                                                <Edit2 size={14} className="stroke-[2.5]" />
                                                            </button>
                                                            {(!user.employeeId || currentUser?.role === 'superadmin') && (
                                                                <button
                                                                    onClick={() => openResetModal(user)}
                                                                    className="inline-flex items-center justify-center text-yellow-600 hover:text-yellow-800 bg-yellow-50 hover:bg-yellow-100 p-1.5 rounded mr-1.5 transition shadow-sm"
                                                                    title="Reset Password"
                                                                >
                                                                    <Key size={14} className="stroke-[2.5]" />
                                                                </button>
                                                            )}
                                                            {user.isActive !== false && !(user.employeeId && user.hrmsActive === false) ? (
                                                                <button
                                                                    onClick={() => openDeactivateModal(user)}
                                                                    className="inline-flex items-center justify-center text-orange-600 hover:text-orange-800 bg-orange-50 hover:bg-orange-100 p-1.5 rounded mr-1.5 transition shadow-sm"
                                                                    title="Deactivate User"
                                                                >
                                                                    <UserX size={14} className="stroke-[2.5]" />
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleReactivateUser(user._id)}
                                                                    className="inline-flex items-center justify-center text-green-600 hover:text-green-800 bg-green-50 hover:bg-green-100 p-1.5 rounded mr-1.5 transition shadow-sm"
                                                                    title="Reactivate User"
                                                                >
                                                                    <UserCheck size={14} className="stroke-[2.5]" />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleDelete(user._id)}
                                                                className="inline-flex items-center justify-center text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded transition shadow-sm"
                                                                title="Delete User"
                                                            >
                                                                <Trash2 size={14} className="stroke-[2.5]" />
                                                            </button>
                                                        </td>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {users.filter(user => {
                                        if (!searchTerm.trim()) return true;
                                        const term = searchTerm.toLowerCase().trim();
                                        const nameMatch = (user.name || '').toLowerCase().includes(term);
                                        const usernameMatch = (user.username || '').toLowerCase().includes(term);
                                        return nameMatch || usernameMatch;
                                    }).length === 0 && (
                                        <p className="text-center py-6 text-gray-400 italic">No matching users found.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Role List */}
                    {activeTab === 'roles' && (
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-200 transition-all duration-500 ease-in-out">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b border-gray-100 pb-3">
                                <div>
                                    <h2 className="font-bold text-gray-800">Existing Roles</h2>
                                    <p className="text-xs text-gray-400">Default and custom system access roles.</p>
                                </div>
                                {isSuperAdminUser && (
                                    <button
                                        onClick={openRoleCreateModal}
                                        className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition text-xs whitespace-nowrap"
                                    >
                                        Create New Role
                                    </button>
                                )}
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50 border-b">
                                        <tr>
                                            <th className="p-3 font-semibold text-gray-600">Role Name</th>
                                            <th className="p-3 font-semibold text-gray-600">Description</th>
                                            <th className="p-3 font-semibold text-gray-600">Permissions Count</th>
                                            {isSuperAdminUser && <th className="p-3 font-semibold text-right">Action</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {roles.map(role => (
                                            <tr key={role._id} className="hover:bg-gray-50">
                                                <td className="p-3 font-medium text-gray-900 capitalize">
                                                    <button
                                                        onClick={() => openViewPermissionsModal(role)}
                                                        className="text-blue-600 hover:text-blue-800 hover:underline font-bold cursor-pointer"
                                                        title="Click to view permissions"
                                                    >
                                                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                                            role.name === 'superadmin' ? 'bg-purple-100 text-purple-700' :
                                                            role.name === 'admin' ? 'bg-blue-100 text-blue-700' :
                                                            role.name === 'office_staff' ? 'bg-indigo-100 text-indigo-700' :
                                                            role.name === 'cashier' ? 'bg-green-100 text-green-700' :
                                                            'bg-gray-100 text-gray-700'
                                                        }`}>
                                                            {role.name}
                                                        </span>
                                                    </button>
                                                </td>
                                                <td className="p-3 text-gray-500 text-[11px]">{role.description || 'No description provided'}</td>
                                                <td className="p-3 text-gray-500 text-[11px]">
                                                    <span className="bg-slate-100 px-2 py-0.5 rounded-full font-bold text-slate-700 text-[10px]">
                                                        {role.permissions?.length || 0} permissions
                                                    </span>
                                                </td>
                                                {isSuperAdminUser && (
                                                    <td className="p-3 text-right whitespace-nowrap">
                                                        <button
                                                            onClick={() => handleEditRole(role)}
                                                            className="inline-flex items-center justify-center text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 p-1.5 rounded mr-1.5 transition shadow-sm"
                                                            title="Edit Role"
                                                            disabled={role.name === 'superadmin'}
                                                            style={{ opacity: role.name === 'superadmin' ? 0.4 : 1 }}
                                                        >
                                                            <Edit2 size={14} className="stroke-[2.5]" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteRole(role._id)}
                                                            className="inline-flex items-center justify-center text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 p-1.5 rounded transition shadow-sm"
                                                            title="Delete Role"
                                                            disabled={['superadmin', 'admin', 'office_staff', 'cashier'].includes(role.name)}
                                                            style={{ opacity: ['superadmin', 'admin', 'office_staff', 'cashier'].includes(role.name) ? 0.4 : 1 }}
                                                        >
                                                            <Trash2 size={14} className="stroke-[2.5]" />
                                                        </button>
                                                    </td>
                                                )}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Create/Edit User Modal */}
            {showCreateEditModal && isSuperAdminUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-300">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6 transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-3 border-b pb-2">
                            <h2 className="font-bold text-gray-800 text-xl">{editingUserId ? 'Edit User' : 'Create New User'}</h2>
                            <button onClick={handleCancelEdit} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">
                                ×
                            </button>
                        </div>
                        {message && (
                            <div className={`p-2 mb-4 text-sm rounded ${/error|fail/i.test(typeof message === 'object' ? (message?.text || message?.message || '') : String(message)) ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                {typeof message === 'object' ? (message?.text || message?.message || message?.error || JSON.stringify(message)) : String(message)}
                            </div>
                        )}

                        <form onSubmit={handleSubmit}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Left Column */}
                                <div className="space-y-4">
                                    {/* Employee Search / Name Input */}
                                    <div className="relative">
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Employee Name</label>

                                        {!formData.employeeId ? (
                                            <>
                                                <input
                                                    type="text"
                                                    className="w-full border p-2 rounded mt-1"
                                                    placeholder="Search employee by Name or ID..."
                                                    onChange={handleEmployeeSearch}
                                                />
                                                {/* Search Results Dropdown */}
                                                {(searchResults.length > 0 || searchLoading) && (
                                                    <div className="absolute z-10 w-full bg-white border border-gray-200 mt-1 rounded shadow-lg max-h-60 overflow-y-auto">
                                                        {searchLoading && (
                                                            <div className="p-3 text-center text-gray-500 text-sm flex items-center justify-center gap-2">
                                                                <svg className="animate-spin h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                                Searching...
                                                            </div>
                                                        )}
                                                        {!searchLoading && searchResults.map(emp => (
                                                            <div
                                                                key={emp._id}
                                                                className="p-2 hover:bg-blue-50 cursor-pointer border-b last:border-b-0"
                                                                onClick={() => selectEmployee(emp)}
                                                            >
                                                                <p className="font-bold text-sm text-gray-800">
                                                                    {emp.employee_name} <span className="text-gray-500 font-normal">({emp.emp_no})</span>
                                                                </p>
                                                                <p className="text-xs text-gray-500">
                                                                    {emp.designation_id?.designation_name || emp.designation_id?.name || 'N/A'} |
                                                                    {emp.division_id?.division_name || emp.division_id?.name || 'N/A'} |
                                                                    {emp.department_id?.department_name || emp.department_id?.name || 'N/A'}
                                                                </p>
                                                            </div>
                                                        ))}
                                                        {!searchLoading && searchResults.length === 0 && (
                                                            <div className="p-3 text-center text-gray-500 text-sm">No results found</div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        ) : (
                                            <div className="flex items-center justify-between p-2 bg-blue-50 border border-blue-200 rounded mt-1">
                                                <div>
                                                    <p className="font-bold text-sm text-blue-900">{formData.name}</p>
                                                    <p className="text-xs text-blue-700">Emp No: {formData.username}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={clearSelectedEmployee}
                                                    className="text-red-500 hover:text-red-700 text-xs font-bold px-2"
                                                >
                                                    Change
                                                </button>
                                            </div>
                                        )}

                                        {!formData.employeeId && editingUserId && (
                                            <input
                                                name="name"
                                                value={formData.name}
                                                onChange={handleChange}
                                                className="w-full border p-2 rounded mt-1"
                                                placeholder="Or enter name manually (Legacy)"
                                            />
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Username (Login ID)</label>
                                        <input
                                            name="username"
                                            value={formData.username}
                                            onChange={handleChange}
                                            className="w-full border p-2 rounded mt-1 bg-gray-50"
                                            readOnly={!!formData.employeeId} // Read-only if linked
                                            required
                                        />
                                    </div>

                                    {/* Password field - Hidden if Employee Linked */}
                                    {!formData.employeeId && (
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase">Password</label>
                                            <input
                                                type="password"
                                                name="password"
                                                value={formData.password}
                                                onChange={handleChange}
                                                className="w-full border p-2 rounded mt-1"
                                                required={!editingUserId && !formData.employeeId}
                                                placeholder={editingUserId ? "Leave blank to keep unchanged" : "Set password"}
                                            />
                                        </div>
                                    )}

                                    {formData.employeeId && (
                                        <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
                                            <span className="font-bold">Note:</span> user will login using their Employee DB password.
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Role</label>
                                        <select name="role" value={formData.role} onChange={handleChange} required className="w-full border p-2 rounded mt-1 bg-white capitalize">
                                            <option value="">Select Role</option>
                                            {roles
                                                .filter(r => r.name !== 'superadmin' || currentUser.role === 'superadmin')
                                                .map(r => (
                                                    <option key={r._id} value={r.name}>{r.name.replace(/_/g, ' ')}</option>
                                                ))
                                            }
                                            {roles.length === 0 && (
                                                <>
                                                    <option value="office_staff">Office Staff</option>
                                                    <option value="cashier">Cashier</option>
                                                    <option value="admin">Admin</option>
                                                    {currentUser.role === 'superadmin' && <option value="superadmin">Super Admin</option>}
                                                </>
                                            )}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Email Address</label>
                                        <input
                                            type="email"
                                            name="email"
                                            value={formData.email || ''}
                                            onChange={handleChange}
                                            className="w-full border p-2 rounded mt-1"
                                            placeholder="e.g. admin@pydahsoft.in"
                                        />
                                    </div>

                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Mobile Number</label>
                                        <input
                                            type="text"
                                            name="mobile"
                                            value={formData.mobile || ''}
                                            onChange={handleChange}
                                            className="w-full border p-2 rounded mt-1"
                                            placeholder="e.g. 9876543210"
                                        />
                                    </div>

                                    {/* Active Status Toggle */}
                                    <div className="flex items-center gap-2 mt-2 bg-slate-50 border p-2.5 rounded-lg shadow-sm">
                                        <input
                                            type="checkbox"
                                            name="isActive"
                                            id="user-is-active"
                                            checked={formData.isActive}
                                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                            className="rounded text-blue-600 focus:ring-blue-500 h-4 w-4"
                                        />
                                        <label htmlFor="user-is-active" className="text-xs font-bold text-gray-700 uppercase cursor-pointer select-none">Active Account</label>
                                    </div>

                                    {/* Campus Selection */}
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Campus Selection</label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border p-3 rounded bg-gray-50">
                                            {campusList.length === 0 ? (
                                                <p className="text-xs text-gray-500 col-span-full">No campuses loaded.</p>
                                            ) : (
                                                campusList.map((campus) => {
                                                    const isChecked = (formData.campuses || []).some((id) => Number(id) === Number(campus.id));
                                                    return (
                                                        <label key={campus.id} className="flex items-start gap-2 cursor-pointer p-2 rounded border bg-white hover:bg-blue-50/40">
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked}
                                                                onChange={() => handleCampusToggle(campus.id)}
                                                                className="rounded text-blue-600 focus:ring-blue-500 mt-0.5"
                                                            />
                                                            <div>
                                                                <span className="text-sm font-bold text-gray-800 block">{campus.name}</span>
                                                                <span className="text-[10px] font-mono text-blue-600 uppercase">{campus.code}</span>
                                                                <p className="text-[10px] text-gray-400 mt-0.5">{campus.colleges?.length || 0} colleges</p>
                                                            </div>
                                                        </label>
                                                    );
                                                })
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">Select campus(es) first, then choose colleges within them.</p>
                                    </div>
                                </div>

                                {/* Right Column */}
                                <div className="space-y-4">
                                    {/* College & Course Scope */}
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">College & Course Scope</label>
                                        <div className="space-y-4 border p-3 rounded bg-gray-50 max-h-[40vh] overflow-y-auto">
                                            {formData.campuses?.length === 0 ? (
                                                <p className="text-xs text-gray-500 italic">Select at least one campus to assign colleges.</p>
                                            ) : visibleColleges.length === 0 ? (
                                                <p className="text-xs text-gray-500">No colleges available for selected campus(es).</p>
                                            ) : (
                                                visibleColleges.map(collegeName => {
                                                    const isChecked = (formData.colleges || []).includes(collegeName);
                                                    const collegeCourses = hierarchy[collegeName] ? Object.keys(hierarchy[collegeName]) : [];
                                                    return (
                                                        <div key={collegeName} className="border-b last:border-b-0 pb-3 last:pb-0">
                                                            <label className="flex items-center space-x-2 cursor-pointer p-1 rounded hover:bg-gray-100">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked}
                                                                    onChange={() => handleCollegeToggle(collegeName)}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-sm font-bold text-gray-800">{collegeName}</span>
                                                            </label>

                                                            {isChecked && collegeCourses.length > 0 && (
                                                                <div className="ml-6 mt-2 p-2 bg-white rounded border border-gray-200 space-y-2">
                                                                    <div className="flex items-center justify-between border-b pb-1 mb-1">
                                                                        <span className="text-xs font-semibold text-gray-500">Courses:</span>
                                                                        <div className="flex gap-2">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleSelectAllCourses(collegeName)}
                                                                                className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-bold"
                                                                            >
                                                                                Select All
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleClearAllCourses(collegeName)}
                                                                                className="text-[10px] text-red-600 hover:text-red-800 hover:underline font-bold"
                                                                            >
                                                                                Clear
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-1.5">
                                                                        {collegeCourses.map(courseName => {
                                                                            const courseKey = `${collegeName}|${courseName}`;
                                                                            const isCourseChecked = (formData.courses || []).includes(courseKey);
                                                                            return (
                                                                                <label key={courseName} className="flex items-center space-x-1.5 cursor-pointer p-0.5 rounded hover:bg-gray-50">
                                                                                    <input
                                                                                        type="checkbox"
                                                                                        checked={isCourseChecked}
                                                                                        onChange={() => handleCourseToggle(collegeName, courseName)}
                                                                                        className="rounded text-blue-500 focus:ring-blue-400 w-3.5 h-3.5"
                                                                                    />
                                                                                    <span className="text-xs text-gray-600 font-medium">{courseName}</span>
                                                                                </label>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-1">Leave empty (no colleges selected) to allow access to all colleges (e.g. Super Admin).</p>
                                    </div>

                                    {/* Permission Checkboxes - split into two columns */}
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Permissions</label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 border p-3 rounded bg-gray-50 max-h-[50vh] overflow-y-auto">
                                            {availablePages.map(page => (
                                                <div key={page.path} className="flex flex-col">
                                                    <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                        <input
                                                            type="checkbox"
                                                            checked={(formData.permissions || []).includes(page.path)}
                                                            onChange={(() => {
                                                                const handlePermissionToggle = (path) => {
                                                                    let currentPermissions = formData.permissions || [];
                                                                    if (currentPermissions.includes(path)) {
                                                                        currentPermissions = currentPermissions.filter(p => p !== path);
                                                        if (path === '/fee-collection') {
                                                                            currentPermissions = currentPermissions.filter(p => p !== 'fee_collection_pay' && p !== 'fee_collection_concession' && p !== 'fee_collection_edit');
                                                                        }
                                                                        if (path === '/reports') {
                                                                            currentPermissions = currentPermissions.filter(p => p !== 'reports_daily_collection' && p !== 'reports_cashier_summary' && p !== 'reports_fee_head_summary' && p !== 'reports_account_wise');
                                                                        }
                                                                        if (path === '/proceedings') {
                                                                            currentPermissions = currentPermissions.filter(p => p !== 'proceedings_approve' && p !== 'proceedings_verify' && p !== 'proceedings_edit' && p !== 'proceedings_view');
                                                                        }
                                                                        if (path === '/overall-concessions') {
                                                                            currentPermissions = currentPermissions.filter(p => !OVERALL_CONCESSION_SUBS.includes(p) && p !== 'overall_concession_requests');
                                                                        }
                                                                    } else {
                                                                        currentPermissions = [...currentPermissions, path];
                                                                        if (path === '/fee-collection') {
                                                                            if (!currentPermissions.includes('fee_collection_pay')) currentPermissions.push('fee_collection_pay');
                                                                            if (formData.role !== 'cashier' && !currentPermissions.includes('fee_collection_concession')) {
                                                                                currentPermissions.push('fee_collection_concession');
                                                                            }
                                                                        }
                                                                        if (path === '/reports') {
                                                                            if (!currentPermissions.includes('reports_daily_collection')) currentPermissions.push('reports_daily_collection');
                                                                            if (!currentPermissions.includes('reports_cashier_summary')) currentPermissions.push('reports_cashier_summary');
                                                                            if (!currentPermissions.includes('reports_fee_head_summary')) currentPermissions.push('reports_fee_head_summary');
                                                                            if (!currentPermissions.includes('reports_account_wise')) currentPermissions.push('reports_account_wise');
                                                                        }
                                                                        if (path === '/concessions') {
                                                                            if (!currentPermissions.includes('concession_approvals')) currentPermissions.push('concession_approvals');
                                                                            if (formData.role !== 'cashier' && !currentPermissions.includes('concession_approvers')) {
                                                                                currentPermissions.push('concession_approvers');
                                                                            }
                                                                        }
                                                                        if (path === '/proceedings') {
                                                                            if (!currentPermissions.includes('proceedings_view')) currentPermissions.push('proceedings_view');
                                                                        }
                                                                        if (path === '/overall-concessions') {
                                                                            if (!currentPermissions.includes('overall_concession_view')) currentPermissions.push('overall_concession_view');
                                                                        }
                                                                    }
                                                                    setFormData({ ...formData, permissions: currentPermissions });
                                                                };
                                                                return () => handlePermissionToggle(page.path);
                                                            })()}
                                                            className="rounded text-blue-600 focus:ring-blue-500"
                                                        />
                                                        <span className="text-sm text-gray-700 font-medium">{page.name}</span>
                                                    </label>

                                                    {/* Sub-Permissions for Fee Collection */}
                                                    {page.path === '/fee-collection' && (formData.permissions || []).includes('/fee-collection') && (
                                                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('fee_collection_pay')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('fee_collection_pay')) p = p.filter(x => x !== 'fee_collection_pay');
                                                                            else p = [...p, 'fee_collection_pay'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Fee Collection</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('fee_collection_concession')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('fee_collection_concession')) p = p.filter(x => x !== 'fee_collection_concession');
                                                                            else p = [...p, 'fee_collection_concession'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Fee Concession</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('fee_collection_edit')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('fee_collection_edit')) p = p.filter(x => x !== 'fee_collection_edit');
                                                                            else p = [...p, 'fee_collection_edit'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Edit Transaction</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('fee_collection_delete')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('fee_collection_delete')) p = p.filter(x => x !== 'fee_collection_delete');
                                                                            else p = [...p, 'fee_collection_delete'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-red-600 focus:ring-red-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Delete Transaction</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('fee_collection_transfer')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('fee_collection_transfer')) p = p.filter(x => x !== 'fee_collection_transfer');
                                                                            else p = [...p, 'fee_collection_transfer'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Transfer Transaction</span>
                                                            </label>
                                                        </div>
                                                    )}

                                                    {/* Sub-Permissions for Proceedings */}
                                                    {page.path === '/proceedings' && (formData.permissions || []).includes('/proceedings') && (
                                                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                            {PROCEEDINGS_SUBS.map(sub => (
                                                                <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={(formData.permissions || []).includes(sub)}
                                                                        onChange={(() => {
                                                                            const toggle = () => {
                                                                                let p = formData.permissions || [];
                                                                                if (p.includes(sub)) p = p.filter(x => x !== sub);
                                                                                else p = [...p, sub];
                                                                                setFormData({ ...formData, permissions: p });
                                                                            };
                                                                            return toggle;
                                                                        })()}
                                                                        className="rounded text-blue-600 focus:ring-blue-500"
                                                                    />
                                                                    <span className="text-xs text-gray-600">{PROCEEDINGS_SUB_LABELS[sub]}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Sub-Permissions for Overall Concessions */}
                                                    {page.path === '/overall-concessions' && (formData.permissions || []).includes('/overall-concessions') && (
                                                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                            {OVERALL_CONCESSION_SUBS.map(sub => (
                                                                <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={
                                                                            (formData.permissions || []).includes(sub)
                                                                            || (sub === 'overall_concession_requests_write' && (formData.permissions || []).includes('overall_concession_requests'))
                                                                            || (sub === 'overall_concession_requests_read' && (
                                                                                (formData.permissions || []).includes('overall_concession_requests_write')
                                                                                || (formData.permissions || []).includes('overall_concession_requests')
                                                                            ))
                                                                        }
                                                                        onChange={(() => {
                                                                            const toggle = () => {
                                                                                let p = formData.permissions || [];
                                                                                const has = p.includes(sub)
                                                                                    || (sub === 'overall_concession_requests_write' && p.includes('overall_concession_requests'));
                                                                                if (has) {
                                                                                    p = p.filter(x => x !== sub);
                                                                                    if (sub === 'overall_concession_requests_write') {
                                                                                        p = p.filter(x => x !== 'overall_concession_requests');
                                                                                    }
                                                                                    if (sub === 'overall_concession_requests_read') {
                                                                                        p = p.filter(x => x !== 'overall_concession_requests_write' && x !== 'overall_concession_requests');
                                                                                    }
                                                                                } else {
                                                                                    p = [...p, sub];
                                                                                    if (sub === 'overall_concession_requests_write' && !p.includes('overall_concession_requests_read')) {
                                                                                        p.push('overall_concession_requests_read');
                                                                                    }
                                                                                    p = p.filter(x => x !== 'overall_concession_requests');
                                                                                }
                                                                                setFormData({ ...formData, permissions: p });
                                                                            };
                                                                            return toggle;
                                                                        })()}
                                                                        className="rounded text-blue-600 focus:ring-blue-500"
                                                                    />
                                                                    <span className="text-xs text-gray-600">{OVERALL_CONCESSION_SUB_LABELS[sub]}</span>
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Sub-Permissions for Concessions */}
                                                    {page.path === '/concessions' && (formData.permissions || []).includes('/concessions') && (
                                                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('concession_approvals')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('concession_approvals')) p = p.filter(x => x !== 'concession_approvals');
                                                                            else p = [...p, 'concession_approvals'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Enable Approvals</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('concession_approvers')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('concession_approvers')) p = p.filter(x => x !== 'concession_approvers');
                                                                            else p = [...p, 'concession_approvers'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Manage Approvers</span>
                                                            </label>
                                                        </div>
                                                    )}

                                                    {/* Sub-Permissions for Reports */}
                                                    {page.path === '/reports' && (formData.permissions || []).includes('/reports') && (
                                                        <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('reports_daily_collection')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('reports_daily_collection')) p = p.filter(x => x !== 'reports_daily_collection');
                                                                            else p = [...p, 'reports_daily_collection'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Daily Collection</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('reports_cashier_summary')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('reports_cashier_summary')) p = p.filter(x => x !== 'reports_cashier_summary');
                                                                            else p = [...p, 'reports_cashier_summary'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Cashier Summary</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('reports_fee_head_summary')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('reports_fee_head_summary')) p = p.filter(x => x !== 'reports_fee_head_summary');
                                                                            else p = [...p, 'reports_fee_head_summary'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">College-wise Summary</span>
                                                            </label>
                                                            <label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(formData.permissions || []).includes('reports_account_wise')}
                                                                    onChange={(() => {
                                                                        const toggle = () => {
                                                                            let p = formData.permissions || [];
                                                                            if (p.includes('reports_account_wise')) p = p.filter(x => x !== 'reports_account_wise');
                                                                            else p = [...p, 'reports_account_wise'];
                                                                            setFormData({ ...formData, permissions: p });
                                                                        };
                                                                        return toggle;
                                                                    })()}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">Account-wise Summary</span>
                                                            </label>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 rounded transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`flex-1 text-white font-bold py-2 rounded transition flex justify-center items-center gap-2 ${editingUserId ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                                >
                                    {isSubmitting && (
                                        <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    )}
                                    {isSubmitting ? 'Saving...' : (editingUserId ? 'Update User' : 'Create User')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Password Reset Modal */}
            {resetModal.show && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-300">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
                        <h2 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                            <svg className="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                            Reset Password
                        </h2>
                        <p className="text-sm text-gray-500 mb-6 border-b border-gray-100 pb-4">
                            Enter a new password for <span className="font-bold text-gray-800 px-1 bg-yellow-50 rounded text-yellow-700">{resetModal.user?.name}</span>.
                        </p>

                        <form onSubmit={handleSavePassword}>
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                                <input
                                    type="password"
                                    className="w-full border border-gray-300 rounded p-2 focus:ring-2 focus:ring-blue-500 outline-none"
                                    value={resetModal.newPassword}
                                    onChange={(e) => setResetModal({ ...resetModal, newPassword: e.target.value })}
                                    required
                                    autoFocus
                                    placeholder="Enter new password..."
                                />
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={closeResetModal}
                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 text-sm font-bold text-white bg-blue-600 rounded hover:bg-blue-700 transition"
                                >
                                    Save Password
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Create/Edit Role Modal */}
            {showRoleModal && isSuperAdminUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-300">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto p-6 transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-3 border-b pb-2">
                            <h2 className="font-bold text-gray-800 text-xl">{editingRoleId ? 'Edit Role' : 'Create New Role'}</h2>
                            <button onClick={() => setShowRoleModal(false)} className="text-gray-500 hover:text-gray-700 text-2xl font-bold">
                                ×
                            </button>
                        </div>

                        {message && (
                            <div className="bg-blue-50 border-l-4 border-blue-500 p-3 mb-4 rounded text-xs text-blue-700 font-bold">
                                {message}
                            </div>
                        )}

                        <form onSubmit={handleSaveRole}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Left Column: Role Details */}
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Role Name</label>
                                        <input
                                            name="name"
                                            value={roleFormData.name}
                                            onChange={(e) => setRoleFormData({ ...roleFormData, name: e.target.value })}
                                            className="w-full border p-2 rounded mt-1 bg-white"
                                            required
                                            placeholder="e.g. support_staff"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase">Description</label>
                                        <textarea
                                            name="description"
                                            value={roleFormData.description}
                                            onChange={(e) => setRoleFormData({ ...roleFormData, description: e.target.value })}
                                            className="w-full border p-2 rounded mt-1 bg-white h-24"
                                            placeholder="Describe what users with this role can do..."
                                        />
                                    </div>
                                </div>

                                {/* Right Column: Granular Page Permissions */}
                                <div>
                                    <h3 className="text-sm font-bold text-gray-700 mb-3 border-b pb-1">Page and Feature Permissions</h3>
                                    <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-2">
                                        {availablePages.map((page) => (
                                            <div key={page.path} className="border border-gray-100 rounded-lg p-2.5 bg-slate-50 hover:bg-slate-100/50 transition">
                                                <label className="flex items-center space-x-2.5 cursor-pointer font-bold text-gray-700 text-xs">
                                                    <input
                                                        type="checkbox"
                                                        checked={(roleFormData.permissions || []).includes(page.path)}
                                                        onChange={() => handleRolePermissionToggle(page.path)}
                                                        className="rounded text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span>{page.name} <span className="text-[10px] text-gray-400 font-mono">({page.path})</span></span>
                                                </label>

                                                {/* Sub-Permissions for Fee Collection */}
                                                {page.path === '/fee-collection' && (roleFormData.permissions || []).includes('/fee-collection') && (
                                                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                        {['fee_collection_pay', 'fee_collection_concession', 'fee_collection_edit', 'fee_collection_delete', 'fee_collection_transfer'].map(sub => (
                                                            <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-200 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(roleFormData.permissions || []).includes(sub)}
                                                                    onChange={() => handleRoleSubPermissionToggle(sub)}
                                                                    className={`rounded focus:ring-blue-500 ${sub === 'fee_collection_delete' ? 'text-red-600' : 'text-blue-600'}`}
                                                                />
                                                                <span className="text-xs text-gray-600 capitalize">{sub.replace(/_/g, ' ').replace('fee collection ', '')}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Sub-Permissions for Proceedings */}
                                                {page.path === '/proceedings' && (roleFormData.permissions || []).includes('/proceedings') && (
                                                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                        {PROCEEDINGS_SUBS.map(sub => (
                                                            <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-200 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(roleFormData.permissions || []).includes(sub)}
                                                                    onChange={() => handleRoleSubPermissionToggle(sub)}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">{PROCEEDINGS_SUB_LABELS[sub]}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Sub-Permissions for Overall Concessions */}
                                                {page.path === '/overall-concessions' && (roleFormData.permissions || []).includes('/overall-concessions') && (
                                                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                        {OVERALL_CONCESSION_SUBS.map(sub => (
                                                            <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-200 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={
                                                                        (roleFormData.permissions || []).includes(sub)
                                                                        || (sub === 'overall_concession_requests_write' && (roleFormData.permissions || []).includes('overall_concession_requests'))
                                                                        || (sub === 'overall_concession_requests_read' && (
                                                                            (roleFormData.permissions || []).includes('overall_concession_requests_write')
                                                                            || (roleFormData.permissions || []).includes('overall_concession_requests')
                                                                        ))
                                                                    }
                                                                    onChange={() => handleRoleSubPermissionToggle(sub)}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600">{OVERALL_CONCESSION_SUB_LABELS[sub]}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Sub-Permissions for Concessions */}
                                                {page.path === '/concessions' && (roleFormData.permissions || []).includes('/concessions') && (
                                                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                        {['concession_approvals', 'concession_approvers'].map(sub => (
                                                            <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-200 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(roleFormData.permissions || []).includes(sub)}
                                                                    onChange={() => handleRoleSubPermissionToggle(sub)}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600 capitalize">{sub.replace(/_/g, ' ')}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Sub-Permissions for Reports */}
                                                {page.path === '/reports' && (roleFormData.permissions || []).includes('/reports') && (
                                                    <div className="ml-6 mt-1 space-y-1 border-l-2 border-gray-200 pl-2">
                                                        {['reports_daily_collection', 'reports_cashier_summary', 'reports_fee_head_summary', 'reports_account_wise'].map(sub => (
                                                            <label key={sub} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-200 p-1 rounded">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={(roleFormData.permissions || []).includes(sub)}
                                                                    onChange={() => handleRoleSubPermissionToggle(sub)}
                                                                    className="rounded text-blue-600 focus:ring-blue-500"
                                                                />
                                                                <span className="text-xs text-gray-600 capitalize">{sub.replace(/_/g, ' ').replace('reports ', '')}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button
                                    type="button"
                                    onClick={() => setShowRoleModal(false)}
                                    className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 rounded transition"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`flex-1 text-white font-bold py-2 rounded transition flex justify-center items-center gap-2 ${editingRoleId ? 'bg-orange-600 hover:bg-orange-700' : 'bg-blue-600 hover:bg-blue-700'} ${isSubmitting ? 'opacity-70 cursor-not-allowed' : ''}`}
                                >
                                    {isSubmitting && (
                                        <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    )}
                                    {isSubmitting ? 'Saving...' : (editingRoleId ? 'Update Role' : 'Create Role')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Deactivate User Modal */}
            {deactivateModal.show && deactivateModal.user && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-300">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 transform transition-all scale-100">
                        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-orange-100 rounded-full mb-4">
                            <UserX className="w-6 h-6 text-orange-600" size={24} />
                        </div>
                        <h2 className="text-xl font-bold text-gray-800 text-center mb-2">Deactivate User?</h2>
                        <p className="text-sm text-gray-600 text-center mb-6">
                            Are you sure you want to deactivate <span className="font-bold text-gray-800">{deactivateModal.user?.name}</span>?
                        </p>
                        <p className="text-xs text-gray-500 text-center mb-6 bg-gray-50 p-3 rounded border border-gray-200">
                            The user will no longer be able to log in to the system. You can reactivate them anytime from the users list.
                        </p>
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={closeDeactivateModal}
                                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleDeactivateUser}
                                className="px-4 py-2 text-sm font-bold text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition"
                            >
                                Deactivate User
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* View User/Role Permissions Modal */}
            {viewPermissionsModal.show && viewPermissionsModal.user && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 transition-opacity duration-300">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6 transform transition-all scale-100">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <div>
                                <h2 className="font-bold text-gray-800 text-xl">
                                    {viewPermissionsModal.user.role && !viewPermissionsModal.user.username ? 'Role Permissions' : 'User Permissions'}
                                </h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    Viewing permissions for: <span className="font-semibold text-gray-800">
                                        {viewPermissionsModal.user.name || viewPermissionsModal.user.role}
                                    </span>
                                </p>
                            </div>
                            <button 
                                onClick={closeViewPermissionsModal} 
                                className="text-gray-500 hover:text-gray-700 text-2xl font-bold"
                            >
                                ×
                            </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Details Section */}
                            <div className="space-y-4 border-r md:pr-6">
                                {/* Show user details only if it's a user */}
                                {viewPermissionsModal.user.username && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                                            <p className="text-sm font-medium text-gray-800 p-2 bg-gray-50 rounded">{viewPermissionsModal.user.name}</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Username</label>
                                            <p className="text-sm font-mono text-gray-600 p-2 bg-gray-50 rounded">{viewPermissionsModal.user.username}</p>
                                        </div>
                                    </>
                                )}

                                {/* Role badge */}
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                        {viewPermissionsModal.user.username ? 'Role' : 'Role Name'}
                                    </label>
                                    <p className="text-sm">
                                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                            viewPermissionsModal.user.role === 'superadmin' ? 'bg-purple-100 text-purple-700' :
                                            viewPermissionsModal.user.role === 'admin' ? 'bg-blue-100 text-blue-700' :
                                            viewPermissionsModal.user.role === 'cashier' ? 'bg-green-100 text-green-700' :
                                            viewPermissionsModal.user.role === 'office_staff' ? 'bg-indigo-100 text-indigo-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                            {viewPermissionsModal.user.role}
                                        </span>
                                    </p>
                                </div>

                                {/* User-specific details */}
                                {viewPermissionsModal.user.email && (
                                    <>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                                            <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">{viewPermissionsModal.user.email || '—'}</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Mobile</label>
                                            <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">{viewPermissionsModal.user.mobile || '—'}</p>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Status</label>
                                            <p className="text-sm">
                                                {viewPermissionsModal.user.isActive === false ? (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 inline-block">
                                                        Deactivated (Manual)
                                                    </span>
                                                ) : viewPermissionsModal.user.employeeId && viewPermissionsModal.user.hrmsActive === false ? (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 inline-block">
                                                        Deactivated (HRMS)
                                                    </span>
                                                ) : (
                                                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200 inline-block">
                                                        Active
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                        {viewPermissionsModal.user.campuses && viewPermissionsModal.user.campuses.length > 0 && (
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Campuses</label>
                                                <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                                                    {viewPermissionsModal.user.campuses.map((id) => campusList.find((c) => c.id === id)?.name || id).join(', ')}
                                                </div>
                                            </div>
                                        )}
                                        {viewPermissionsModal.user.colleges && viewPermissionsModal.user.colleges.length > 0 && (
                                            <div>
                                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Colleges</label>
                                                <div className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                                                    {viewPermissionsModal.user.colleges.join(', ')}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* Role-specific details */}
                                {viewPermissionsModal.user.description && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description</label>
                                        <p className="text-sm text-gray-600 p-2 bg-gray-50 rounded">{viewPermissionsModal.user.description}</p>
                                    </div>
                                )}
                            </div>

                            {/* Permissions Section */}
                            <div className="space-y-4 md:pl-6">
                                <div>
                                    <h3 className="font-bold text-gray-700 text-sm mb-3 flex items-center gap-2">
                                        <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 3.062v6.218c0 1.265-.882 2.373-2.074 2.884-.308.143-.643.215-.973.215h-.023c.529 2.107.714 2.497.762 2.813H7.929c.048-.316.233-.706.762-2.813h-.023a1.97 1.97 0 01-.973-.215 2.066 2.066 0 01-2.074-2.884v-6.218a3.066 3.066 0 013.62-3.062zm9.01-1.134a1.933 1.933 0 00-1.099-.215 1.933 1.933 0 00-1.099.215l-.455.242a1.933 1.933 0 01-1.099.215 1.933 1.933 0 01-1.099-.215l-.454-.242a1.933 1.933 0 00-1.099-.215 1.933 1.933 0 00-1.099.215l-.455.242a1.933 1.933 0 01-1.099.215H2.26a1.933 1.933 0 01-1.099-.215l-.454-.242A1.933 1.933 0 000 3.25v6.218c0 1.265.882 2.373 2.074 2.884.308.143.643.215.973.215h.023c-.529 2.107-.714 2.497-.762 2.813h8.142c-.048-.316-.233-.706-.762-2.813h.023c.33 0 .665-.072.973-.215 1.192-.511 2.074-1.619 2.074-2.884V3.25a1.933 1.933 0 00-1.6-1.909z" clipRule="evenodd" />
                                        </svg>
                                        Assigned Permissions
                                    </h3>
                                    <div className="max-h-[50vh] overflow-y-auto space-y-2 border p-3 rounded bg-gray-50">
                                        {!viewPermissionsModal.user.permissions || (viewPermissionsModal.user.permissions || []).length === 0 ? (
                                            <p className="text-xs text-gray-500 italic">No permissions assigned to this {viewPermissionsModal.user.username ? 'user' : 'role'}.</p>
                                        ) : (
                                            availablePages.map((page) => {
                                                const isPermitted = (viewPermissionsModal.user.permissions || []).includes(page.path);
                                                if (!isPermitted) return null;

                                                return (
                                                    <div key={page.path} className="p-2 bg-white rounded border border-green-200 flex items-start gap-2">
                                                        <svg className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                                        </svg>
                                                        <div className="flex-1">
                                                            <p className="text-sm font-semibold text-gray-800">{page.name}</p>
                                                            <p className="text-[10px] text-gray-500 font-mono">{page.path}</p>

                                                            {/* Sub-Permissions Display */}
                                                            {page.path === '/fee-collection' && (
                                                                <div className="mt-1.5 ml-2 space-y-1">
                                                                    {['fee_collection_pay', 'fee_collection_concession', 'fee_collection_edit', 'fee_collection_delete', 'fee_collection_transfer'].map(sub => (
                                                                        (viewPermissionsModal.user.permissions || []).includes(sub) && (
                                                                            <div key={sub} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                                                                                <span className="text-green-600">✓</span>
                                                                                <span className="capitalize">{sub.replace(/_/g, ' ').replace('fee collection ', '')}</span>
                                                                            </div>
                                                                        )
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {page.path === '/proceedings' && (
                                                                <div className="mt-1.5 ml-2 space-y-1">
                                                                    {['proceedings_view', 'proceedings_edit', 'proceedings_verify', 'proceedings_approve'].map(sub => (
                                                                        (viewPermissionsModal.user.permissions || []).includes(sub) && (
                                                                            <div key={sub} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                                                                                <span className="text-green-600">✓</span>
                                                                                <span className="capitalize">{sub.replace(/_/g, ' ').replace('proceedings ', '')}</span>
                                                                            </div>
                                                                        )
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {page.path === '/overall-concessions' && (
                                                                <div className="mt-1.5 ml-2 space-y-1">
                                                                    {OVERALL_CONCESSION_SUBS.map(sub => {
                                                                        const perms = viewPermissionsModal.user.permissions || [];
                                                                        const shown =
                                                                            perms.includes(sub)
                                                                            || (sub === 'overall_concession_requests_write' && perms.includes('overall_concession_requests'))
                                                                            || (sub === 'overall_concession_requests_read' && (
                                                                                perms.includes('overall_concession_requests_write')
                                                                                || perms.includes('overall_concession_requests')
                                                                            ));
                                                                        return shown ? (
                                                                            <div key={sub} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                                                                                <span className="text-green-600">✓</span>
                                                                                <span>{OVERALL_CONCESSION_SUB_LABELS[sub]}</span>
                                                                            </div>
                                                                        ) : null;
                                                                    })}
                                                                </div>
                                                            )}

                                                            {page.path === '/concessions' && (
                                                                <div className="mt-1.5 ml-2 space-y-1">
                                                                    {['concession_approvals', 'concession_approvers'].map(sub => (
                                                                        (viewPermissionsModal.user.permissions || []).includes(sub) && (
                                                                            <div key={sub} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                                                                                <span className="text-green-600">✓</span>
                                                                                <span className="capitalize">{sub.replace(/_/g, ' ')}</span>
                                                                            </div>
                                                                        )
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {page.path === '/reports' && (
                                                                <div className="mt-1.5 ml-2 space-y-1">
                                                                    {['reports_daily_collection', 'reports_cashier_summary', 'reports_fee_head_summary', 'reports_account_wise'].map(sub => (
                                                                        (viewPermissionsModal.user.permissions || []).includes(sub) && (
                                                                            <div key={sub} className="flex items-center gap-1.5 text-[10px] text-gray-600">
                                                                                <span className="text-green-600">✓</span>
                                                                                <span className="capitalize">{sub.replace(/_/g, ' ').replace('reports ', '')}</span>
                                                                            </div>
                                                                        )
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2 mt-6 border-t pt-4">
                            <button
                                onClick={closeViewPermissionsModal}
                                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 rounded transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UserManagement;