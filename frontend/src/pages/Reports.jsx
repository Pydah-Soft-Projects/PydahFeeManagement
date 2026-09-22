import React, { useState, useEffect, useRef, Fragment } from 'react';
import Sidebar from './Sidebar';
import api from '../lib/api';
import { useReactToPrint } from 'react-to-print';
import { printHtmlDocument } from '../utils/printService';
import XLSX from 'xlsx-js-style';
import {
    Calendar,
    Printer,
    Wallet,
    Landmark,
    CreditCard,
    TrendingUp,
    FileText,
    FileSpreadsheet,
    Users,
    Filter,
    Search,
    ChevronDown,
    ChevronUp,
    Clock,
    X
} from 'lucide-react';
import CashierReportTemplate from '../components/CashierReportTemplate';
import DailyReportTemplate from '../components/DailyReportTemplate';
import CollegeReportTemplate from '../components/CollegeReportTemplate';
import AccountReportTemplate from '../components/AccountReportTemplate';
import FeeHeadReportTemplate from '../components/FeeHeadReportTemplate';
import { useCampuses } from '../hooks/useCampuses';
import { isRtfTransaction, isBankCollectionTx, isCashCollectionTx } from '../utils/reportTxHelpers';

// PrintTriggerComponent was removed

// --- Components ---

