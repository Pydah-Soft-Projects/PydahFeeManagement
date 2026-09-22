import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Swal from 'sweetalert2';
import { getStoredUser } from '../lib/auth';
import api from '../lib/api';

const Sidebar = ({ isOpenMobile = false, onCloseMobile = () => {} }) => {
    const location = useLocation();
    const [isCollapsed, setIsCollapsed] = useState(() => {
        return localStorage.getItem('sidebar-collapsed') === 'true';
    });

    const toggleCollapsed = () => {
        setIsCollapsed(prev => {
            const next = !prev;
            localStorage.setItem('sidebar-collapsed', String(next));
            return next;
        });
    };

    const expandSidebar = () => {
        setIsCollapsed(false);
        localStorage.setItem('sidebar-collapsed', 'false');
    };

    const navRef = React.useRef();

    React.useEffect(() => {
        const storedScroll = sessionStorage.getItem('sidebar-scroll');
        if (storedScroll && navRef.current) {
            navRef.current.scrollTop = Number(storedScroll);
        }
    }, []);

    const handleScroll = (e) => {
        sessionStorage.setItem('sidebar-scroll', e.target.scrollTop);
    };

    const icons = {
        Dashboard: <svg className="w-5 h-5 icon-dashboard transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>,
        Config: <svg className="w-5 h-5 icon-config transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
        Students: <svg className="w-5 h-5 icon-students transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
        Collection: <svg className="w-5 h-5 icon-collection transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
        Reports: <svg className="w-5 h-5 icon-reports transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>,
        DueReports: <svg className="w-5 h-5 icon-duereports transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
        Users: <svg className="w-5 h-5 icon-users transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
        PaymentConfig: <svg className="w-5 h-5 icon-paymentconfig transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>,
        Reminders: <svg className="w-5 h-5 icon-reminders transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>,
        BulkUpload: <svg className="w-5 h-5 icon-bulkupload transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>,
        Concession: <svg className="w-5 h-5 icon-concession transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581a1.5 1.5 0 002.122 0l4.317-4.317a1.5 1.5 0 000-2.122L11.159 3.659A1.5 1.5 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>,
        ConcessionApproval: <svg className="w-5 h-5 icon-concessionapproval transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
        Calendar: <svg className="w-5 h-5 icon-calendar transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
    };

    const user = getStoredUser() || {};
    const role = user.role;
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];

    // Settings sub-items (hash-based navigation within /settings)
    const SETTINGS_SUB_ITEMS = [
        { name: 'Receipt Appearance',      hash: 'appearance' },
        { name: 'Fee Collection Features', hash: 'features' },
        { name: 'User Payment Access',     hash: 'user-access' },
        { name: 'Receipt Sequence',        hash: 'sequence' },
        { name: 'Mask Fee Heads',          hash: 'masking' },
        { name: 'Email Reports',           hash: 'email-reports' },
        { name: 'Excess Fee Settings',     hash: 'excess-fee' },
    ];

    // Fee Configuration sub-items (hash-based navigation within /fee-config)
    const FEE_CONFIG_SUB_ITEMS = [
        { name: 'Fee Heads',     hash: 'heads' },
        { name: 'Fee Groups',    hash: 'groups' },
        { name: 'Fee Structures',hash: 'definitions' },
        { name: 'Late Fees',     hash: 'latefees' },
    ];

    // Proceedings sub-items (hash-based; filtered by permission)
    const PROCEEDINGS_SUB_ITEMS = [
        { name: 'All Proceedings', hash: 'list',   perm: 'list' },
        { name: 'Pending Queue',   hash: 'pending', perm: 'pending' },
        { name: 'Create Proceeding', hash: 'create', perm: 'create' },
        { name: 'Analytics',         hash: 'analytics', perm: 'view' },
        { name: 'Guide',           hash: 'guide',  perm: 'guide' },
    ];

    // Reminder Configuration sub-items (hash-based navigation within /reminders)
    const REMINDER_CONFIG_SUB_ITEMS = [
        { name: 'Templates',      hash: 'templates' },
        { name: 'Send Reminders',  hash: 'send' },
        { name: 'Reminder Rules',  hash: 'rules' },
        { name: 'Reminder Reports', hash: 'reports' },
        { name: 'Setup Guide',     hash: 'guide' },
    ];

    const isSettingsActive = location.pathname === '/settings';
    const [settingsExpanded, setSettingsExpanded] = React.useState(isSettingsActive);

    const isFeeConfigActive = location.pathname === '/fee-config';
    const [feeConfigExpanded, setFeeConfigExpanded] = React.useState(isFeeConfigActive);

    const isProceedingsActive = location.pathname === '/proceedings' || location.pathname === '/proceedings-analytics';
    const [proceedingsExpanded, setProceedingsExpanded] = React.useState(isProceedingsActive);
    const [hasPendingProceedingTxns, setHasPendingProceedingTxns] = React.useState(false);

    const isReminderConfigActive = location.pathname === '/reminders';
    const [reminderConfigExpanded, setReminderConfigExpanded] = React.useState(isReminderConfigActive);

    const canViewProceedings = role === 'superadmin' || role === 'admin'
        || permissions.includes('/proceedings')
        || permissions.includes('proceedings_view')
        || permissions.includes('proceedings_edit')
        || permissions.includes('proceedings_verify')
        || permissions.includes('proceedings_approve');
    const canCreateProceedings = role === 'superadmin' || role === 'admin'
        || permissions.includes('proceedings_view')
        || permissions.includes('proceedings_edit')
        || permissions.includes('/proceedings');
    const canListProceedings = role === 'superadmin' || role === 'admin'
        || permissions.includes('proceedings_edit')
        || permissions.includes('proceedings_verify')
        || permissions.includes('proceedings_approve');

    // Auto-expand groups when navigating to their respective routes
    React.useEffect(() => {
        if (isSettingsActive) setSettingsExpanded(true);
    }, [isSettingsActive]);

    React.useEffect(() => {
        if (isFeeConfigActive) setFeeConfigExpanded(true);
    }, [isFeeConfigActive]);

    React.useEffect(() => {
        if (isProceedingsActive) setProceedingsExpanded(true);
    }, [isProceedingsActive]);

    React.useEffect(() => {
        if (!canViewProceedings) {
            setHasPendingProceedingTxns(false);
            return undefined;
        }
        let cancelled = false;
        const fetchAlert = async () => {
            try {
                const res = await api.get('/proceedings/pending-auto-txn-alert');
                if (!cancelled) setHasPendingProceedingTxns(Boolean(res.data?.hasPending));
            } catch {
                if (!cancelled) setHasPendingProceedingTxns(false);
            }
        };
        fetchAlert();
        const interval = setInterval(fetchAlert, 60000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [canViewProceedings, isProceedingsActive, location.pathname]);

    React.useEffect(() => {
        if (isReminderConfigActive) setReminderConfigExpanded(true);
    }, [isReminderConfigActive]);

    const canViewOverallConcessions = role === 'superadmin' || role === 'admin'
        || permissions.includes('/overall-concessions')
        || permissions.includes('overall_concession_add')
        || permissions.includes('overall_concession_view')
        || permissions.includes('overall_concession_bulk')
        || permissions.includes('overall_concession_requests_read')
        || permissions.includes('overall_concession_requests_write')
        || permissions.includes('overall_concession_requests');

    const visibleProceedingsSubs = PROCEEDINGS_SUB_ITEMS.filter(sub => {
        if (sub.perm === 'create') return canCreateProceedings;
        if (sub.perm === 'list') return canListProceedings;
        return canViewProceedings;
    });

    const settingsIcon = <svg className="w-5 h-5 icon-settings transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;

    // Define all available menu items grouped by section
    const allMenuItems = [
        // Overview
        { section: 'Overview', name: 'Dashboard', path: '/dashboard', icon: icons.Dashboard },
        { section: 'Overview', name: 'Students', path: '/students', icon: icons.Students },

        // Fee Operations
        { section: 'Fee Operations', name: 'Fee Collection', path: '/fee-collection', icon: icons.Collection },
        { section: 'Fee Operations', name: 'Transaction Date Changes', path: '/transaction-dates', icon: icons.Calendar },
        { section: 'Fee Operations', name: 'Caution Deposit', path: '/caution-deposit', icon: <svg className="w-5 h-5 icon-collection transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
        { section: 'Fee Operations', name: 'Concessions (Declaration)', path: '/overall-concessions', icon: icons.Concession },
        { section: 'Fee Operations', name: 'Concessions (Application)', path: '/concessions', icon: icons.ConcessionApproval },
        { section: 'Fee Operations', name: 'Bulk Fee Upload', path: '/bulk-fee-upload', icon: icons.BulkUpload },
        { section: 'Fee Operations', name: '__PROCEEDINGS__', path: '/proceedings', icon: <svg className="w-5 h-5 icon-proceedings transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l5 5v9a2 2 0 01-2 2z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3v5h5" /></svg> },

        // Reports
        { section: 'Reports', name: 'Reports & Analytics', path: '/reports', icon: icons.Reports },
        { section: 'Reports', name: 'Due Reports', path: '/due-reports', icon: icons.DueReports },

        // Configuration
        { section: 'Configuration', name: '__FEE_CONFIG__', path: '/fee-config', icon: icons.Config },
        { section: 'Configuration', name: 'Payment Config', path: '/payment-config', icon: icons.PaymentConfig },
        { section: 'Configuration', name: '__SETTINGS__', path: '/settings', icon: settingsIcon },
        { section: 'Configuration', name: '__REMINDER_CONFIG__', path: '/reminders', icon: icons.Reminders },
        { section: 'Configuration', name: 'Academic Calendar', path: '/academic-calendar', icon: icons.Calendar },

        // Administration
        { section: 'Administration', name: 'User Management', path: '/user-management', icon: icons.Users },
        { section: 'Administration', name: 'Permissions', path: '/permissions', icon: <svg className="w-5 h-5 icon-permissions transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> },
        { section: 'Administration', name: 'User Profile', path: '/user-profile', icon: <svg className="w-5 h-5 icon-userprofile transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg> },
    ];

    // Filter Logic
    const visibleMenuItems = role === 'superadmin' || role === 'admin'
        ? allMenuItems
        : allMenuItems.filter(item =>
            permissions.includes(item.path) ||
            item.path === '/user-profile' ||
            (item.path === '/proceedings' && (
                permissions.includes('proceedings_view') ||
                permissions.includes('proceedings_edit') ||
                permissions.includes('proceedings_verify') ||
                permissions.includes('proceedings_approve')
            )) ||
            (item.path === '/overall-concessions' && canViewOverallConcessions) ||
            (item.path === '/transaction-dates' && (permissions.includes('fee_collection_edit') || permissions.includes('fee_collection_delete')))
        );

    // Group items by section
    const groupedItems = visibleMenuItems.reduce((acc, item) => {
        const section = item?.section || 'Other';
        if (!Array.isArray(acc[section])) acc[section] = [];
        acc[section].push(item);
        return acc;
    }, {});

    return (
        <>
            {/* Mobile Backdrop Overlay */}
            {isOpenMobile && (
                <div 
                    className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-40 md:hidden transition-opacity duration-300"
                    onClick={onCloseMobile}
                />
            )}
            <div className={`bg-white h-screen max-h-screen flex flex-col shadow-lg transition-all duration-300 overflow-hidden 
                fixed inset-y-0 left-0 z-50 md:sticky md:top-0 md:z-auto
                ${isOpenMobile ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
                ${isCollapsed ? 'w-64 md:w-20' : 'w-64 md:w-62'}
            `}>
            <div className="bg-gradient-to-br from-blue-700 via-indigo-800 to-indigo-950 p-4 pt-4 pb-7 shrink-0 relative flex flex-col items-center">
                <div
                    className={`flex items-center gap-3 ${isCollapsed ? 'justify-center w-full cursor-pointer' : 'justify-center w-full'}`}
                    onClick={() => isCollapsed && expandSidebar()}
                    title={isCollapsed ? "Click to Expand" : ""}
                >
                    {isCollapsed ? (
                        /* Compact Emblem for Collapsed Sidebar */
                        <div className="border-[2px] border-white w-9 h-9 rounded-tl-lg rounded-br-lg rounded-tr-[2px] rounded-bl-[2px] flex items-center justify-center relative shrink-0">
                            <div className="absolute -top-1 -left-0.5 flex gap-[1px]">
                                <span className="w-1 h-1 rounded-full bg-white"></span>
                                <span className="w-[3px] h-[3px] rounded-full bg-white mt-[1px]"></span>
                            </div>
                            <span className="text-base font-black text-white tracking-tighter">P</span>
                        </div>
                    ) : (
                        /* Full Brand Logo Styled in CSS */
                        <div className="flex flex-col items-center justify-center select-none">
                            {/* Emblem Box */}
                            <div className="border-[2.5px] border-white px-5 py-2 rounded-tl-[18px] rounded-br-[18px] rounded-tr-[3px] rounded-bl-[3px] relative flex items-center justify-center leading-none">
                                {/* The PYDAH text with stylized dots */}
                                <div className="relative flex items-center">
                                    <div className="absolute -top-1.5 -left-1.5 flex gap-[1.5px]">
                                        <span className="w-1.5 h-1.5 rounded-full bg-white opacity-95"></span>
                                        <span className="w-1 h-1 rounded-full bg-white opacity-85 mt-1"></span>
                                        <span className="w-[3px] h-[3px] rounded-full bg-white opacity-75 mt-0.5"></span>
                                    </div>
                                    <span className="text-xl font-extrabold text-white tracking-widest font-sans">
                                        PYDAH
                                    </span>
                                </div>
                            </div>
                            {/* Subtitle */}
                            <span className="text-[10px] text-sky-200 mt-2 font-serif italic tracking-wider whitespace-nowrap">
                                Education & Beyond
                            </span>
                        </div>
                    )}
                </div>

                {!isCollapsed && (
                    <button
                        onClick={toggleCollapsed}
                        className="hidden md:block absolute top-4 right-4 p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                        title="Collapse Sidebar"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                    </button>
                )}
                {/* Mobile Close Button */}
                <button
                    onClick={onCloseMobile}
                    className="md:hidden absolute top-4 right-4 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    title="Close Menu"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            
            {/* Main Nav Container: White bg overlapping the header slightly with rounded corners */}
            <nav 
                ref={navRef} 
                onScroll={handleScroll} 
                className="sidebar-nav-scroll flex-1 min-h-0 overflow-y-auto bg-white rounded-t-[24px] -mt-5 pt-6 px-3 pb-3 space-y-3 relative z-10"
            >
                {Object.entries(groupedItems).map(([section, items], sGroupIdx) => (
                    <div key={section} className="space-y-1">
                        {!isCollapsed && section !== 'Overview' && (
                            <div className="mb-1.5 mt-2 flex items-center justify-center px-2">
                                <div className="flex-1 h-[1px] bg-gray-100"></div>
                                <div className="text-[9px] font-extrabold text-gray-400 uppercase tracking-widest px-3.5">
                                    {section}
                                </div>
                                <div className="flex-1 h-[1px] bg-gray-100"></div>
                            </div>
                        )}
                        {isCollapsed && sGroupIdx > 0 && (
                            <div className="h-[1px] bg-gray-100 my-2 mx-2"></div>
                        )}
                        <div className="space-y-0.5">
                            {(Array.isArray(items) ? items : []).map((item, index) => {
                                // ── Special: Fee Configuration expandable group ──
                                if (item.name === '__FEE_CONFIG__') {
                                    const isActive = isFeeConfigActive;
                                    return (
                                        <div key={index}>
                                            <button
                                                onClick={() => {
                                                    if (isCollapsed) {
                                                        expandSidebar();
                                                    }
                                                    setFeeConfigExpanded(prev => !prev);
                                                }}
                                                className={`sidebar-link w-full flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                                                    isActive
                                                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-100'
                                                        : 'text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                } ${isCollapsed ? 'justify-center' : ''}`}
                                                title={isCollapsed ? 'Fee Configuration' : ''}
                                            >
                                                <span className={`text-xl shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>{item.icon}</span>
                                                {!isCollapsed && (
                                                    <>
                                                        <span className="ml-3.5 whitespace-nowrap flex-1 text-left">Fee Configuration</span>
                                                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${feeConfigExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                                    </>
                                                )}
                                            </button>
                                            {/* Sub-items */}
                                            {!isCollapsed && feeConfigExpanded && (
                                                <div className="ml-3 mt-0.5 pl-3 border-l border-indigo-100 space-y-0.5">
                                                    {FEE_CONFIG_SUB_ITEMS.map(sub => {
                                                        const subActive = isFeeConfigActive && (location.hash === `#${sub.hash}` || (!location.hash && sub.hash === 'heads'));
                                                        return (
                                                            <Link
                                                                key={sub.hash}
                                                                to={`/fee-config#${sub.hash}`}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                                    subActive
                                                                        ? 'bg-blue-50 text-blue-700 font-bold'
                                                                        : 'text-slate-500 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                                }`}
                                                            >
                                                                <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${subActive ? 'bg-blue-600' : 'bg-slate-300'}`}></span>
                                                                {sub.name}
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // ── Special: Proceedings expandable group ──
                                if (item.name === '__PROCEEDINGS__') {
                                    const isActive = isProceedingsActive;
                                    const defaultHash = visibleProceedingsSubs[0]?.hash || 'list';
                                    return (
                                        <div key={index}>
                                            <button
                                                onClick={() => {
                                                    if (isCollapsed) {
                                                        expandSidebar();
                                                    }
                                                    setProceedingsExpanded(prev => !prev);
                                                }}
                                                className={`sidebar-link w-full flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                                                    isActive
                                                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-100'
                                                        : 'text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                } ${isCollapsed ? 'justify-center' : ''}`}
                                                title={isCollapsed ? 'Proceedings' : ''}
                                            >
                                                <span className={`relative text-xl shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>
                                                    {item.icon}
                                                    {hasPendingProceedingTxns && isCollapsed && (
                                                        <span
                                                            className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${isActive ? 'bg-amber-300 ring-2 ring-indigo-600' : 'bg-amber-500 ring-2 ring-white'}`}
                                                            title="Pending proceeding transactions"
                                                        />
                                                    )}
                                                </span>
                                                {!isCollapsed && (
                                                    <>
                                                        <span className="ml-3.5 whitespace-nowrap flex-1 text-left flex items-center gap-2">
                                                            Proceedings
                                                            {hasPendingProceedingTxns && (
                                                                <span
                                                                    className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-amber-300' : 'bg-amber-500'}`}
                                                                    title="Pending proceeding transactions"
                                                                />
                                                            )}
                                                        </span>
                                                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${proceedingsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                                    </>
                                                )}
                                            </button>
                                            {!isCollapsed && proceedingsExpanded && (
                                                <div className="ml-3 mt-0.5 pl-3 border-l border-indigo-100 space-y-0.5">
                                                    {visibleProceedingsSubs.map(sub => {
                                                        const isAnalyticsSub = sub.hash === 'analytics';
                                                        const targetTo = isAnalyticsSub ? '/proceedings-analytics' : `/proceedings#${sub.hash}`;
                                                        const subActive = isAnalyticsSub
                                                            ? location.pathname === '/proceedings-analytics'
                                                            : (location.pathname === '/proceedings' && (location.hash === `#${sub.hash}` || (!location.hash && sub.hash === defaultHash)));
                                                        return (
                                                            <Link
                                                                key={sub.hash}
                                                                to={targetTo}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                                    subActive
                                                                        ? 'bg-blue-50 text-blue-700 font-bold'
                                                                        : 'text-slate-500 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                                }`}
                                                            >
                                                                <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${subActive ? 'bg-blue-600' : 'bg-slate-300'}`}></span>
                                                                {sub.name}
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // ── Special: Reminder Configuration expandable group ──
                                if (item.name === '__REMINDER_CONFIG__') {
                                    const isActive = isReminderConfigActive;
                                    return (
                                        <div key={index}>
                                            <button
                                                onClick={() => {
                                                    if (isCollapsed) {
                                                        expandSidebar();
                                                    }
                                                    setReminderConfigExpanded(prev => !prev);
                                                }}
                                                className={`sidebar-link w-full flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                                                    isActive
                                                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-100'
                                                        : 'text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                } ${isCollapsed ? 'justify-center' : ''}`}
                                                title={isCollapsed ? 'Reminder Config' : ''}
                                            >
                                                <span className={`text-xl shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>{item.icon}</span>
                                                {!isCollapsed && (
                                                    <>
                                                        <span className="ml-3.5 whitespace-nowrap flex-1 text-left">Reminder Config</span>
                                                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${reminderConfigExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                                    </>
                                                )}
                                            </button>
                                            {/* Sub-items */}
                                            {!isCollapsed && reminderConfigExpanded && (
                                                <div className="ml-3 mt-0.5 pl-3 border-l border-indigo-100 space-y-0.5">
                                                    {REMINDER_CONFIG_SUB_ITEMS.map(sub => {
                                                        const subActive = isReminderConfigActive && (location.hash === `#${sub.hash}` || (!location.hash && sub.hash === 'templates'));
                                                        return (
                                                            <Link
                                                                key={sub.hash}
                                                                to={`/reminders#${sub.hash}`}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                                    subActive
                                                                        ? 'bg-blue-50 text-blue-700 font-bold'
                                                                        : 'text-slate-500 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                                }`}
                                                            >
                                                                <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${subActive ? 'bg-blue-600' : 'bg-slate-300'}`}></span>
                                                                {sub.name}
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // ── Special: Settings expandable group ──────
                                if (item.name === '__SETTINGS__') {
                                    const isActive = isSettingsActive;
                                    return (
                                        <div key={index}>
                                            <button
                                                onClick={() => {
                                                    if (isCollapsed) {
                                                        expandSidebar();
                                                    }
                                                    setSettingsExpanded(prev => !prev);
                                                }}
                                                className={`sidebar-link w-full flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                                                    isActive
                                                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-100'
                                                        : 'text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                } ${isCollapsed ? 'justify-center' : ''}`}
                                                title={isCollapsed ? 'Settings' : ''}
                                            >
                                                <span className={`text-xl shrink-0 ${isActive ? 'text-white' : 'text-slate-500'}`}>{item.icon}</span>
                                                {!isCollapsed && (
                                                    <>
                                                        <span className="ml-3.5 whitespace-nowrap flex-1 text-left">Settings</span>
                                                        <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${settingsExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
                                                    </>
                                                )}
                                            </button>
                                            {/* Sub-items */}
                                            {!isCollapsed && settingsExpanded && (
                                                <div className="ml-3 mt-0.5 pl-3 border-l border-indigo-100 space-y-0.5">
                                                    {SETTINGS_SUB_ITEMS.map(sub => {
                                                        const subActive = isSettingsActive && (location.hash === `#${sub.hash}` || (!location.hash && sub.hash === 'appearance'));
                                                        return (
                                                            <Link
                                                                key={sub.hash}
                                                                to={`/settings#${sub.hash}`}
                                                                className={`flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                                                    subActive
                                                                        ? 'bg-blue-50 text-blue-700 font-bold'
                                                                        : 'text-slate-500 hover:bg-indigo-50/50 hover:text-indigo-600'
                                                                }`}
                                                            >
                                                                <span className={`w-1.5 h-1.5 rounded-full mr-2 shrink-0 ${subActive ? 'bg-blue-600' : 'bg-slate-300'}`}></span>
                                                                {sub.name}
                                                            </Link>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                    );
                                }

                                // ── Normal item ──────────────────────────────
                                const isActive = location.pathname === item.path;
                                return (
                                    <Link
                                        key={index}
                                        to={item.path}
                                        onClick={onCloseMobile}
                                        className={`sidebar-link flex items-center px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md shadow-indigo-100'
                                                : 'text-slate-700 hover:bg-indigo-50/50 hover:text-indigo-600'
                                        } ${isCollapsed ? 'justify-center' : ''}`}
                                        title={isCollapsed ? item.name : ''}
                                    >
                                        <span className={`text-xl shrink-0 transition-colors duration-200 ${
                                            isActive ? 'text-white' : 'text-slate-500 group-hover:text-indigo-600'
                                        }`}>{item.icon}</span>
                                        {!isCollapsed && <span className="ml-3.5 whitespace-nowrap">{item.name}</span>}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </nav>


            {/* Bottom Section: Profile Card */}
            <div className="p-3 border-t border-gray-100 shrink-0 bg-white">
                <div className={`flex ${isCollapsed ? 'flex-col items-center gap-2.5' : 'items-center justify-between'}`}>
                    
                    {/* User Info / Profile Card Link */}
                    <Link 
                        to="/user-profile"
                        className={`flex items-center gap-2 p-1.5 rounded-xl transition-all duration-200 hover:bg-slate-50 border border-transparent hover:border-slate-100/80 ${
                            isCollapsed ? 'justify-center w-full' : 'flex-1 min-w-0 mr-1'
                        }`}
                        title="View Profile"
                    >
                        <div className="w-8.5 h-8.5 rounded-full bg-indigo-600 flex items-center justify-center text-white font-extrabold text-[12px] shadow-sm shrink-0 transition-transform duration-200 hover:scale-105">
                            {user.name ? user.name.slice(0, 2).toUpperCase() : 'SA'}
                        </div>
                        {!isCollapsed && (
                            <div className="flex-1 min-w-0 text-left">
                                <p className="text-xs font-bold text-slate-800 leading-tight truncate">{user.name || 'Super Admin'}</p>
                                <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5 truncate">
                                    {role === 'superadmin' 
                                        ? 'Super Admin' 
                                        : (user.campuses && user.campuses.length > 0
                                            ? `Campus scope (${user.campuses.length})`
                                            : (user.colleges && user.colleges.length > 1 
                                                ? `${user.college} (+${user.colleges.length - 1})` 
                                                : (user.college || role)
                                              )
                                          )
                                    }
                                </p>
                            </div>
                        )}
                    </Link>
                    <button
                        onClick={() => {
                            Swal.fire({
                                title: 'Logout?',
                                text: "You will be returned to the login screen.",
                                icon: 'warning',
                                showCancelButton: true,
                                confirmButtonColor: '#d33',
                                cancelButtonColor: '#3085d6',
                                confirmButtonText: 'Yes, logout!'
                            }).then((result) => {
                                if (result.isConfirmed) {
                                    const isSSO = localStorage.getItem('isSSO') === 'true';
                                    localStorage.removeItem('user');
                                    localStorage.removeItem('token');
                                    localStorage.removeItem('isSSO');

                                    if (isSSO) {
                                        window.location.href = import.meta.env.VITE_CRM_FRONTEND_URL || 'http://localhost:5173';
                                    } else {
                                        window.location.href = '/';
                                    }
                                }
                            })
                        }}
                        className="text-slate-400 hover:text-red-500 transition-colors p-2.5 rounded-xl hover:bg-red-50 shrink-0"
                        title="Logout"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    </button>
                </div>
            </div>

            {/* Sidebar Micro-Animations */}
            <style>{`
                .sidebar-link:hover .icon-dashboard {
                    animation: dashboard-pulse 1s infinite alternate ease-in-out;
                }
                .sidebar-link:hover .icon-config,
                .sidebar-link:hover .icon-settings {
                    animation: cog-spin 2.5s infinite linear;
                }
                .sidebar-link:hover .icon-students,
                .sidebar-link:hover .icon-users,
                .sidebar-link:hover .icon-userprofile {
                    transform: scale(1.2);
                }
                .sidebar-link:hover .icon-collection {
                    animation: money-bounce 0.8s infinite alternate ease-in-out;
                }
                .sidebar-link:hover .icon-reports,
                .sidebar-link:hover .icon-duereports {
                    transform: translateY(-3px) scale(1.1);
                }
                .sidebar-link:hover .icon-reminders {
                    animation: bell-ring 0.6s ease-in-out;
                    transform-origin: top center;
                }
                .sidebar-link:hover .icon-bulkupload {
                    animation: upload-bounce 1s infinite ease-in-out;
                }
                .sidebar-link:hover .icon-concession,
                .sidebar-link:hover .icon-concessionapproval {
                    animation: tag-swing 0.8s ease-in-out;
                }
                .sidebar-link:hover .icon-calendar {
                    animation: calendar-pulse 0.8s infinite alternate ease-in-out;
                }
                .sidebar-link:hover .icon-permissions {
                    transform: rotate(15deg) scale(1.15);
                }
                .sidebar-link:hover .icon-proceedings {
                    transform: translateX(2px) scale(1.1);
                }

                /* Hide Scrollbars in Sidebar Navigation */
                .sidebar-nav-scroll {
                    -ms-overflow-style: none;  /* IE and Edge */
                    scrollbar-width: none;  /* Firefox */
                }
                .sidebar-nav-scroll::-webkit-scrollbar {
                    display: none; /* Chrome, Safari and Opera */
                }

                @keyframes cog-spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes dashboard-pulse {
                    0% { transform: scale(1); }
                    100% { transform: scale(1.15); }
                }
                @keyframes money-bounce {
                    0% { transform: translateY(0); }
                    100% { transform: translateY(-3px) rotate(5deg); }
                }
                @keyframes bell-ring {
                    0%, 100% { transform: rotate(0deg); }
                    20% { transform: rotate(15deg); }
                    40% { transform: rotate(-15deg); }
                    60% { transform: rotate(10deg); }
                    80% { transform: rotate(-10deg); }
                }
                @keyframes upload-bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                }
                @keyframes tag-swing {
                    0%, 100% { transform: rotate(0deg); }
                    50% { transform: rotate(-15deg); }
                }
                @keyframes calendar-pulse {
                    0% { transform: scale(1) translateY(0); }
                    100% { transform: scale(1.1) translateY(-2px); }
                }
            `}</style>
        </div>
        </>
    );
};

export default Sidebar;