const StatCard = ({ title, value, color, icon: Icon, note }) => {
    const cardStyles = {
        blue: {
            wrapper: "bg-gradient-to-br from-blue-50 to-blue-100/30 border-blue-100 text-blue-900",
            title: "text-blue-600/90",
            value: "text-blue-950",
            iconBg: "bg-blue-100 text-blue-600"
        },
        green: {
            wrapper: "bg-gradient-to-br from-emerald-50 to-emerald-100/30 border-emerald-100 text-emerald-900",
            title: "text-emerald-700/90",
            value: "text-emerald-950",
            iconBg: "bg-emerald-100 text-emerald-600"
        },
        indigo: {
            wrapper: "bg-gradient-to-br from-indigo-50 to-indigo-100/30 border-indigo-100 text-indigo-900",
            title: "text-indigo-700/90",
            value: "text-indigo-950",
            iconBg: "bg-indigo-100 text-indigo-600"
        },
        purple: {
            wrapper: "bg-gradient-to-br from-purple-50 to-purple-100/30 border-purple-100 text-purple-900",
            title: "text-purple-700/90",
            value: "text-purple-950",
            iconBg: "bg-purple-100 text-purple-600"
        }
    };

    const style = cardStyles[color] || cardStyles.blue;

    return (
        <div className={`p-5 rounded-xl border shadow-sm flex items-start justify-between hover:shadow-md transition-all duration-300 ${style.wrapper}`}>
            <div>
                <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${style.title}`}>{title}</p>
                <h3 className={`text-xl font-extrabold tracking-tight ${style.value}`}>{value}</h3>
                {note && <p className="text-[10px] mt-1.5 text-gray-500 font-medium">{note}</p>}
            </div>
            <div className={`p-2.5 rounded-lg ${style.iconBg} bg-opacity-70`}>
                <Icon size={18} strokeWidth={2.5} />
            </div>
        </div>
    );
};

const ReportRow = ({ row, idx, activeTab, expandedRows, toggleRow, dateRange, role, setPrintModalData }) => {
    const printRef = useRef();
    const handlePrint = async () => {
        try {
            let template = '';
            let data = {};
            if (activeTab === 'cashier') {
                template = 'cashier-report';
                data = { cashierData: row, dateRange, options: { mode: 'all' } };
            } else if (activeTab === 'college') {
                template = 'college-report';
                data = { displayData: row, dateRange, options: { mode: 'all' } };
            } else if (activeTab === 'account') {
                template = 'account-report';
                data = { displayData: row, dateRange, options: { mode: 'all' } };
            } else if (activeTab === 'feeHead') {
                template = 'feehead-report';
                data = { displayData: row, dateRange, options: { mode: 'all' } };
            } else if (activeTab === 'daily') {
                template = 'daily-report';
                data = { reportData: row };
            }

            const response = await api.post('/print', { template, data });
            printHtmlDocument(response.data);
        } catch (err) {
            console.error('Print failed:', err);
            alert('Failed to generate print document');
        }
    };

    const isExpanded = expandedRows.includes(idx);
    const RowIcon = activeTab === 'cashier' ? Users : activeTab === 'college' ? Landmark : activeTab === 'account' ? CreditCard : activeTab === 'feeHead' ? FileText : Calendar;
    const formattedDate = row._id?.day ? `${row._id.day}-${row._id.month}-${row._id.year}` : 'Date';

    // Label determination logic
    const rowLabel = activeTab === 'daily'
        ? <span className="font-mono text-gray-700 tracking-tight font-bold">{formattedDate}</span>
        : activeTab === 'college'
            ? (typeof row._id === 'object' ? JSON.stringify(row._id) : (row._id || 'Unknown College'))
            : activeTab === 'account'
                ? (row.account_name || 'Direct / Unassigned')
                : activeTab === 'feeHead'
                    ? (row.name || (typeof row._id === 'object' ? '' : row._id) || 'Unknown Fee Head')
                    : (row.name || (typeof row._id === 'object' ? '' : row._id) || 'Unknown');

    // Calculate Net Total (Cash + Bank) - equivalent to debitAmount
    const netTotal = (row.cashAmount || 0) + (row.bankAmount || 0);

    return (
        <React.Fragment>
            <tr
                onClick={() => (activeTab === 'cashier' || activeTab === 'daily' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && toggleRow(idx)}
                className={`
                    group border-b border-gray-100 transition-all duration-200 text-xs
                    ${isExpanded ? 'bg-blue-50/60' : 'hover:bg-gray-50 cursor-pointer'}
                `}
            >
                {/* Identifier */}
                <td className="py-4 px-6 md:w-1/4">
                    <div className="flex items-start gap-3">
                        <div className={`
                            p-2 rounded-lg transition-colors duration-200 mt-0.5
                            ${isExpanded ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-white border border-transparent group-hover:border-gray-200'}
                        `}>
                            <RowIcon size={16} strokeWidth={2} />
                        </div>
                        <div>
                            <p className="font-bold text-gray-800">{rowLabel}</p>
                            {activeTab === 'account' && (
                                <div className="mt-1 space-y-0.5 text-[10px] text-gray-500">
                                    {row.bank_name !== 'Cash / General' ? (
                                        <>
                                            <div className="font-semibold text-gray-700">{row.bank_name} <span className="font-mono text-[9px]">({row.account_number})</span></div>
                                            {row.is_global || !row.college || ['N/A', 'All Colleges', 'All'].includes(String(row.college).trim()) ? (
                                                <div className="text-[8px] text-purple-700 bg-purple-50 border border-purple-100 px-1 py-0.5 rounded inline-block font-bold mt-0.5">Global Account</div>
                                            ) : (
                                                <div className="text-[8px] text-blue-600 bg-blue-50 border border-blue-100 px-1 py-0.5 rounded inline-block font-bold mt-0.5">{row.college} - {row.course}</div>
                                            )}
                                        </>
                                    ) : (
                                        <div className="text-[8px] text-gray-500 bg-gray-100 border border-gray-200 px-1 py-0.5 rounded inline-block font-bold mt-0.5">General Cash/Other Collections</div>
                                    )}
                                </div>
                            )}
                            {(activeTab === 'cashier' || activeTab === 'daily' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && (
                                <div className="flex items-center gap-1 text-[9px] font-medium text-gray-400 mt-1 group-hover:text-blue-500 transition-colors uppercase tracking-wide">
                                    {isExpanded ? 'Collapse' : 'Click for Details'}
                                </div>
                            )}
                        </div>
                    </div>
                </td>

                {/* Transactions Count */}
                <td className="py-4 px-6 text-right">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold bg-gray-100 text-gray-700">
                        {row.count || row.totalCount}
                    </span>
                </td>

                {/* Cash */}
                {activeTab !== 'account' && (
                    <td className="py-4 px-6 text-right font-medium text-emerald-600">
                        {Number(row.cashAmount || 0).toLocaleString('en-IN')}
                    </td>
                )}

                {/* Bank */}
                <td className="py-4 px-6 text-right font-medium text-indigo-600">
                    {Number(row.bankAmount || 0).toLocaleString('en-IN')}
                </td>

                {/* Concession */}
                <td className="py-4 px-6 text-right font-medium text-purple-600">
                    {Number(row.creditAmount || 0).toLocaleString('en-IN')}
                </td>

                {/* Net Total */}
                <td className="py-4 px-6 text-right">
                    <span className="text-xs font-bold text-gray-900 bg-gray-50 px-2 py-1 rounded border border-gray-200">
                        {Number(netTotal || 0).toLocaleString('en-IN')}
                    </span>
                </td>

                {/* Actions */}
                {(activeTab === 'cashier' || activeTab === 'daily' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && (
                    <td className="py-4 px-6 text-right">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if (activeTab === 'cashier' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') {
                                    setPrintModalData({ row, dateRange });
                                } else {
                                    handlePrint();
                                }
                            }}
                            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-all"
                            title="Print Report"
                        >
                            <Printer size={18} />
                        </button>
                        {/* Hidden refs for printing */}
                        <div className="hidden">
                            {activeTab === 'cashier' ? (
                                <CashierReportTemplate ref={printRef} data={row} dateRange={dateRange} />
                            ) : activeTab === 'college' ? (
                                <CollegeReportTemplate ref={printRef} data={row} dateRange={dateRange} />
                            ) : activeTab === 'account' ? (
                                <AccountReportTemplate ref={printRef} data={row} dateRange={dateRange} />
                            ) : activeTab === 'feeHead' ? (
                                <FeeHeadReportTemplate ref={printRef} data={row} dateRange={dateRange} />
                            ) : (
                                <DailyReportTemplate ref={printRef} data={row} />
                            )}
                        </div>
                    </td>
                )}
            </tr>

            {/* EXPANDED CONTENT: Cashier Fee Head Breakdown */}
            {activeTab === 'cashier' && row.feeHeads && isExpanded && (
                <tr className="bg-blue-50/40">
                    <td colSpan="100%" className="p-0">
                        <div className="p-4 pl-[4.5rem] pr-6 border-b border-blue-100">
                            <div className="bg-white rounded-lg border border-blue-100 p-4 shadow-sm">
                                <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest mb-4">
                                    <FileText size={12} /> Fee Head Breakdown
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {Object.entries((row.feeHeads || []).reduce((acc, curr) => {
                                        acc[curr.name] = (acc[curr.name] || 0) + curr.amount;
                                        return acc;
                                    }, {})).map(([name, amount], i) => (
                                        <div key={i} className="flex flex-col p-3 rounded bg-gray-50 border border-gray-100">
                                            <span className="text-[9px] text-gray-500 font-bold uppercase truncate mb-1" title={name}>{name}</span>
                                            <span className="text-xs font-bold text-gray-800">₹{Number(amount).toLocaleString('en-IN')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            
                            {row.transfers && row.transfers.length > 0 && (
                                <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden mt-4 p-4">
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest mb-4">
                                        <svg className="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                        Ledger Transfers (Cashless)
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[10px] text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                                                <tr>
                                                    <th className="px-4 py-3 w-[50px]">S.No</th>
                                                    <th className="px-4 py-3">Student</th>
                                                    <th className="px-4 py-3">Reg No / PIN</th>
                                                    <th className="px-4 py-3">Receipt No</th>
                                                    <th className="px-4 py-3">Source Fee Head</th>
                                                    <th className="px-4 py-3">Target Fee Head</th>
                                                    <th className="px-4 py-3 text-right">Amount</th>
                                                    <th className="px-4 py-3">Remarks</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {row.transfers.map((t, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                                                        <td className="px-4 py-2.5 font-bold text-gray-800 uppercase">{t.studentName}</td>
                                                        <td className="px-4 py-2.5 font-mono text-gray-600">{t.pinNo || t.studentId}</td>
                                                        <td className="px-4 py-2.5 font-mono text-gray-600">{t.receiptNumber || '-'}</td>
                                                        <td className="px-4 py-2.5 text-red-600 font-medium">{t.sourceFeeHeadName} {t.sourceFeeHeadCode ? `(${t.sourceFeeHeadCode})` : ''}</td>
                                                        <td className="px-4 py-2.5 text-green-600 font-semibold">{t.targetFeeHeadName} {t.targetFeeHeadCode ? `(${t.targetFeeHeadCode})` : ''}</td>
                                                        <td className="px-4 py-2.5 text-right font-extrabold text-gray-800">₹{Number(t.amount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate" title={t.transferRemarks}>{t.transferRemarks}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}

            {/* EXPANDED CONTENT: College Cashier Breakdown */}
            {activeTab === 'college' && row.cashiers && isExpanded && (
                <tr className="bg-blue-50/40">
                    <td colSpan="100%" className="p-0">
                        <div className="p-4 pl-[4.5rem] pr-6 border-b border-blue-100 space-y-6">
                            
                            {/* Table A: College Fee Head-wise summary */}
                            {row.feeHeads && row.feeHeads.length > 0 && (
                                <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden">
                                    <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex justify-between items-center">
                                        <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest">
                                            <FileText size={12} /> Fee Head-wise Collections
                                        </h4>
                                        <span className="text-[9px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                            {row.feeHeads.length} Fee Heads
                                        </span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px] text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-semibold sticky top-0 z-10 shadow-sm">
                                                <tr>
                                                    <th className="px-4 py-3 w-[50px]">S.No</th>
                                                    <th className="px-4 py-3">Fee Head Name</th>
                                                    <th className="px-4 py-3 text-right">Cash</th>
                                                    <th className="px-4 py-3 text-right">Bank</th>
                                                    <th className="px-4 py-3 text-right">Collection</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {row.feeHeads.map((fh, fhIdx) => (
                                                    <tr key={fhIdx} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-2 text-gray-500">{fhIdx + 1}</td>
                                                        <td className="px-4 py-2 font-bold text-gray-800">{fh.name}</td>
                                                        <td className="px-4 py-2 text-right text-emerald-600">₹{Number(fh.cashAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2 text-right text-indigo-600">₹{Number(fh.bankAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2 text-right font-extrabold text-blue-900">₹{Number(fh.netTotal || 0).toLocaleString('en-IN')}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* Table B: User-wise Consolidated Collections with inline fee heads */}
                            <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden">
                                <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex justify-between items-center">
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest">
                                        <Users size={12} /> User-wise Consolidated Collections
                                    </h4>
                                    <span className="text-[9px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                        {row.cashiers.length} Cashiers
                                    </span>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-[11px] text-left">
                                        <thead className="bg-gray-50 text-gray-500 font-semibold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 w-[50px]">S.No</th>
                                                <th className="px-4 py-3">Cashier Name / Fee Heads Collected</th>
                                                <th className="px-4 py-3 text-center">Receipts</th>
                                                <th className="px-4 py-3 text-right">Cash</th>
                                                <th className="px-4 py-3 text-right">Bank</th>
                                                <th className="px-4 py-3 text-right">Collection</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {row.cashiers.map((c, i) => {
                                                const subRows = [];
                                                // Cashier Total Row
                                                subRows.push(
                                                    <tr key={`c-total-${i}`} className="bg-gray-50/50 font-semibold hover:bg-gray-100/50 transition-colors">
                                                        <td className="px-4 py-2 text-center text-gray-500">{i + 1}</td>
                                                        <td className="px-4 py-2 font-bold text-gray-800 uppercase">
                                                            {c.name} <span className="text-[9px] text-gray-400 font-medium font-mono ml-2">({c.username})</span>
                                                        </td>
                                                        <td className="px-4 py-2 text-center font-bold text-gray-700">{c.count}</td>
                                                        <td className="px-4 py-2 text-right text-emerald-600">₹{Number(c.cashAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2 text-right text-indigo-600">₹{Number(c.bankAmount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2 text-right font-extrabold text-blue-900">₹{Number(c.netTotal || 0).toLocaleString('en-IN')}</td>
                                                    </tr>
                                                );
                                                // Cashier Fee Head Breakdown
                                                if (c.feeHeads && c.feeHeads.length > 0) {
                                                    c.feeHeads.forEach((fh, fhIdx) => {
                                                        subRows.push(
                                                            <tr key={`c-fh-${i}-${fhIdx}`} className="hover:bg-gray-50 transition-colors border-none">
                                                                <td></td>
                                                                <td className="px-4 py-1.5 pl-8 text-[10px] font-bold text-gray-800">
                                                                    {fh.name}
                                                                </td>
                                                                <td></td>
                                                                <td className="px-4 py-1.5 text-right text-[10px] text-emerald-600 font-bold">₹{Number(fh.cashAmount || 0).toLocaleString('en-IN')}</td>
                                                                <td className="px-4 py-1.5 text-right text-[10px] text-indigo-600 font-bold">₹{Number(fh.bankAmount || 0).toLocaleString('en-IN')}</td>
                                                                <td className="px-4 py-1.5 text-right text-[10px] font-extrabold text-gray-900">₹{Number(fh.netTotal || 0).toLocaleString('en-IN')}</td>
                                                            </tr>
                                                        );
                                                    });
                                                }
                                                return subRows;
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {row.transfers && row.transfers.length > 0 && (
                                <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden mt-4">
                                    <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100">
                                        <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest">
                                            <svg className="w-4 h-4 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
                                            Ledger Transfers (Cashless)
                                        </h4>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[10px] text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-semibold border-b border-gray-100">
                                                <tr>
                                                    <th className="px-4 py-3 w-[50px]">S.No</th>
                                                    <th className="px-4 py-3">Student</th>
                                                    <th className="px-4 py-3">Reg No / PIN</th>
                                                    <th className="px-4 py-3">Receipt No</th>
                                                    <th className="px-4 py-3">Source Fee Head</th>
                                                    <th className="px-4 py-3">Target Fee Head</th>
                                                    <th className="px-4 py-3 text-right">Amount</th>
                                                    <th className="px-4 py-3">Cashier</th>
                                                    <th className="px-4 py-3">Remarks</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {row.transfers.map((t, idx) => (
                                                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-4 py-2.5 text-gray-400">{idx + 1}</td>
                                                        <td className="px-4 py-2.5 font-bold text-gray-800 uppercase">{t.studentName}</td>
                                                        <td className="px-4 py-2.5 font-mono text-gray-600">{t.pinNo || t.studentId}</td>
                                                        <td className="px-4 py-2.5 font-mono text-gray-600">{t.receiptNumber || '-'}</td>
                                                        <td className="px-4 py-2.5 text-red-600 font-medium">{t.sourceFeeHeadName} {t.sourceFeeHeadCode ? `(${t.sourceFeeHeadCode})` : ''}</td>
                                                        <td className="px-4 py-2.5 text-green-600 font-semibold">{t.targetFeeHeadName} {t.targetFeeHeadCode ? `(${t.targetFeeHeadCode})` : ''}</td>
                                                        <td className="px-4 py-2.5 text-right font-extrabold text-gray-800">₹{Number(t.amount || 0).toLocaleString('en-IN')}</td>
                                                        <td className="px-4 py-2.5 font-medium text-gray-700">{t.transferredByName}</td>
                                                        <td className="px-4 py-2.5 text-gray-500 max-w-[200px] truncate" title={t.transferRemarks}>{t.transferRemarks}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}

            {/* EXPANDED CONTENT: Account Fee Head Breakdown */}
            {activeTab === 'account' && row.transactions && isExpanded && (() => {
                const isGlobalRow = row.is_global || !row.college || ['N/A', 'All Colleges', 'All'].includes(String(row.college || '').trim());
                const collegeTree = {};
                if (isGlobalRow) {
                    (row.transactions || [])
                        .filter(tx => tx.transactionType === 'DEBIT' && tx.status !== 'cancelled')
                        .forEach(tx => {
                            const college = tx.college || 'Unknown College';
                            const course = tx.course || 'Unknown Course';
                            const fh = tx.feeHead || 'Unknown';
                            const amt = tx.amount || 0;
                            const isCash = tx.paymentMode === 'Cash';
                            if (!collegeTree[college]) collegeTree[college] = { college, cash: 0, bank: 0, total: 0, courses: {} };
                            const c = collegeTree[college];
                            c.total += amt;
                            if (isCash) c.cash += amt; else c.bank += amt;
                            if (!c.courses[course]) c.courses[course] = { course, cash: 0, bank: 0, total: 0, feeHeads: {} };
                            const co = c.courses[course];
                            co.total += amt;
                            if (isCash) co.cash += amt; else co.bank += amt;
                            if (!co.feeHeads[fh]) co.feeHeads[fh] = { name: fh, cash: 0, bank: 0, total: 0 };
                            const f = co.feeHeads[fh];
                            f.total += amt;
                            if (isCash) f.cash += amt; else f.bank += amt;
                        });
                }
                const colleges = Object.values(collegeTree)
                    .map(c => ({
                        ...c,
                        courses: Object.values(c.courses)
                            .map(co => ({ ...co, feeHeads: Object.values(co.feeHeads).sort((a, b) => b.total - a.total) }))
                            .sort((a, b) => b.total - a.total)
                    }))
                    .sort((a, b) => b.total - a.total);

                return (
                <tr className="bg-blue-50/40">
                    <td colSpan="100%" className="p-0">
                        <div className="p-4 pl-[4.5rem] pr-6 border-b border-blue-100 space-y-4">
                            {isGlobalRow && colleges.length > 0 && (
                                <div className="bg-white rounded-lg border border-purple-100 p-4 shadow-sm">
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-purple-900 uppercase tracking-widest mb-4">
                                        <Landmark size={12} /> College-wise Consolidated Collections
                                    </h4>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px] text-left">
                                            <thead className="bg-gray-50 text-gray-500 font-semibold">
                                                <tr>
                                                    <th className="px-3 py-2">College / Course / Fee Head</th>
                                                    <th className="px-3 py-2 text-right">Collection</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {colleges.map((college, ci) => (
                                                    <Fragment key={`c-${ci}`}>
                                                        <tr className="bg-gray-100 font-bold">
                                                            <td className="px-3 py-2 uppercase text-gray-900">{college.college}</td>
                                                            <td className="px-3 py-2 text-right text-blue-900">₹{Number(college.total).toLocaleString('en-IN')}</td>
                                                        </tr>
                                                        {college.courses.map((course, coi) => (
                                                            <Fragment key={`co-${ci}-${coi}`}>
                                                                <tr className="bg-gray-50/80 font-semibold">
                                                                    <td className="px-3 py-1.5 pl-6 uppercase text-gray-800">- {course.course}</td>
                                                                    <td className="px-3 py-1.5 text-right text-blue-900">₹{Number(course.total).toLocaleString('en-IN')}</td>
                                                                </tr>
                                                                {course.feeHeads.map((fh, fi) => (
                                                                    <tr key={`fh-${ci}-${coi}-${fi}`} className="hover:bg-gray-50">
                                                                        <td className="px-3 py-1 pl-10 text-gray-700">{fh.name}</td>
                                                                        <td className="px-3 py-1 text-right font-bold text-gray-900">₹{Number(fh.total).toLocaleString('en-IN')}</td>
                                                                    </tr>
                                                                ))}
                                                            </Fragment>
                                                        ))}
                                                    </Fragment>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            <div className="bg-white rounded-lg border border-blue-100 p-4 shadow-sm">
                                <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest mb-4">
                                    <FileText size={12} /> Fee Head Breakdown
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                                    {Object.entries(
                                        (row.transactions || [])
                                            .filter(tx => tx.transactionType === 'DEBIT' && tx.status !== 'cancelled')
                                            .reduce((acc, curr) => {
                                                const fhName = curr.feeHead || 'Unknown';
                                                acc[fhName] = (acc[fhName] || 0) + (curr.amount || 0);
                                                return acc;
                                            }, {})
                                    ).map(([name, amount], i) => (
                                        <div key={i} className="flex flex-col p-3 rounded bg-gray-50 border border-gray-100">
                                            <span className="text-[9px] text-gray-500 font-bold uppercase truncate mb-1" title={name}>{name}</span>
                                            <span className="text-xs font-bold text-gray-800">₹{Number(amount).toLocaleString('en-IN')}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
                );
            })()}

            {/* EXPANDED CONTENT: Daily Transactions List */}
            {activeTab === 'daily' && row.transactions && isExpanded && (
                <tr className="bg-blue-50/40">
                    <td colSpan="100%" className="p-0">
                        <div className="p-4 pl-[4.5rem] pr-6 border-b border-blue-100">
                            <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden">
                                <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex justify-between items-center">
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest">
                                        <CreditCard size={12} /> Transaction Details
                                    </h4>
                                    <span className="text-[9px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                        {row.transactions.length} Records
                                    </span>
                                </div>
                                <div className="overflow-x-auto max-h-[400px] scrollbar-thin scrollbar-thumb-gray-200">
                                    <table className="w-full text-[11px] text-left">
                                        <thead className="bg-gray-50 text-gray-500 font-semibold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 whitespace-nowrap">Receipt #</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Student Name</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Pin No</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Course / Branch</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Year</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Mode</th>
                                                <th className="px-4 py-3 text-right whitespace-nowrap">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {row.transactions.map((tx, i) => (
                                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-2 font-mono text-gray-500">{tx.receiptNo || '-'}</td>
                                                    <td className="px-4 py-2 font-bold text-gray-800">{tx.studentName}</td>
                                                    {/* Updated Pin No Access: Verify backend sends 'pinNo' */}
                                                    <td className="px-4 py-2 text-gray-600 font-mono">{tx.pinNo || '-'}</td>
                                                    <td className="px-4 py-2 text-gray-600">
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-100 border border-gray-200 mr-1">{tx.course}</span>
                                                        {tx.branch}
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-600">{tx.studentYear}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border ${tx.paymentMode === 'Cash' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                                                            {tx.paymentMode === 'Cash' ? <Wallet size={8} /> : <Landmark size={8} />}
                                                            {tx.paymentMode}
                                                        </span>
                                                    </td>
                                                    <td className={`px-4 py-2 text-right font-bold ${tx.transactionType === 'CREDIT' ? 'text-purple-600' : 'text-gray-900'}`}>
                                                        {tx.transactionType === 'CREDIT' ? '-' : ''}{Number(tx.amount).toLocaleString('en-IN')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}

            {/* EXPANDED CONTENT: Fee Head Transactions List */}
            {activeTab === 'feeHead' && row.transactions && isExpanded && (
                <tr className="bg-blue-50/40">
                    <td colSpan="100%" className="p-0">
                        <div className="p-4 pl-[4.5rem] pr-6 border-b border-blue-100">
                            <div className="bg-white rounded-lg border border-blue-100 shadow-sm overflow-hidden">
                                <div className="bg-blue-50/50 px-4 py-3 border-b border-blue-100 flex justify-between items-center">
                                    <h4 className="flex items-center gap-2 text-[11px] font-bold text-blue-900 uppercase tracking-widest">
                                        <FileText size={12} /> Transaction Details
                                    </h4>
                                    <span className="text-[9px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                                        {row.transactions.filter(tx => tx.status !== 'cancelled').length} Records
                                    </span>
                                </div>
                                <div className="overflow-x-auto max-h-[400px] scrollbar-thin scrollbar-thumb-gray-200">
                                    <table className="w-full text-[11px] text-left">
                                        <thead className="bg-gray-50 text-gray-500 font-semibold sticky top-0 z-10 shadow-sm">
                                            <tr>
                                                <th className="px-4 py-3 whitespace-nowrap">Date</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Receipt #</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Student Name</th>
                                                <th className="px-4 py-3 whitespace-nowrap">PIN</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Course</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Branch</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Year</th>
                                                <th className="px-4 py-3 whitespace-nowrap">Mode</th>
                                                <th className="px-4 py-3 text-right whitespace-nowrap">Amount</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {row.transactions.filter(tx => tx.status !== 'cancelled').map((tx, i) => (
                                                <tr key={i} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-4 py-2 text-gray-500 text-[10px] whitespace-nowrap">{(() => { try { const d = tx.paymentDate || tx.createdAt; return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-'; } catch { return '-'; } })()}</td>
                                                    <td className="px-4 py-2 font-mono text-gray-500">{tx.receiptNo || '-'}</td>
                                                    <td className="px-4 py-2 font-bold text-gray-800">{tx.studentName}</td>
                                                    <td className="px-4 py-2 text-gray-600 font-mono">{tx.pinNo || '-'}</td>
                                                    <td className="px-4 py-2 text-gray-600">
                                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-gray-100 border border-gray-200">{tx.course || '-'}</span>
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-600 text-[10px]">{tx.branch || '-'}</td>
                                                    <td className="px-4 py-2 text-gray-600">{tx.studentYear || '-'}</td>
                                                    <td className="px-4 py-2">
                                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border ${tx.paymentMode === 'Cash' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
                                                            {tx.paymentMode === 'Cash' ? <Wallet size={8} /> : <Landmark size={8} />}
                                                            {tx.paymentMode}
                                                        </span>
                                                    </td>
                                                    <td className={`px-4 py-2 text-right font-bold ${tx.transactionType === 'CREDIT' ? 'text-purple-600' : 'text-gray-900'}`}>
                                                        {tx.transactionType === 'CREDIT' ? '-' : ''}{Number(tx.amount).toLocaleString('en-IN')}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>
            )}
        </React.Fragment>
    );
};

const formatDateDDMMYYYY = (rawDate) => {
    if (!rawDate) return '-';
    try {
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) {
            if (typeof rawDate === 'string' && rawDate.includes('-')) {
                const parts = rawDate.split('T')[0].split('-');
                if (parts.length === 3 && parts[0].length === 4) {
                    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
                }
            }
            return String(rawDate);
        }
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}/${month}/${year}`;
    } catch (e) {
        return String(rawDate);
    }
};

const formatLocalYYYYMMDD = (d = new Date()) => {
    const date = new Date(d);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const Reports = () => {
    const [activeTab, setActiveTab] = useState('daily');
    const [startDate, setStartDate] = useState(formatLocalYYYYMMDD());
    const [endDate, setEndDate] = useState(formatLocalYYYYMMDD());
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [summary, setSummary] = useState({ totalConfirm: 0, count: 0 });
    const [expandedRows, setExpandedRows] = useState([]);
    const [printModalData, setPrintModalData] = useState(null);
    const [printGenerating, setPrintGenerating] = useState(false);
    const [printOptions, setPrintOptions] = useState({
        mode: 'all',
        showSummary: true,
        showDetails: true,
        includeCash: true,
        includeBank: true,
    });

    // --- Fee Head Groups Filtering ---
    const [feeGroups, setFeeGroups] = useState([]);
    const [selectedFeeGroupId, setSelectedFeeGroupId] = useState('');

    const buildPrintOptions = () => {
        const includeCash = printOptions.includeCash !== false;
        const includeBank = printOptions.includeBank !== false;
        let mode = 'all';
        if (includeCash && !includeBank) mode = 'Cash';
        else if (!includeCash && includeBank) mode = 'Online';
        else if (!includeCash && !includeBank) mode = 'none';

        const selectedGroup = feeGroups.find((g) => g._id === selectedFeeGroupId);
        return {
            ...printOptions,
            mode,
            includeCash,
            includeBank,
            selectedGroupName: selectedGroup?.name,
            allowedFeeHeads: selectedGroup
                ? selectedGroup.feeHeads.map((fh) => (fh.name || fh).toString().trim().toLowerCase())
                : null,
        };
    };

    const updatePaymentFilter = (key, checked) => {
        setPrintOptions((prev) => {
            const next = { ...prev, [key]: checked };
            const includeCash = key === 'includeCash' ? checked : next.includeCash !== false;
            const includeBank = key === 'includeBank' ? checked : next.includeBank !== false;
            if (includeCash && includeBank) next.mode = 'all';
            else if (includeCash) next.mode = 'Cash';
            else if (includeBank) next.mode = 'Online';
            else next.mode = 'none';
            return next;
        });
    };

    const formatCurrency = (value) => {
        return Number(value || 0).toLocaleString('en-IN');
    };

    const sanitizeSheetName = (name) => {
        const cleaned = String(name || 'Sheet').replace(/[\[\]\*\/\\\?\:]/g, ' ').slice(0, 31).trim();
        return cleaned || 'Sheet';
    };

    const downloadAccountExcel = (accountRow, options, dateRange) => {
        const mode = options.mode || 'all';
        const includeCash = options.includeCash !== undefined ? options.includeCash : mode === 'all' || mode === 'Cash';
        const includeBank = options.includeBank !== undefined ? options.includeBank : mode === 'all' || mode === 'Online';
        const showSummary = options.showSummary !== false;
        const showDetails = options.showDetails !== false;

        const activeTransactions = (accountRow.transactions || []).filter(tx => tx.status !== 'cancelled');
        const filteredTransactions = activeTransactions.filter(tx => {
            if (mode === 'none') return false;
            if (mode === 'Cash' && tx.paymentMode !== 'Cash') return false;
            if (mode === 'Online' && tx.paymentMode === 'Cash') return false;
            if (options.allowedFeeHeads && options.allowedFeeHeads.length > 0) {
                const fhName = (tx.feeHead || tx.feeHeadName || '').toString().trim().toLowerCase();
                if (!options.allowedFeeHeads.includes(fhName)) return false;
            }
            return true;
        });

        const totalReceipts = filteredTransactions.length;
        const collectionDebits = filteredTransactions.filter(tx => tx.transactionType === 'DEBIT' && !isRtfTransaction(tx));
        const cashAmount = collectionDebits.filter(tx => isCashCollectionTx(tx)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
        const bankAmount = collectionDebits.filter(tx => isBankCollectionTx(tx)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
        const concessionAmount = filteredTransactions.filter(tx => tx.transactionType === 'CREDIT').reduce((sum, tx) => sum + (tx.amount || 0), 0);
        const debitTotal = cashAmount + bankAmount;

        const feeHeadMap = {};
        collectionDebits.forEach(tx => {
            const head = tx.feeHead || 'Unknown';
            if (!feeHeadMap[head]) feeHeadMap[head] = { name: head, cash: 0, bank: 0, total: 0 };
            const entry = feeHeadMap[head];
            const amount = tx.amount || 0;
            entry.total += amount;
            if (isCashCollectionTx(tx)) entry.cash += amount;
            else if (isBankCollectionTx(tx)) entry.bank += amount;
        });
        const sortedFeeHeads = Object.values(feeHeadMap).sort((a, b) => b.total - a.total);

        const courseSummary = {};
        const userSummary = {};
        const courseGroups = {};

        filteredTransactions.forEach(tx => {
            const courseName = tx.course || 'Unknown Course';
            if (!courseGroups[courseName]) courseGroups[courseName] = [];
            courseGroups[courseName].push(tx);

            if (!courseSummary[courseName]) courseSummary[courseName] = { receipts: 0, total: 0 };
            courseSummary[courseName].receipts += 1;
            if (!isRtfTransaction(tx) || tx.transactionType === 'CREDIT') {
                courseSummary[courseName].total += tx.amount || 0;
            }

            const userKey = (tx.collectedBy || tx.collectedByName || 'Unknown').trim();
            if (!userSummary[userKey]) userSummary[userKey] = { userId: tx.collectedBy || '', name: tx.collectedByName || tx.collectedBy || 'Unknown', receipts: 0, total: 0 };
            userSummary[userKey].receipts += 1;
            if (!isRtfTransaction(tx) || tx.transactionType === 'CREDIT') {
                userSummary[userKey].total += tx.amount || 0;
            }
        });

        const workbook = XLSX.utils.book_new();
        const fileName = `${(accountRow.account_name || 'AccountReport').replace(/\s+/g, '_')}_${dateRange.start}_${dateRange.end}`.replace(/[^ -]/g, '');

        if (showSummary) {
            const scopeValue = accountRow.is_global ? 'Global Account' : `${accountRow.college || 'N/A'} / ${accountRow.course || 'All Courses'}`;
            const groupInfo = options.selectedGroupName ? ` | GROUP: ${options.selectedGroupName.toUpperCase()}` : '';
            const summaryRows = [
                ['ACCOUNT COLLECTION SUMMARY'],
                [String(accountRow.account_name || '').toUpperCase() || ''],
                [`BANK: ${accountRow.bank_name || ''} | AC NO: ${accountRow.account_number || ''} | SCOPE: ${scopeValue} | DATE RANGE: ${dateRange.start} to ${dateRange.end}${groupInfo}`],
                [],
                ['SUMMARY METRIC', 'VALUE'],
                ['TOTAL RECEIPTS', totalReceipts],
            ];
            if (includeCash) summaryRows.push(['Cash Collection', cashAmount]);
            if (includeBank) summaryRows.push(['Bank / Online Collection', bankAmount]);
            summaryRows.push(['Concession / Credit', concessionAmount]);
            summaryRows.push(['Net Total (Debit)', debitTotal]);

            summaryRows.push([], ['COURSE-WISE CONSOLIDATED COLLECTIONS'], ['S.NO', 'COURSE', 'RECEIPTS', 'COLLECTION']);
            Object.entries(courseSummary).sort(([, a], [, b]) => b.total - a.total).forEach(([course, stats], idx) => {
                summaryRows.push([idx + 1, course, stats.receipts, stats.total]);
            });

            summaryRows.push([], ['USER-WISE CONSOLIDATED COLLECTIONS'], ['S.NO', 'USER ID', 'CASHIER NAME', 'RECEIPTS', 'COLLECTION']);
            Object.values(userSummary).sort((a, b) => b.total - a.total).forEach((user, idx) => {
                summaryRows.push([idx + 1, user.userId, user.name, user.receipts, user.total]);
            });

            const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
            summarySheet['!merges'] = [
                { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
                { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
                { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } }
            ];
            summarySheet['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
            // Center and bold the top title rows so the heading appears in the middle,
            // and bold any detected table header rows.
            try {
                // Bold and center title rows A1..A3
                ['A1', 'A2', 'A3'].forEach((cell) => {
                    if (summarySheet[cell]) {
                        summarySheet[cell].s = summarySheet[cell].s || {};
                        summarySheet[cell].s.font = Object.assign({}, summarySheet[cell].s.font, { bold: true, sz: 14 });
                        summarySheet[cell].s.alignment = Object.assign({}, summarySheet[cell].s.alignment, { horizontal: 'center', vertical: 'center' });
                    }
                });

                // Detect header rows in the original aoa and bold them across present columns
                const headerMarkers = ['summary metric', 's.no', 'user-wise consolidated collections', 'course-wise consolidated collections', 'receipt no', 'date', 'course', 'receipts', 'collection', 'cashier name', 'user id'];
                const maxCol = Math.max(...summaryRows.map(r => (Array.isArray(r) ? r.length : 0)));
                summaryRows.forEach((r, ri) => {
                    if (Array.isArray(r) && r.length > 0) {
                        const first = String(r[0] || '').trim().toLowerCase();
                        const hasHeaderKeyword = headerMarkers.some(h => first === h || r.some(cell => String(cell || '').trim().toLowerCase() === h));
                        if (hasHeaderKeyword) {
                            for (let c = 0; c < maxCol; c++) {
                                const cellAddr = XLSX.utils.encode_cell({ r: ri, c });
                                if (summarySheet[cellAddr]) {
                                    summarySheet[cellAddr].s = summarySheet[cellAddr].s || {};
                                    summarySheet[cellAddr].s.font = Object.assign({}, summarySheet[cellAddr].s.font, { bold: true });
                                }
                            }
                        }
                    }
                });
            } catch (e) {
                // If styling isn't supported in the installed xlsx version, ignore.
            }
            XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName('Summary Abstract'));
        }

        if (showDetails) {
            Object.entries(courseGroups).sort(([, a], [, b]) => b.length - a.length).forEach(([courseName, courseTxs]) => {
                const courseRows = [['ACCOUNT COLLECTION SUMMARY'], [String(courseName || '').toUpperCase()], ['RECEIPT NO', 'DATE', 'STUDENT NAME', 'PIN NO', 'ADMISSION NO', 'COLLEGE', 'COURSE', 'YEAR', 'PAYMENT MODE', 'FEE HEAD', 'AMOUNT', 'ONLINE UTR NO', 'REMARKS']];
                courseTxs.forEach(tx => {
                    const formattedDate = formatDateDDMMYYYY(tx.paymentDate || tx.createdAt || tx.transactionDate || tx.date);

                    const pinVal = (!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? '-' : tx.pinNo;
                    const admVal = tx.admissionNumber || tx.studentId || '-';
                    const utrVal = tx.referenceNo || tx.onlineUtrNumber || tx.utrNo || tx.utr || tx.gatewayPaymentId || '-';
                    const remarkVal = tx.remarks || tx.cancellationReason || tx.transferRemarks || '';

                    courseRows.push([
                        tx.receiptNo || tx.receiptNumber || '',
                        formattedDate,
                        tx.studentName || tx.name || '',
                        pinVal,
                        admVal,
                        tx.college || '',
                        tx.course || '',
                        tx.year || tx.studentYear || '',
                        tx.paymentMode || '',
                        tx.feeHead || '',
                        tx.amount || 0,
                        utrVal,
                        remarkVal
                    ]);
                });
                // Append totals row for this course
                const totalReceipts = courseTxs.length;
                const totalCollection = courseTxs.reduce((s, t) => s + (t.amount || 0), 0);
                courseRows.push([]);
                courseRows.push(['', 'Totals', `Receipts: ${totalReceipts}`, '', '', '', '', '', '', 'Collection', totalCollection, '', '']);

                const courseSheet = XLSX.utils.aoa_to_sheet(courseRows);
                courseSheet['!merges'] = [
                    { s: { r: 0, c: 0 }, e: { r: 0, c: 12 } },
                    { s: { r: 1, c: 0 }, e: { r: 1, c: 12 } }
                ];
                // Bold header row (row index 2) and the totals row (last row)
                try {
                    const headerRowIndex = 2;
                    const maxCol = Math.max(...courseRows.map(r => (Array.isArray(r) ? r.length : 0)));
                    for (let c = 0; c < maxCol; c++) {
                        const addr = XLSX.utils.encode_cell({ r: headerRowIndex, c });
                        if (courseSheet[addr]) {
                            courseSheet[addr].s = courseSheet[addr].s || {};
                            courseSheet[addr].s.font = Object.assign({}, courseSheet[addr].s.font, { bold: true });
                        }
                    }
                    const totalsRowIndex = courseRows.length - 1;
                    for (let c = 0; c < maxCol; c++) {
                        const addr = XLSX.utils.encode_cell({ r: totalsRowIndex, c });
                        if (courseSheet[addr]) {
                            courseSheet[addr].s = courseSheet[addr].s || {};
                            courseSheet[addr].s.font = Object.assign({}, courseSheet[addr].s.font, { bold: true });
                        }
                    }
                } catch (e) {}

                courseSheet['!cols'] = [{ wch: 16 }, { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 24 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];
                XLSX.utils.book_append_sheet(workbook, courseSheet, sanitizeSheetName(courseName));
            });
        }

        XLSX.writeFile(workbook, `${fileName}.xlsx`);
    };

    const buildCashierDetailedSheet = (transactionsList, cashierName, cashierUsername, empNo, options) => {
        const mode = options.mode || 'all';
        const includeCash = options.includeCash !== undefined ? options.includeCash : mode === 'all' || mode === 'Cash';
        const includeBank = options.includeBank !== undefined ? options.includeBank : mode === 'all' || mode === 'Online';

        const filteredTxs = transactionsList.filter(tx => {
            if (tx.status === 'cancelled') return false;
            if (mode === 'none') return false;
            if (mode === 'Cash' && tx.paymentMode !== 'Cash') return false;
            if (mode === 'Online' && tx.paymentMode === 'Cash') return false;
            if (options.allowedFeeHeads && options.allowedFeeHeads.length > 0) {
                const fhName = (tx.feeHead || tx.feeHeadName || '').toString().trim().toLowerCase();
                if (!options.allowedFeeHeads.includes(fhName)) return false;
            }
            return true;
        });

        const groupInfo = options.selectedGroupName ? ` | GROUP: ${options.selectedGroupName.toUpperCase()}` : '';
        const sheetRows = [
            ['CASHIER COLLECTION DETAIL'],
            [`CASHIER: ${String(cashierName).toUpperCase()} | EMP NO: ${empNo || ''}${groupInfo}`],
        ];

        // Group by College, then Course
        const grouped = {};
        filteredTxs.forEach(tx => {
            const col = tx.college || 'Unknown College';
            const course = tx.course || 'Unknown Course';
            if (!grouped[col]) grouped[col] = {};
            if (!grouped[col][course]) {
                grouped[col][course] = { cash: [], bank: [], rtf: [] };
            }
            if (tx.paymentMode === 'Cash') {
                grouped[col][course].cash.push(tx);
            } else if (isRtfTransaction(tx)) {
                grouped[col][course].rtf.push(tx);
            } else {
                grouped[col][course].bank.push(tx);
            }
        });

        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } }
        ];

        const collegeHeaderRowIndexes = [];
        const courseHeaderRowIndexes = [];
        const sectionHeaderRowIndexes = [];
        const tableHeaderRowIndexes = [];
        const subTotalRowIndexes = [];
        const courseTotalRowIndexes = [];

        const sortedColleges = Object.keys(grouped).sort();

        sortedColleges.forEach(college => {
            sheetRows.push([]); // blank row
            const colRowIdx = sheetRows.length;
            collegeHeaderRowIndexes.push(colRowIdx);
            sheetRows.push([`COLLEGE: ${String(college).toUpperCase()}`]);
            merges.push({ s: { r: colRowIdx, c: 0 }, e: { r: colRowIdx, c: 10 } });

            const courses = grouped[college];
            const sortedCourses = Object.keys(courses).sort();

            sortedCourses.forEach(course => {
                const crsRowIdx = sheetRows.length;
                courseHeaderRowIndexes.push(crsRowIdx);
                sheetRows.push([`  Course: ${String(course).toUpperCase()}`]);
                merges.push({ s: { r: crsRowIdx, c: 0 }, e: { r: crsRowIdx, c: 10 } });

                const { cash, bank, rtf = [] } = courses[course];
                const hasCash = includeCash && cash.length > 0;
                const hasBank = includeBank && bank.length > 0;
                const hasRtf = includeBank && rtf.length > 0;

                const tableHeaders = ['S.NO', 'RECEIPT NO', 'DATE', 'STUDENT NAME', 'PIN NO', 'YEAR', 'PAYMENT MODE', 'FEE HEAD', 'AMOUNT', 'CASHIER ID', 'CASHIER NAME'];

                if (hasCash) {
                    const secRowIdx = sheetRows.length;
                    sectionHeaderRowIndexes.push(secRowIdx);
                    sheetRows.push([`    Cash Transactions (${cash.length})`]);
                    merges.push({ s: { r: secRowIdx, c: 0 }, e: { r: secRowIdx, c: 10 } });

                    const tblRowIdx = sheetRows.length;
                    tableHeaderRowIndexes.push(tblRowIdx);
                    sheetRows.push(tableHeaders);

                    cash.forEach((tx, idx) => {
                        const cEmp = tx.cashierEmpNo || empNo || tx.empNo || '';
                        const cName = tx.cashierName || cashierName || tx.collectedByName || '';

                        sheetRows.push([
                            idx + 1,
                            tx.receiptNo || tx.receiptNumber || '',
                            formatDateDDMMYYYY(tx.paymentDate || tx.createdAt || tx.transactionDate || tx.date),
                            tx.studentName || tx.name || '',
                            (!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? tx.studentId || '-' : tx.pinNo,
                            tx.year || tx.studentYear || '',
                            tx.paymentMode || '',
                            tx.feeHead || '',
                            tx.amount || 0,
                            cEmp,
                            cName
                        ]);
                    });

                    const cashSub = cash.reduce((sum, t) => sum + (t.amount || 0), 0);
                    const subIdx = sheetRows.length;
                    subTotalRowIndexes.push(subIdx);
                    sheetRows.push(['', '', '', '', '', '', '', 'Cash Sub-Total', cashSub]);
                }

                if (hasBank) {
                    const secRowIdx = sheetRows.length;
                    sectionHeaderRowIndexes.push(secRowIdx);
                    sheetRows.push([`    Bank / Online Transactions (${bank.length})`]);
                    merges.push({ s: { r: secRowIdx, c: 0 }, e: { r: secRowIdx, c: 10 } });

                    const tblRowIdx = sheetRows.length;
                    tableHeaderRowIndexes.push(tblRowIdx);
                    sheetRows.push(tableHeaders);

                    bank.forEach((tx, idx) => {
                        const cEmp = tx.cashierEmpNo || empNo || tx.empNo || '';
                        const cName = tx.cashierName || cashierName || tx.collectedByName || '';

                        sheetRows.push([
                            idx + 1,
                            tx.receiptNo || tx.receiptNumber || '',
                            formatDateDDMMYYYY(tx.paymentDate || tx.createdAt || tx.transactionDate || tx.date),
                            tx.studentName || tx.name || '',
                            (!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? tx.studentId || '-' : tx.pinNo,
                            tx.year || tx.studentYear || '',
                            tx.paymentMode || '',
                            tx.feeHead || '',
                            tx.amount || 0,
                            cEmp,
                            cName
                        ]);
                    });

                    const bankSub = bank.reduce((sum, t) => sum + (t.amount || 0), 0);
                    const subIdx = sheetRows.length;
                    subTotalRowIndexes.push(subIdx);
                    sheetRows.push(['', '', '', '', '', '', '', 'Bank Sub-Total', bankSub]);
                }

                if (hasRtf) {
                    const secRowIdx = sheetRows.length;
                    sectionHeaderRowIndexes.push(secRowIdx);
                    sheetRows.push([`    RTF / Proceeding Transactions (${rtf.length})`]);
                    merges.push({ s: { r: secRowIdx, c: 0 }, e: { r: secRowIdx, c: 10 } });

                    const tblRowIdx = sheetRows.length;
                    tableHeaderRowIndexes.push(tblRowIdx);
                    sheetRows.push(tableHeaders);

                    rtf.forEach((tx, idx) => {
                        const cEmp = tx.cashierEmpNo || empNo || tx.empNo || '';
                        const cName = tx.cashierName || cashierName || tx.collectedByName || '';

                        sheetRows.push([
                            idx + 1,
                            tx.receiptNo || tx.receiptNumber || '',
                            formatDateDDMMYYYY(tx.paymentDate || tx.createdAt || tx.transactionDate || tx.date),
                            tx.studentName || tx.name || '',
                            (!tx.pinNo || tx.pinNo === '-' || tx.pinNo === 'null') ? tx.studentId || '-' : tx.pinNo,
                            tx.year || tx.studentYear || '',
                            tx.paymentMode || 'RTF',
                            tx.feeHead || '',
                            tx.amount || 0,
                            cEmp,
                            cName
                        ]);
                    });

                    const rtfSub = rtf.reduce((sum, t) => sum + (t.amount || 0), 0);
                    const subIdx = sheetRows.length;
                    subTotalRowIndexes.push(subIdx);
                    sheetRows.push(['', '', '', '', '', '', '', 'RTF Sub-Total', rtfSub]);
                }

                const courseTotal = [...cash, ...bank].reduce((sum, t) => sum + (t.amount || 0), 0);
                const totIdx = sheetRows.length;
                courseTotalRowIndexes.push(totIdx);
                sheetRows.push(['', '', '', '', '', '', '', 'Course Total (excl. RTF)', courseTotal]);
            });
        });

        sheetRows.push([]);
        const grandTotal = filteredTxs.filter(t => !isRtfTransaction(t)).reduce((sum, t) => sum + (t.amount || 0), 0);
        const grandIdx = sheetRows.length;
        sheetRows.push(['', '', `Total Receipts: ${filteredTxs.length}`, '', '', '', '', 'GRAND TOTAL (excl. RTF)', grandTotal]);

        const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
        sheet['!merges'] = merges;
        sheet['!cols'] = [
            { wch: 8 },  // S.NO
            { wch: 16 }, // RECEIPT NO
            { wch: 14 }, // DATE
            { wch: 26 }, // STUDENT NAME
            { wch: 12 }, // PIN NO
            { wch: 8 },  // YEAR
            { wch: 14 }, // PAYMENT MODE
            { wch: 22 }, // FEE HEAD
            { wch: 14 }, // AMOUNT
            { wch: 16 }, // CASHIER ID (empNo only)
            { wch: 18 }  // CASHIER NAME
        ];

        try {
            ['A1', 'A2'].forEach(cell => {
                if (sheet[cell]) {
                    sheet[cell].s = {
                        font: { bold: true, sz: 12 },
                        alignment: { horizontal: 'center' }
                    };
                }
            });

            collegeHeaderRowIndexes.forEach(ri => {
                const cellAddr = XLSX.utils.encode_cell({ r: ri, c: 0 });
                if (sheet[cellAddr]) {
                    sheet[cellAddr].s = {
                        font: { bold: true, sz: 11, color: { rgb: "000000" } },
                        fill: { fgColor: { rgb: "F2F2F2" } }
                    };
                }
            });

            courseHeaderRowIndexes.forEach(ri => {
                const cellAddr = XLSX.utils.encode_cell({ r: ri, c: 0 });
                if (sheet[cellAddr]) {
                    sheet[cellAddr].s = {
                        font: { bold: true, sz: 10 }
                    };
                }
            });

            sectionHeaderRowIndexes.forEach(ri => {
                const cellAddr = XLSX.utils.encode_cell({ r: ri, c: 0 });
                if (sheet[cellAddr]) {
                    sheet[cellAddr].s = {
                        font: { bold: true, italic: true, sz: 9 }
                    };
                }
            });

            tableHeaderRowIndexes.forEach(ri => {
                for (let c = 0; c < 11; c++) {
                    const cellAddr = XLSX.utils.encode_cell({ r: ri, c });
                    if (sheet[cellAddr]) {
                        sheet[cellAddr].s = {
                            font: { bold: true, sz: 9 },
                            fill: { fgColor: { rgb: "F2F2F2" } }
                        };
                    }
                }
            });

            subTotalRowIndexes.forEach(ri => {
                ['H', 'I'].forEach(colName => {
                    const cellAddr = colName + (ri + 1);
                    if (sheet[cellAddr]) {
                        sheet[cellAddr].s = { font: { bold: true } };
                    }
                });
            });

            courseTotalRowIndexes.forEach(ri => {
                ['H', 'I'].forEach(colName => {
                    const cellAddr = colName + (ri + 1);
                    if (sheet[cellAddr]) {
                        sheet[cellAddr].s = {
                            font: { bold: true }
                        };
                    }
                });
            });

            const grandAddr1 = 'H' + (grandIdx + 1);
            const grandAddr2 = 'I' + (grandIdx + 1);
            if (sheet[grandAddr1]) sheet[grandAddr1].s = { font: { bold: true, sz: 11 } };
            if (sheet[grandAddr2]) sheet[grandAddr2].s = { font: { bold: true, sz: 11 }, fill: { fgColor: { rgb: "F2F2F2" } } };

        } catch (e) {
            console.error('Error styling Cashier detailed sheet:', e);
        }

        return sheet;
    };

    const downloadCashierExcel = (printData, options, dateRange) => {
        const isAll = printData.isAll === true;
        const cashierRows = (isAll ? (printData.rows || []) : [printData.row]).filter(Boolean);
        
        if (!cashierRows.length) return;

        const mode = options.mode || 'all';
        const includeCash = options.includeCash !== undefined ? options.includeCash : mode === 'all' || mode === 'Cash';
        const includeBank = options.includeBank !== undefined ? options.includeBank : mode === 'all' || mode === 'Online';
        const showSummary = options.showSummary !== false;
        const showDetails = options.showDetails !== false;

        let totalReceipts = 0;
        let cashAmount = 0;
        let bankAmount = 0;
        let concessionAmount = 0;
        let debitTotal = 0;

        const collegeSummary = {};
        const courseSummary = {};
        const cashierSummary = [];

        cashierRows.forEach(c => {
            const activeTransactions = (c.transactions || []).filter(tx => tx.status !== 'cancelled');
            const filteredTransactions = activeTransactions.filter(tx => {
                if (mode === 'none') return false;
                if (mode === 'Cash' && tx.paymentMode !== 'Cash') return false;
                if (mode === 'Online' && tx.paymentMode === 'Cash') return false;
                if (options.allowedFeeHeads && options.allowedFeeHeads.length > 0) {
                    const fhName = (tx.feeHead || tx.feeHeadName || '').toString().trim().toLowerCase();
                    if (!options.allowedFeeHeads.includes(fhName)) return false;
                }
                return true;
            });

            const cReceipts = filteredTransactions.length;
            const cCash = filteredTransactions.filter(tx => tx.transactionType === 'DEBIT' && isCashCollectionTx(tx)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
            const cBank = filteredTransactions.filter(tx => tx.transactionType === 'DEBIT' && isBankCollectionTx(tx)).reduce((sum, tx) => sum + (tx.amount || 0), 0);
            const cConcession = filteredTransactions.filter(tx => tx.transactionType === 'CREDIT').reduce((sum, tx) => sum + (tx.amount || 0), 0);
            const cDebit = cCash + cBank;

            totalReceipts += cReceipts;
            cashAmount += cCash;
            bankAmount += cBank;
            concessionAmount += cConcession;
            debitTotal += cDebit;

            const cUsername = c.transactions?.[0]?.collectedBy || c.username || '';
            const cName = c._id || '';

            cashierSummary.push({
                username: cUsername,
                name: cName,
                empNo: c.empNo || '',
                receipts: cReceipts,
                total: cDebit
            });

            filteredTransactions.forEach(tx => {
                const collegeName = tx.college || 'Unknown College';
                const courseName = tx.course || 'Unknown Course';
                const amt = (!isRtfTransaction(tx) || tx.transactionType === 'CREDIT') ? (tx.amount || 0) : 0;

                if (!collegeSummary[collegeName]) collegeSummary[collegeName] = { receipts: 0, total: 0 };
                collegeSummary[collegeName].receipts += 1;
                collegeSummary[collegeName].total += amt;

                if (!courseSummary[courseName]) courseSummary[courseName] = { receipts: 0, total: 0 };
                courseSummary[courseName].receipts += 1;
                courseSummary[courseName].total += amt;
            });
        });

        const workbook = XLSX.utils.book_new();
        const singleCashierName = cashierRows[0]._id || 'Cashier';
        const singleCashierUsername = cashierRows[0].transactions?.[0]?.collectedBy || cashierRows[0].username || '';
        
        const fileName = isAll 
            ? `Consolidated_Cashier_Report_${dateRange.start}_${dateRange.end}`.replace(/[^a-zA-Z0-9_-]/g, '')
            : `${singleCashierName.replace(/\s+/g, '_')}_${dateRange.start}_${dateRange.end}`.replace(/[^a-zA-Z0-9_-]/g, '');

        if (showSummary) {
            const titleText = isAll ? 'CONSOLIDATED CASHIERS COLLECTION SUMMARY' : 'CASHIER COLLECTION SUMMARY';
            const groupInfo = options.selectedGroupName ? ` | GROUP: ${options.selectedGroupName.toUpperCase()}` : '';
            const subtitleText = isAll 
                ? `DATE RANGE: ${dateRange.start} to ${dateRange.end}${groupInfo}`
                : `EMP NO: ${cashierRows[0].empNo || ''} | DATE RANGE: ${dateRange.start} to ${dateRange.end}${groupInfo}`;
            
            const summaryRows = [
                [titleText],
                [isAll ? 'ALL SELECTED CASHIERS' : String(singleCashierName).toUpperCase()],
                [subtitleText],
                [],
                ['SUMMARY METRIC', 'VALUE'],
                ['TOTAL RECEIPTS', totalReceipts],
            ];
            if (includeCash) summaryRows.push(['Cash Collection', cashAmount]);
            if (includeBank) summaryRows.push(['Bank / Online Collection', bankAmount]);
            summaryRows.push(['Concession / Credit', concessionAmount]);
            summaryRows.push(['Net Total (Debit)', debitTotal]);

            if (isAll) {
                summaryRows.push([], ['CASHIER-WISE CONSOLIDATED COLLECTIONS'], ['S.NO', 'EMP NO', 'CASHIER NAME', 'RECEIPTS', 'COLLECTION']);
                cashierSummary.sort((a, b) => b.total - a.total).forEach((c, idx) => {
                    summaryRows.push([idx + 1, c.empNo || '', c.name, c.receipts, c.total]);
                });
            }

            summaryRows.push([], ['COLLEGE-WISE CONSOLIDATED COLLECTIONS'], ['S.NO', 'COLLEGE', 'RECEIPTS', 'COLLECTION']);
            Object.entries(collegeSummary).sort(([, a], [, b]) => b.total - a.total).forEach(([college, stats], idx) => {
                summaryRows.push([idx + 1, college, stats.receipts, stats.total]);
            });

            summaryRows.push([], ['COURSE-WISE CONSOLIDATED COLLECTIONS'], ['S.NO', 'COURSE', 'RECEIPTS', 'COLLECTION']);
            Object.entries(courseSummary).sort(([, a], [, b]) => b.total - a.total).forEach(([course, stats], idx) => {
                summaryRows.push([idx + 1, course, stats.receipts, stats.total]);
            });

            const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
            summarySheet['!merges'] = [
                { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
                { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
                { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } }
            ];
            summarySheet['!cols'] = [{ wch: 10 }, { wch: 32 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];

            try {
                // Bold A1..A3
                ['A1', 'A2', 'A3'].forEach((cell) => {
                    if (summarySheet[cell]) {
                        summarySheet[cell].s = summarySheet[cell].s || {};
                        summarySheet[cell].s.font = Object.assign({}, summarySheet[cell].s.font, { bold: true, sz: 14 });
                        summarySheet[cell].s.alignment = Object.assign({}, summarySheet[cell].s.alignment, { horizontal: 'center', vertical: 'center' });
                    }
                });

                const headerMarkers = ['summary metric', 's.no', 'cashier-wise consolidated collections', 'college-wise consolidated collections', 'course-wise consolidated collections', 'receipt no', 'date', 'course', 'receipts', 'collection', 'cashier name', 'user id'];
                const maxCol = Math.max(...summaryRows.map(r => (Array.isArray(r) ? r.length : 0)));
                summaryRows.forEach((r, ri) => {
                    if (Array.isArray(r) && r.length > 0) {
                        const first = String(r[0] || '').trim().toLowerCase();
                        const hasHeaderKeyword = headerMarkers.some(h => first === h || r.some(cell => String(cell || '').trim().toLowerCase() === h));
                        if (hasHeaderKeyword) {
                            for (let c = 0; c < maxCol; c++) {
                                const cellAddr = XLSX.utils.encode_cell({ r: ri, c });
                                if (summarySheet[cellAddr]) {
                                    summarySheet[cellAddr].s = summarySheet[cellAddr].s || {};
                                    summarySheet[cellAddr].s.font = Object.assign({}, summarySheet[cellAddr].s.font, { bold: true });
                                }
                            }
                        }
                    }
                });
            } catch (e) {}

            XLSX.utils.book_append_sheet(workbook, summarySheet, sanitizeSheetName('Summary Abstract'));
        }

        if (showDetails) {
            if (isAll) {
                const allTransactions = [];
                cashierRows.forEach(c => {
                    const cashierName = c._id || 'N/A';
                    const empNo = c.empNo || '';
                    const cashierUsername = c.transactions?.[0]?.collectedBy || c.username || '';
                    
                    (c.transactions || []).forEach(tx => {
                        allTransactions.push({
                            ...tx,
                            cashierName,
                            cashierEmpNo: empNo,
                            cashierUsername
                        });
                    });
                });

                const cashierSheet = buildCashierDetailedSheet(allTransactions, 'ALL CASHIERS', 'all', '', options);
                XLSX.utils.book_append_sheet(workbook, cashierSheet, sanitizeSheetName("Detailed Transactions"));
            } else {
                const singleCashier = cashierRows[0];
                const cashierName = singleCashier._id || 'Cashier';
                const cashierUsername = singleCashier.transactions?.[0]?.collectedBy || singleCashier.username || '';
                const cashierSheet = buildCashierDetailedSheet(singleCashier.transactions || [], cashierName, cashierUsername, singleCashier.empNo, options);
                XLSX.utils.book_append_sheet(workbook, cashierSheet, sanitizeSheetName("Detailed Transactions"));
            }
        }

        XLSX.writeFile(workbook, `${fileName}.xlsx`);
    };

    const [selectedCampusId, setSelectedCampusId] = useState(() => {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        if (u.campuses?.length === 1) return String(u.campuses[0]);
        return 'all';
    });
    const [colleges, setColleges] = useState([]);
    const [selectedCollege, setSelectedCollege] = useState('');
    const { campuses } = useCampuses();

    const [modalDateRange, setModalDateRange] = useState({ start: '', end: '' });
    const [modalReportData, setModalReportData] = useState(null);
    const [modalLoading, setModalLoading] = useState(false);

    const modalPrintRef = useRef(null);

    useEffect(() => {
        if (printModalData) {
            setSelectedFeeGroupId('');
            const initialStart = printModalData.dateRange?.start || printModalData.dateRange?.startDate || startDate;
            const initialEnd = printModalData.dateRange?.end || printModalData.dateRange?.endDate || endDate;
            setModalDateRange({
                start: initialStart,
                end: initialEnd
            });
            setModalReportData(printModalData);

            if (activeTab === 'account') {
                const isGlobal = printModalData.row
                    ? (printModalData.row.is_global || !printModalData.row.college || ['N/A', 'All Colleges', 'All'].includes(String(printModalData.row.college || '').trim()))
                    : printModalData?.rows?.some(r => r.is_global || !r.college || ['N/A', 'All Colleges', 'All'].includes(String(r.college || '').trim()));
                if (isGlobal) {
                    setPrintOptions(prev => ({ ...prev, includeCash: false, includeBank: true }));
                } else {
                    setPrintOptions(prev => ({ ...prev, includeCash: true, includeBank: true }));
                }
            }
        } else {
            setModalReportData(null);
            setSelectedFeeGroupId('');
        }
    }, [printModalData, activeTab]);

    useEffect(() => {
        if (!printModalData || !modalDateRange.start || !modalDateRange.end) return;

        const initStart = printModalData.dateRange?.start || printModalData.dateRange?.startDate || startDate;
        const initEnd = printModalData.dateRange?.end || printModalData.dateRange?.endDate || endDate;

        if (modalDateRange.start === initStart && modalDateRange.end === initEnd) {
            setModalReportData(printModalData);
            return;
        }

        const timer = setTimeout(async () => {
            setModalLoading(true);
            try {
                let groupBy = activeTab === 'daily' ? 'day' : activeTab;
                const res = await api.get('/reports/transactions', {
                    params: {
                        startDate: modalDateRange.start,
                        endDate: modalDateRange.end,
                        groupBy,
                        ...(selectedCampusId !== 'all' ? { campusId: selectedCampusId } : {}),
                        ...(selectedCollege ? { college: selectedCollege } : {}),
                    }
                });

                if (printModalData.isAll) {
                    setModalReportData({
                        isAll: true,
                        rows: res.data,
                        dateRange: modalDateRange
                    });
                } else {
                    const targetId = String(printModalData.row._id || '').trim().toLowerCase();
                    const targetName = String(printModalData.row.name || '').trim().toLowerCase();
                    const targetAcc = String(printModalData.row.account_name || '').trim().toLowerCase();

                    const matchedRow = res.data.find(r => {
                        const rId = String(r._id || '').trim().toLowerCase();
                        const rName = String(r.name || '').trim().toLowerCase();
                        const rAcc = String(r.account_name || '').trim().toLowerCase();
                        return (targetId && rId === targetId) ||
                               (targetName && rName === targetName) ||
                               (targetAcc && rAcc === targetAcc);
                    }) || {
                        ...printModalData.row,
                        count: 0,
                        totalCount: 0,
                        cashAmount: 0,
                        bankAmount: 0,
                        creditAmount: 0,
                        debitAmount: 0,
                        totalAmount: 0,
                        transactions: [],
                        feeHeads: []
                    };

                    setModalReportData({
                        isAll: false,
                        row: matchedRow,
                        dateRange: modalDateRange
                    });
                }
            } catch (err) {
                console.error('Error fetching date range report for modal:', err);
            } finally {
                setModalLoading(false);
            }
        }, 400);

        return () => clearTimeout(timer);
    }, [modalDateRange.start, modalDateRange.end, printModalData]);

    const activeModalData = modalReportData || printModalData;

    const handleModalPrint = async () => {
        const currentData = activeModalData || printModalData;
        if (!currentData) return;
        try {
            const template = activeTab === 'college' ? 'college-report' : activeTab === 'account' ? 'account-report' : activeTab === 'feeHead' ? 'feehead-report' : 'cashier-report';
            const options = buildPrintOptions();
            if (options.mode === 'none') {
                alert('Select at least Cash or Bank/Online to generate the report.');
                return;
            }

            setPrintGenerating(true);

            const effectiveDateRange = {
                start: modalDateRange.start || startDate,
                end: modalDateRange.end || endDate,
                startDate: modalDateRange.start || startDate,
                endDate: modalDateRange.end || endDate
            };

            const response = await api.post('/print', {
                template,
                data: {
                    displayData: currentData.isAll ? currentData.rows : currentData.row,
                    cashierData: currentData.isAll ? currentData.rows : currentData.row,
                    options,
                    dateRange: effectiveDateRange,
                    hideGeneratedInfo: true
                }
            });
            printHtmlDocument(response.data);
        } catch (err) {
            console.error('Print failed:', err);
            alert('Failed to generate print document');
        } finally {
            setPrintGenerating(false);
        }
    };

    const toggleRow = (idx) => {
        setExpandedRows(prev => prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]);
    };

    const [activePreset, setActivePreset] = useState('today'); // Default to 'today'

    // Date Presets
    const applyDatePreset = (preset) => {
        setActivePreset(preset);
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (preset) {
            case 'today':
                // defaults are already today
                break;
            case 'yesterday':
                start.setDate(today.getDate() - 1);
                end.setDate(today.getDate() - 1);
                break;
            case 'week':
                start.setDate(today.getDate() - 7);
                break;
            case 'month':
                start = new Date(today.getFullYear(), today.getMonth(), 1);
                break;
            case 'lastMonth':
                start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                end = new Date(today.getFullYear(), today.getMonth(), 0);
                break;
            default:
                break;
        }
        setStartDate(formatLocalYYYYMMDD(start));
        setEndDate(formatLocalYYYYMMDD(end));
    };

    const handleDateChange = (type, value) => {
        if (type === 'start') setStartDate(value);
        else setEndDate(value);
        setActivePreset('custom'); // clear preset if user manually changes date
    };

    const fetchReport = async () => {
        setLoading(true);
        setExpandedRows([]);
        try {
            let groupBy = activeTab;
            if (activeTab === 'daily') groupBy = 'day';
            else if (activeTab === 'cashier') groupBy = 'cashier';
            else if (activeTab === 'college') groupBy = 'college';
            else if (activeTab === 'account') groupBy = 'account';
            else if (activeTab === 'feeHead') groupBy = 'feeHead';

            const res = await api.get(`/reports/transactions`, {
                params: {
                    startDate,
                    endDate,
                    groupBy: groupBy === 'daily' ? 'day' : groupBy,
                    ...(selectedCampusId !== 'all' ? { campusId: selectedCampusId } : {}),
                    ...(selectedCollege ? { college: selectedCollege } : {}),
                }
            });
            setData(res.data);

            const tot = res.data.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
            const cnt = res.data.reduce((acc, curr) => acc + (curr.count || curr.totalCount || 0), 0);

            // New Summaries based on Debit Amount (Real Collection)
            const debitSum = res.data.reduce((acc, curr) => acc + (curr.debitAmount || 0), 0);
            const creditSum = res.data.reduce((acc, curr) => acc + (curr.creditAmount || 0), 0);
            const cash = res.data.reduce((acc, curr) => acc + (curr.cashAmount || 0), 0);
            const bank = res.data.reduce((acc, curr) => acc + (curr.bankAmount || 0), 0);

            // Use Debit Sum as the main "Total Collected" metric
            setSummary({ totalConfirm: debitSum, count: cnt, totalCash: cash, totalBank: bank, totalCredit: creditSum });

        } catch (error) {
            console.error(error);
            if (error.response?.status === 403) {
                alert('You do not have permission to view this report. Ensure Reports access is enabled in User Management.');
            }
        } finally {
            setLoading(false);
        }
    };

    // exportToCSV was removed

    const user = JSON.parse(localStorage.getItem('user')) || {};
    const role = user.role;
    const permissions = user.permissions || [];
    const isScopedUser = role !== 'superadmin' && role !== 'admin' && (user.campuses?.length > 0 || user.colleges?.length > 0);

    const allTabs = [
        { id: 'daily', label: 'Daily Collection', permission: 'reports_daily_collection' },
        { id: 'cashier', label: 'Cashiers', permission: 'reports_cashier_summary' },
        { id: 'college', label: 'College-wise', permission: 'reports_fee_head_summary' },
        { id: 'account', label: 'Account-wise', permission: 'reports_account_wise' },
        { id: 'feeHead', label: 'Fee Head-wise', permission: 'reports_fee_head_summary' },
    ];

    const reportSubPermissions = ['reports_daily_collection', 'reports_cashier_summary', 'reports_fee_head_summary', 'reports_account_wise'];
    const hasGranularReportPerms = reportSubPermissions.some((p) => permissions.includes(p));

    const tabs = role === 'superadmin' || role === 'admin'
        ? allTabs
        : allTabs.filter((tab) =>
            permissions.includes(tab.permission) ||
            (permissions.includes('/reports') && !hasGranularReportPerms)
        );

    // Fetch fee groups and colleges on mount
    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                const [feeGroupsRes, metaRes] = await Promise.all([
                    api.get('/fee-groups'),
                    api.get('/students/metadata')
                ]);
                setFeeGroups(feeGroupsRes.data);
                const meta = metaRes.data.hierarchy || metaRes.data;
                setColleges(Object.keys(meta) || []);
            } catch (err) {
                console.error("Error fetching initial data in reports page", err);
            }
        };
        fetchInitialData();
    }, []);

    useEffect(() => {
        // Automatically switch to the first available tab if the active one isn't permitted
        if (tabs.length > 0 && !tabs.find(t => t.id === activeTab)) {
            setActiveTab(tabs[0].id);
        }
    }, [tabs, activeTab]);

    useEffect(() => {
        // Only fetch if tab is valid
        if (tabs.length > 0 && tabs.find(t => t.id === activeTab)) {
            fetchReport();
        }
    }, [activeTab, startDate, endDate, selectedCampusId, selectedCollege]);

    return (
        <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
            <Sidebar />

            <div className="flex-1 flex flex-col h-full overflow-hidden relative">

                <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
                    <header className="mb-6">
                        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-6">
                            <div>
                                <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                    <TrendingUp className="text-blue-600" size={20} /> Reports & Analytics
                                </h1>
                                <p className="text-xs text-gray-500 mt-1">Monitor financial performance and generate detailed statements.</p>
                            </div>

                            <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm self-start xl:self-auto">
                                {tabs.map((tab) => (
                                    <button
                                        key={tab.id}
                                        onClick={() => { setActiveTab(tab.id); setData([]); }}
                                        className={`
                                            px-4 py-2 rounded-md text-xs font-bold transition-all duration-300 capitalize whitespace-nowrap
                                            ${activeTab === tab.id
                                                ? 'bg-blue-600 text-white shadow-sm'
                                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}
                                        `}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </header>

                    {/* Print Options Modal */}
                    {printModalData && (() => {
                        const currentData = activeModalData || printModalData;
                        const isModalGlobalAccount = activeTab === 'account' && (
                            currentData?.row
                                ? (currentData.row.is_global || !currentData.row.college || ['N/A', 'All Colleges', 'All'].includes(String(currentData.row.college || '').trim()))
                                : currentData?.rows?.some(r => r.is_global || !r.college || ['N/A', 'All Colleges', 'All'].includes(String(r.college || '').trim()))
                        );

                        return (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 overflow-hidden animate-in zoom-in-95 duration-200 relative">
                                <button 
                                    onClick={() => setPrintModalData(null)}
                                    disabled={printGenerating}
                                    className={`absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors active:scale-95 z-10 ${printGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    aria-label="Close modal"
                                >
                                    <X size={18} />
                                </button>
                                <div className="p-6">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                                            <Printer size={24} />
                                        </div>
                                        <div>
                                            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                                                {currentData.isAll 
                                                    ? (activeTab === 'cashier' ? 'Print All Cashier Reports' : activeTab === 'college' ? 'Print All College Reports' : activeTab === 'feeHead' ? 'Print All Fee Head Reports' : 'Print All Account Reports') 
                                                    : (activeTab === 'cashier' ? 'Print Cashier Report' : activeTab === 'college' ? 'Print College Report' : activeTab === 'feeHead' ? 'Print Fee Head Report' : 'Print Account Report')}
                                                {modalLoading && <span className="text-[10px] text-blue-600 animate-pulse font-semibold">Updating...</span>}
                                            </h3>
                                            <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">
                                                {currentData.isAll 
                                                    ? (activeTab === 'cashier' ? 'Combined Cashier Summaries' : activeTab === 'college' ? 'Combined College Summaries' : activeTab === 'feeHead' ? 'Combined Fee Head Summaries' : 'Combined Account Summaries') 
                                                    : (activeTab === 'cashier' ? `Cashier: ${currentData.row?._id || 'N/A'}` : activeTab === 'college' ? `College: ${currentData.row?._id || 'N/A'}` : activeTab === 'feeHead' ? `Fee Head: ${currentData.row?.name || 'N/A'}` : `Account: ${currentData.row?.account_name || 'N/A'}`)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="space-y-6">

                                         {/* Report Date Range Selection */}
                                         <div className="space-y-2">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                 <span className="flex items-center gap-1.5"><Calendar size={12} className="text-blue-600" /> Report Date Range</span>
                                                 {modalLoading && <span className="text-[9px] text-blue-600 animate-pulse font-normal">Loading data for date range...</span>}
                                             </label>
                                             <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                                                 <div>
                                                     <label className="text-[10px] font-bold text-gray-500 block mb-1">From Date</label>
                                                     <input
                                                         type="date"
                                                         value={modalDateRange.start}
                                                         onChange={e => setModalDateRange(prev => ({ ...prev, start: e.target.value }))}
                                                         onKeyDown={e => e.preventDefault()}
                                                         onClick={e => e.target.showPicker?.()}
                                                         className="w-full px-2.5 py-1.5 text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                                                     />
                                                 </div>
                                                 <div>
                                                     <label className="text-[10px] font-bold text-gray-500 block mb-1">To Date</label>
                                                     <input
                                                         type="date"
                                                         value={modalDateRange.end}
                                                         onChange={e => setModalDateRange(prev => ({ ...prev, end: e.target.value }))}
                                                         onKeyDown={e => e.preventDefault()}
                                                         onClick={e => e.target.showPicker?.()}
                                                         className="w-full px-2.5 py-1.5 text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                                                     />
                                                 </div>
                                             </div>
                                         </div>

                                         {/* Printing Options Checkboxes */}
                                         <div className="space-y-3">
                                             <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Print Sections</label>
                                             
                                             {/* Summary Option */}
                                             <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                                 <input
                                                     type="checkbox"
                                                     id="printSummaryOpt"
                                                     checked={printOptions.showSummary}
                                                     onChange={e => setPrintOptions(prev => ({ ...prev, showSummary: e.target.checked }))}
                                                     className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                                 />
                                                 <label htmlFor="printSummaryOpt" className="cursor-pointer flex-1">
                                                     <p className="text-xs font-bold text-gray-800">Summary Abstract</p>
                                                     <p className="text-[9px] text-gray-500 font-medium">Include overall summary, global fee heads, and college breakdowns</p>
                                                 </label>
                                             </div>

                                             {/* Detailed View Option */}
                                             <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                                 <input
                                                     type="checkbox"
                                                     id="printDetailsOpt"
                                                     checked={printOptions.showDetails}
                                                     onChange={e => setPrintOptions(prev => ({ ...prev, showDetails: e.target.checked }))}
                                                     className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                                 />
                                                 <label htmlFor="printDetailsOpt" className="cursor-pointer flex-1">
                                                     <p className="text-xs font-bold text-gray-800">Detailed View</p>
                                                     <p className="text-[9px] text-gray-500 font-medium">Include row-by-row list of individual transactions</p>
                                                 </label>
                                             </div>

                                             {/* Payment mode filters */}
                                             {!isModalGlobalAccount && (
                                                 <div className="space-y-2 pt-2 border-t border-gray-100">
                                                     <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest block">Payment Mode</label>
                                                     <div className="grid grid-cols-2 gap-3">
                                                         <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                                             <input
                                                                 type="checkbox"
                                                                 id="printCashOpt"
                                                                 checked={printOptions.includeCash !== false}
                                                                 onChange={e => updatePaymentFilter('includeCash', e.target.checked)}
                                                                 className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                                             />
                                                             <label htmlFor="printCashOpt" className="cursor-pointer flex-1">
                                                                 <p className="text-xs font-bold text-gray-800">Cash</p>
                                                             </label>
                                                         </div>
                                                         <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                                                             <input
                                                                 type="checkbox"
                                                                 id="printBankOpt"
                                                                 checked={printOptions.includeBank !== false}
                                                                 onChange={e => updatePaymentFilter('includeBank', e.target.checked)}
                                                                 className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                                                             />
                                                             <label htmlFor="printBankOpt" className="cursor-pointer flex-1">
                                                                 <p className="text-xs font-bold text-gray-800">Bank / Online</p>
                                                             </label>
                                                         </div>
                                                     </div>
                                                 </div>
                                             )}
                                         </div>

                                         {/* Fee Head Group Filter */}
                                         {feeGroups && feeGroups.length > 0 && (
                                             <div className="space-y-2 animate-in fade-in duration-200">
                                                 <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest flex items-center justify-between">
                                                     <span className="flex items-center gap-1.5"><Filter size={12} className="text-blue-600" /> Fee Head Group Filter</span>
                                                 </label>
                                                 <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                                                     <select
                                                         value={selectedFeeGroupId}
                                                         onChange={e => setSelectedFeeGroupId(e.target.value)}
                                                         className="w-full px-2.5 py-1.5 text-xs font-bold text-gray-800 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none cursor-pointer"
                                                     >
                                                         <option value="">All Fee Heads</option>
                                                         {feeGroups.map(g => (
                                                             <option key={g._id} value={g._id}>{g.name}</option>
                                                         ))}
                                                     </select>
                                                 </div>
                                             </div>
                                         )}
                                     </div>
                                 </div>

                                 <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row gap-3 w-full">
                                     {(activeTab === 'account' || activeTab === 'cashier') && (
                                         <button
                                             onClick={() => {
                                                 const effectiveRange = {
                                                     start: modalDateRange.start || startDate,
                                                     end: modalDateRange.end || endDate
                                                 };
                                                 const curData = activeModalData || printModalData;
                                                 if (activeTab === 'account') {
                                                     downloadAccountExcel(curData.row, buildPrintOptions(), effectiveRange);
                                                 } else {
                                                     downloadCashierExcel(curData, buildPrintOptions(), effectiveRange);
                                                 }
                                             }}
                                             disabled={modalLoading || printGenerating}
                                             className={`flex-1 w-full px-4 py-2.5 rounded-xl text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 hover:bg-slate-200 transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2 ${(modalLoading || printGenerating) ? 'opacity-50 cursor-not-allowed' : ''}`}
                                         >
                                             <FileSpreadsheet size={16} /> Excel Download
                                         </button>
                                     )}
                                     <button
                                         onClick={handleModalPrint}
                                         disabled={modalLoading || printGenerating || (!printOptions.showSummary && !printOptions.showDetails) || (!isModalGlobalAccount && !printOptions.includeCash && !printOptions.includeBank)}
                                         className={`flex-1 w-full px-4 py-2.5 rounded-xl text-xs font-bold text-white transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2 ${(modalLoading || printGenerating || (!printOptions.showSummary && !printOptions.showDetails) || (!isModalGlobalAccount && !printOptions.includeCash && !printOptions.includeBank)) ? 'bg-gray-400 cursor-not-allowed shadow-none' : 'bg-gray-900 hover:bg-black shadow-gray-200'}`}
                                     >
                                         {printGenerating ? (
                                             <>
                                                 <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                     <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                     <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                 </svg>
                                                 Generating Print...
                                             </>
                                         ) : (
                                             <>
                                                 <Printer size={16} /> {modalLoading ? 'Updating Data...' : 'Generate Print'}
                                             </>
                                         )}
                                     </button>
                                 </div>
                            </div>
                        </div>
                        );
                    })()}

                    {/* Hidden template for the modal print */}
                    <div className="hidden">
                        {activeModalData && (
                            activeTab === 'college' ? (
                                <CollegeReportTemplate
                                    ref={modalPrintRef}
                                    data={activeModalData.isAll ? activeModalData.rows : activeModalData.row}
                                    options={buildPrintOptions()}
                                    dateRange={{ start: modalDateRange.start || startDate, end: modalDateRange.end || endDate }}
                                />
                            ) : activeTab === 'account' ? (
                                <AccountReportTemplate
                                    ref={modalPrintRef}
                                    data={activeModalData.isAll ? activeModalData.rows : activeModalData.row}
                                    options={buildPrintOptions()}
                                    dateRange={{ start: modalDateRange.start || startDate, end: modalDateRange.end || endDate }}
                                />
                            ) : activeTab === 'feeHead' ? (
                                <FeeHeadReportTemplate
                                    ref={modalPrintRef}
                                    data={activeModalData.isAll ? activeModalData.rows : activeModalData.row}
                                    options={buildPrintOptions()}
                                    dateRange={{ start: modalDateRange.start || startDate, end: modalDateRange.end || endDate }}
                                />
                            ) : (
                                <CashierReportTemplate
                                    ref={modalPrintRef}
                                    data={activeModalData.isAll ? activeModalData.rows : activeModalData.row}
                                    options={buildPrintOptions()}
                                    dateRange={{ start: modalDateRange.start || startDate, end: modalDateRange.end || endDate }}
                                />
                            )
                        )}
                    </div>

                    {tabs.length === 0 ? (
                        <div className="max-w-[1700px] mx-auto">
                            <div className="bg-white rounded-xl border border-amber-200 p-8 text-center">
                                <p className="text-base font-bold text-gray-900">No report access configured</p>
                                <p className="text-xs text-gray-500 mt-2">
                                    Your account can open this page but does not have report permissions. Ask an administrator to enable
                                    <span className="font-semibold"> Reports &amp; Analytics</span> in User Management.
                                </p>
                            </div>
                        </div>
                    ) : (
                    <div className="max-w-[1700px] mx-auto space-y-6">

                        {/* 1. Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatCard
                                title="Net Collection"
                                value={`${Number(summary.totalConfirm).toLocaleString('en-IN')}`}
                                color="blue"
                                icon={TrendingUp}
                            />
                            <StatCard
                                title="Cash Received"
                                value={`${Number(summary.totalCash || 0).toLocaleString('en-IN')}`}
                                color="green"
                                icon={Wallet}
                            />
                            <StatCard
                                title="Bank Transfers"
                                value={`${Number(summary.totalBank || 0).toLocaleString('en-IN')}`}
                                color="indigo"
                                icon={Landmark}
                            />
                            {/* Added Concession Stat */}
                            <StatCard
                                title="Concessions"
                                value={`${Number(summary.totalCredit || 0).toLocaleString('en-IN')}`}
                                color="purple"
                                icon={CreditCard}
                            />
                        </div>

                        {/* 2. Main Data Section */}
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">

                            {/* Toolbar (Filters) */}
                            <div className="p-4 border-b border-gray-100 bg-white flex flex-col md:flex-row justify-between gap-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div className="flex items-center bg-gray-50 p-1.5 rounded-lg border border-gray-200 gap-1">
                                        {[
                                            { id: 'today', label: 'Today' },
                                            { id: 'yesterday', label: 'Yesterday' },
                                            { id: 'week', label: 'Last 7 Days' }
                                        ].map((preset) => (
                                            <button
                                                key={preset.id}
                                                onClick={() => applyDatePreset(preset.id)}
                                                className={`
                                                    px-3 py-1.5 text-[11px] font-bold rounded-md transition-all duration-200
                                                    ${activePreset === preset.id
                                                        ? 'bg-blue-600 text-white shadow-sm'
                                                        : 'text-gray-600 hover:bg-white hover:text-blue-600 hover:shadow-sm'}
                                                `}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="flex items-center gap-2 bg-gray-50 px-2 py-1.5 rounded-lg border border-gray-200 w-36">
                                        <select
                                            value={selectedCampusId}
                                            onChange={(e) => setSelectedCampusId(e.target.value)}
                                            className="bg-transparent border-none p-0 text-xs font-bold text-gray-700 focus:ring-0 cursor-pointer w-full truncate"
                                        >
                                            {!isScopedUser ? (
                                                <option value="all">All Campuses</option>
                                            ) : (
                                                <option value="all">All My Campuses</option>
                                            )}
                                            {campuses.map((campus) => (
                                                <option key={campus.id} value={campus.id}>{campus.name} ({campus.code})</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center gap-2 bg-gray-50 px-2 py-1.5 rounded-lg border border-gray-200 w-36">
                                        <select
                                            value={selectedCollege}
                                            onChange={(e) => setSelectedCollege(e.target.value)}
                                            className="bg-transparent border-none p-0 text-xs font-bold text-gray-700 focus:ring-0 cursor-pointer w-full truncate"
                                        >
                                            <option value="">All Colleges</option>
                                            {colleges.map((college) => (
                                                <option key={college} value={college}>{college}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
                                        <Calendar size={12} className="text-gray-400" />
                                        <input
                                            type="date"
                                            className="bg-transparent border-none p-0 text-xs font-bold text-gray-700 focus:ring-0 cursor-pointer w-24"
                                            value={startDate}
                                            onKeyDown={(e) => e.preventDefault()}
                                            onClick={(e) => e.target.showPicker?.()}
                                            onChange={e => handleDateChange('start', e.target.value)}
                                        />
                                        <span className="text-gray-300 mx-1">to</span>
                                        <input
                                            type="date"
                                            className="bg-transparent border-none p-0 text-xs font-bold text-gray-700 focus:ring-0 cursor-pointer w-24"
                                            value={endDate}
                                            onKeyDown={(e) => e.preventDefault()}
                                            onClick={(e) => e.target.showPicker?.()}
                                            onChange={e => handleDateChange('end', e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    {(activeTab === 'cashier' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && data.length > 0 && (
                                        <button
                                            onClick={() => setPrintModalData({ isAll: true, rows: data, dateRange: { start: startDate, end: endDate } })}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-bold bg-blue-600 text-white hover:bg-blue-700 transition shadow-sm"
                                        >
                                            <Printer size={12} /> {activeTab === 'cashier' ? 'Print All Cashiers' : activeTab === 'college' ? 'Print All Colleges' : activeTab === 'feeHead' ? 'Print All Fee Heads' : 'Print All Accounts'}
                                        </button>
                                    )}
                                    <button
                                        onClick={fetchReport}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] font-bold bg-gray-800 text-white hover:bg-gray-900 transition shadow-sm"
                                    >
                                        <Filter size={12} /> Refresh
                                    </button>
                                </div>
                            </div>

                            {/* Table */}
                            <div className="overflow-x-auto min-h-[400px]">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50/80 border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-500 font-bold">
                                            <th className="py-4 px-6 w-1/4">
                                                {tabs.find(t => t.id === activeTab)?.label || 'Identifier'}
                                            </th>
                                            <th className="py-4 px-6 text-right">Transactions</th>

                                            {/* Columns for ALL tabs now, but specifically requested for Daily */}
                                            {activeTab !== 'account' && <th className="py-4 px-6 text-right text-emerald-600">Cash</th>}
                                            <th className="py-4 px-6 text-right text-indigo-600 text-nowrap">Bank (Online)</th>
                                            <th className="py-4 px-6 text-right text-purple-600">Concession</th>
                                            <th className="py-4 px-6 text-right text-black font-extrabold">Net Total</th>

                                            {(activeTab === 'cashier' || activeTab === 'daily' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && <th className="py-4 px-6 text-right">Actions</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white">
                                        {loading ? (
                                            <tr>
                                                <td colSpan="8" className="py-32 text-center pointer-events-none">
                                                    <div className="flex flex-col items-center justify-center gap-4">
                                                        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                                        <p className="text-gray-400 font-medium animate-pulse">Computing financials...</p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : data.length === 0 ? (
                                            <tr>
                                                <td colSpan="8" className="py-32 text-center pointer-events-none">
                                                    <div className="flex flex-col items-center justify-center gap-4 opacity-50">
                                                        <div className="bg-gray-100 p-4 rounded-full">
                                                            <Search size={32} className="text-gray-400" />
                                                        </div>
                                                        <div className="text-center">
                                                            <p className="text-gray-900 font-bold text-base">No reports found.</p>
                                                            <p className="text-gray-500 text-xs">Try adjusting your date filters.</p>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            data.map((row, idx) => (
                                                <ReportRow
                                                    key={idx}
                                                    row={row}
                                                    idx={idx}
                                                    activeTab={activeTab}
                                                    expandedRows={expandedRows}
                                                    toggleRow={toggleRow}
                                                    dateRange={{ start: startDate, end: endDate }}
                                                    role={role}
                                                    setPrintModalData={setPrintModalData}
                                                />
                                            ))
                                        )}
                                    </tbody>

                                    {/* Footer Summary */}
                                    {!loading && data.length > 0 && (
                                        <tfoot className="bg-gray-50 border-t border-gray-200">
                                            <tr>
                                                <td className="py-4 px-6 font-bold text-gray-800 text-[11px] text-left uppercase tracking-wide">GRAND TOTAL</td>
                                                <td className="py-4 px-6 text-right font-bold text-xs text-gray-800">{summary.count}</td>
                                                {activeTab !== 'account' && (
                                                    <td className="py-4 px-6 text-right font-bold text-xs text-emerald-600">
                                                        {Number(summary.totalCash || 0).toLocaleString('en-IN')}
                                                    </td>
                                                )}
                                                <td className="py-4 px-6 text-right font-bold text-xs text-indigo-600">
                                                    {Number(summary.totalBank || 0).toLocaleString('en-IN')}
                                                </td>
                                                <td className="py-4 px-6 text-right font-bold text-xs text-purple-700">
                                                    {Number(summary.totalCredit || 0).toLocaleString('en-IN')}
                                                </td>
                                                <td className="py-4 px-6 text-right font-extrabold text-base text-blue-900">
                                                    {Number(summary.totalConfirm).toLocaleString('en-IN')}
                                                </td>

                                                {(activeTab === 'cashier' || activeTab === 'daily' || activeTab === 'college' || activeTab === 'account' || activeTab === 'feeHead') && <td></td>}
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    </div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default Reports;
