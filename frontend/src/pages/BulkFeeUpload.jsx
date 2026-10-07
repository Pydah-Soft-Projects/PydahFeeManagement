import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import api from '../lib/api';
import { Upload, FileUp, Save, CheckSquare, Square, Download, CreditCard, Banknote, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import Sidebar from './Sidebar';

const BulkFeeUpload = () => {
    // Shared State
    const [uploadType, setUploadType] = useState('DUE'); // Set to DUE only

    // Upload & Data State
    const [file, setFile] = useState(null);
    const [previewData, setPreviewData] = useState([]);
    const [selectedIds, setSelectedIds] = useState([]);
    const [expandedRows, setExpandedRows] = useState({});
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [uploading, setUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [downloadingTemplate, setDownloadingTemplate] = useState(false);
    const [feeHeads, setFeeHeads] = useState([]); // List of dynamic columns from server
    const [mappingSummary, setMappingSummary] = useState(null);
    const [showMappingModal, setShowMappingModal] = useState(false);

    const handleFileChange = (e) => {
        setFile(e.target.files[0]);
        setPreviewData([]);
        setSelectedIds([]);
        setExpandedRows({});
        setMessage('');
        setError('');
        setMappingSummary(null);
        setShowMappingModal(false);
    };

    const handleDownloadMappingExcel = () => {
        if (!mappingSummary || !mappingSummary.allFeeColumns || mappingSummary.allFeeColumns.length === 0) {
            return;
        }

        const dataToExport = mappingSummary.allFeeColumns.map(col => ({
            'Excel Column': col.excelColumn,
            'Clean Search Term': col.cleanedHeader,
            'Status': col.status === 'MAPPED' ? '✓ MAPPED' : '⚠ UNMAPPED',
            'System Fee Head / Detail': col.status === 'MAPPED' ? col.mappedTo : `-`
        }));

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);

        // Apply green background to mapped rows, red background to unmapped rows
        if (worksheet['!ref']) {
            const range = XLSX.utils.decode_range(worksheet['!ref']);
            for (let R = range.s.r + 1; R <= range.e.r; ++R) {
                const statusCellRef = XLSX.utils.encode_cell({ r: R, c: 2 });
                const isMapped = worksheet[statusCellRef] && worksheet[statusCellRef].v && worksheet[statusCellRef].v.includes('MAPPED') && !worksheet[statusCellRef].v.includes('UNMAPPED');

                const rowStyle = isMapped
                    ? { fill: { fgColor: { rgb: 'D4EDDA' }, patternType: 'solid' }, font: { color: { rgb: '155724' }, bold: true } }
                    : { fill: { fgColor: { rgb: 'F8D7DA' }, patternType: 'solid' }, font: { color: { rgb: '721C24' }, bold: true } };

                for (let C = range.s.c; C <= range.e.c; ++C) {
                    const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
                    if (worksheet[cellRef]) {
                        worksheet[cellRef].s = rowStyle;
                    }
                }
            }
        }

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Mapping Verification');

        worksheet['!cols'] = [
            { wch: 24 },
            { wch: 20 },
            { wch: 15 },
            { wch: 40 }
        ];

        XLSX.writeFile(workbook, 'Fee_Head_Mapping_Verification.xlsx');
    };

    const handleDownloadTemplate = async () => {
        setDownloadingTemplate(true);
        try {
            const response = await api.get(`/bulk-fee/template`, {
                params: { type: uploadType },
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            const filename = uploadType === 'DUE' ? 'BulkDuesTemplate.xlsx' : 'BulkPaymentTemplate.xlsx';
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.parentNode.removeChild(link);
        } catch (error) {
            console.error('Error downloading template', error);
            setError('Failed to download template.');
        } finally {
            setDownloadingTemplate(false);
        }
    };

    const handleUpload = async () => {
        if (!file) { setError('Please select a file first.'); return; }

        setUploading(true);
        setError('');
        setMessage('');

        const formData = new FormData();
        formData.append('file', file);
        formData.append('uploadType', uploadType);
        formData.append('isPendingMode', 'false');

        try {
            const response = await api.post(`/bulk-fee/upload`, formData);

            const data = response.data.data;
            const resHeads = response.data.feeHeads || [];
            if (data.length === 0) {
                setError('No valid student data found in file.');
                setPreviewData([]);
                setFeeHeads([]);
                setSelectedIds([]);
                setMappingSummary(null);
                setShowMappingModal(false);
            } else {
                setPreviewData(data);
                setFeeHeads(resHeads);
                setSelectedIds(data.map((_, i) => i));
                setMappingSummary(response.data.mappingSummary || null);
                if (response.data.mappingSummary) {
                    setShowMappingModal(true);
                }
                setMessage(response.data.message || `Successfully parsed ${data.length} records.`);
            }
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || 'Error uploading file');
        } finally {
            setUploading(false);
        }
    };

    const handleSelectAll = () => {
        if (selectedIds.length === previewData.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(previewData.map((_, i) => i));
        }
    };

    const handleSelectRow = (index) => {
        if (selectedIds.includes(index)) {
            setSelectedIds(selectedIds.filter(id => id !== index));
        } else {
            setSelectedIds([...selectedIds, index]);
        }
    };

    const toggleRow = (index) => {
        setExpandedRows(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    const handleSave = async () => {
        if (selectedIds.length === 0) { setError('Please select at least one student to upload.'); return; }

        setSaving(true);
        setError('');

        const studentsToSave = selectedIds.map(index => previewData[index]);

        try {
            const response = await api.post(`/bulk-fee/save`, {
                students: studentsToSave,
                uploadType: uploadType,
                isPendingMode: false
            });
            setMessage(response.data.message);
            setFile(null);
            setPreviewData([]);
            setSelectedIds([]);
            setExpandedRows({});
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || 'Error saving data');
        } finally {
            setSaving(false);
        }
    };

    // Helper to merge demands and payments
    const getUnifiedDetails = (row) => {
        const demandsMap = new Map();
        if (row.demands) {
            row.demands.forEach(d => {
                const key = `${d.headId}-${d.year}-${d.semester || 1}`;
                if (!demandsMap.has(key)) {
                    demandsMap.set(key, { ...d, matches: false });
                } else {
                    const existing = demandsMap.get(key);
                    existing.amount += d.amount;
                    demandsMap.set(key, existing);
                }
            });
        }

        const result = [];
        if (row.payments) {
            row.payments.forEach(p => {
                const key = `${p.headId}-${p.year}-${p.semester || 1}`;
                let demandVal = 0;
                if (demandsMap.has(key)) {
                    const d = demandsMap.get(key);
                    if (!d.matches) {
                        demandVal = d.amount;
                        d.matches = true;
                    }
                }

                result.push({
                    headName: p.headName,
                    year: p.year,
                    semester: p.semester, // Display sem from payment
                    mode: p.mode,
                    date: p.date,
                    demand: demandVal,
                    paid: p.amount,
                    remarks: p.remarks,
                    meta: p.meta
                });
            });
        }

        demandsMap.forEach((d) => {
            if (!d.matches) {
                result.push({
                    headId: d.headId,
                    headName: d.headName,
                    year: d.year,
                    semester: d.semester,
                    mode: '-',
                    date: null,
                    demand: d.amount,
                    paid: 0,
                    remarks: '',
                    meta: d.meta || { pendingAmount: d.amount } // Fallback for display
                });
            }
        });
        return result;
    };

    return (
        <div className="flex min-h-screen bg-gray-50 font-sans">
            <Sidebar />
            <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col">
                <header className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                        <Upload className="text-blue-600" /> Bulk Fee Upload
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Upload {uploadType === 'PAYMENT' ? 'Payment Receipts' : 'Fee Demands (Dues)'} via Excel.
                    </p>
                </header>

                {error && <div className="p-3 bg-red-50 text-red-700 rounded mb-4 border border-red-200">{error}</div>}
                {message && <div className="p-3 bg-green-50 text-green-700 rounded mb-4 border border-green-200">{message}</div>}

                {/* Tabs */}
                <div className="flex gap-4 mb-4 border-b">
                    <button
                        onClick={() => { setUploadType('DUE'); setPreviewData([]); setFile(null); setMappingSummary(null); }}
                        className={`pb-2 px-4 font-semibold flex items-center gap-2 transition-colors ${uploadType === 'DUE' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <Banknote size={18} /> Dues (Demand)
                    </button>
                    <button
                        onClick={() => { setUploadType('PAYMENT'); setPreviewData([]); setFile(null); setMappingSummary(null); }}
                        className={`pb-2 px-4 font-semibold flex items-center gap-2 transition-colors ${uploadType === 'PAYMENT' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        <CreditCard size={18} /> Payments (Receipts)
                    </button>
                </div>

                {/* Upload Section */}
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
                    <div className="flex items-end gap-6">
                        <div className="flex-1">
                            <label className="text-sm font-bold text-gray-700 block mb-2">
                                Upload Excel File for {uploadType === 'PAYMENT' ? 'Payments (Receipts)' : 'Dues (Demand)'}
                            </label>
                            <input
                                type="file"
                                accept=".xlsx, .xls"
                                onChange={handleFileChange}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                key={uploadType} // Force reset on tab switch
                            />
                        </div>
                        <button
                            onClick={handleDownloadTemplate}
                            disabled={downloadingTemplate}
                            className="flex items-center gap-2 px-4 py-2 rounded font-bold text-gray-700 border bg-white hover:bg-gray-50 transition"
                        >
                            <Download size={18} /> Template
                        </button>
                        <button
                            onClick={handleUpload}
                            disabled={uploading || !file}
                            className={`flex items-center gap-2 px-6 py-2 rounded font-bold text-white shadow-md transition ${uploading || !file ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                        >
                            {uploading ? 'Processing...' : <><FileUp size={18} /> Parse & Preview</>}
                        </button>
                    </div>
                </div>

                {/* Preview Table */}
                {previewData.length > 0 && (
                    <div className="flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
                        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
                            <div>
                                <h3 className="font-bold text-gray-800">Preview ({uploadType} Mode) — {previewData.length} records</h3>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    Total {uploadType === 'PAYMENT' ? 'Paid Amount' : 'Demand Amount'}:{' '}
                                    <span className="font-bold text-blue-700">
                                        ₹{previewData.reduce((acc, row) => acc + (uploadType === 'PAYMENT' ? (row.totalPaid || 0) : (row.totalDemand || 0)), 0).toLocaleString('en-IN')}
                                    </span>
                                </p>
                            </div>
                            <button
                                onClick={handleSave}
                                disabled={saving || selectedIds.length === 0}
                                className={`flex items-center gap-2 px-6 py-2 rounded font-bold text-white shadow-md transition ${saving || selectedIds.length === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                                {saving ? 'Saving...' : <><Save size={18} /> Confirm Upload ({selectedIds.length})</>}
                            </button>
                        </div>

                        <div className="overflow-auto flex-1">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-gray-100 sticky top-0 z-10 shadow-sm">
                                    <tr>
                                        <th className="p-3 w-10 text-center">
                                            <button onClick={handleSelectAll} className="text-gray-600 hover:text-blue-600">
                                                {selectedIds.length === previewData.length ? <CheckSquare size={18} /> : <Square size={18} />}
                                            </button>
                                        </th>
                                        <th className="p-3 font-semibold text-gray-600">Student Name</th>
                                        <th className="p-3 font-semibold text-gray-600">Pin / Admission</th>
                                        <th className="p-3 font-semibold text-gray-600">Fee Heads</th>
                                        <th className="p-3 font-semibold text-gray-600 text-right">{uploadType === 'PAYMENT' ? 'Total Paid' : 'Total Demand'}</th>
                                        <th className="p-3 font-semibold text-gray-600 text-center">Batch Match</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {previewData.map((row, index) => (
                                        <React.Fragment key={index}>
                                            <tr className={`hover:bg-blue-50 transition cursor-pointer ${selectedIds.includes(index) ? 'bg-blue-50/50' : 'bg-white'}`} onClick={() => toggleRow(index)}>
                                                <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                    <button onClick={() => handleSelectRow(index)} className={`${selectedIds.includes(index) ? 'text-blue-600' : 'text-gray-400'}`}>
                                                        {selectedIds.includes(index) ? <CheckSquare size={18} /> : <Square size={18} />}
                                                    </button>
                                                </td>
                                                <td className="p-3 font-medium text-gray-800">{row.studentName}</td>
                                                <td className="p-3 font-mono text-gray-600">{row.pinNumber || row.admissionNumber || row.displayId}</td>
                                                <td className="p-3 italic text-gray-500 text-xs truncate max-w-[200px]" title={uploadType === 'PAYMENT' ? row.payments?.map(p => p.headName).join(', ') : row.demands?.map(d => d.headName).join(', ')}>
                                                    {uploadType === 'PAYMENT'
                                                        ? (row.payments?.map(p => p.headName).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-')
                                                        : (row.demands?.map(d => d.headName).filter((v, i, a) => a.indexOf(v) === i).join(', ') || '-')
                                                    }
                                                </td>
                                                <td className="p-3 text-right font-bold text-blue-700">
                                                    ₹{Number(uploadType === 'PAYMENT' ? (row.totalPaid || 0) : (row.totalDemand || 0)).toLocaleString('en-IN')}
                                                </td>
                                                <td className="p-3 text-center">
                                                    {row.admissionNumber ? <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Found</span> : <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded">Not Found</span>}
                                                </td>
                                            </tr>
                                            {expandedRows[index] && (
                                                <tr className="bg-gray-50">
                                                    <td colSpan={6} className="p-4 border-b inner-shadow">
                                                        <div className="bg-white border rounded-md shadow-sm overflow-hidden max-w-4xl mx-auto">
                                                            <div className="p-3 bg-gray-50 border-b flex justify-between items-center">
                                                                <span className="text-xs font-bold text-gray-500 uppercase">
                                                                    {uploadType === 'PAYMENT' ? 'Uploaded Payment Transactions' : 'Uploaded Fee Demands'}
                                                                </span>
                                                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{row.category || 'Regular'}</span>
                                                            </div>
                                                            <table className="w-full text-sm text-left">
                                                                <thead className="bg-gray-100 text-xs text-gray-500 uppercase border-b">
                                                                    {uploadType === 'PAYMENT' ? (
                                                                        <tr>
                                                                            <th className="px-4 py-2">Date</th>
                                                                            <th className="px-4 py-2">Fee Head</th>
                                                                            <th className="px-4 py-2">Year</th>
                                                                            <th className="px-4 py-2">Sem</th>
                                                                            <th className="px-4 py-2 text-right">Amount Paid</th>
                                                                            <th className="px-4 py-2">Mode</th>
                                                                            <th className="px-4 py-2">Ref / Receipt</th>
                                                                            <th className="px-4 py-2">Remarks</th>
                                                                        </tr>
                                                                    ) : (
                                                                        <tr>
                                                                            <th className="px-4 py-2">Fee Head</th>
                                                                            <th className="px-4 py-2">Year</th>
                                                                            <th className="px-4 py-2">Sem</th>
                                                                            <th className="px-4 py-2 text-right">Demand Amount</th>
                                                                            <th className="px-4 py-2">Remarks</th>
                                                                        </tr>
                                                                    )}
                                                                </thead>
                                                                <tbody>
                                                                    {uploadType === 'PAYMENT' ? (
                                                                        row.payments && row.payments.length > 0 ? (
                                                                            row.payments.map((p, i) => (
                                                                                <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                                                                                    <td className="px-4 py-2 text-xs font-mono text-gray-600">
                                                                                        {p.date ? new Date(p.date).toLocaleDateString('en-IN') : '-'}
                                                                                    </td>
                                                                                    <td className="px-4 py-2 font-medium text-gray-800">{p.headName}</td>
                                                                                    <td className="px-4 py-2">{p.year}</td>
                                                                                    <td className="px-4 py-2">{p.semester || 1}</td>
                                                                                    <td className="px-4 py-2 text-right font-mono font-bold text-emerald-700">
                                                                                        ₹{Number(p.amount || 0).toLocaleString('en-IN')}
                                                                                    </td>
                                                                                    <td className="px-4 py-2 text-xs">
                                                                                        <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${p.mode === 'Bank' ? 'bg-purple-100 text-purple-700 border border-purple-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                                                                                            {p.mode || 'Cash'}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="px-4 py-2 text-xs font-mono text-gray-600">{p.ref || '-'}</td>
                                                                                    <td className="px-4 py-2 text-xs text-gray-500">{p.remarks || '-'}</td>
                                                                                </tr>
                                                                            ))
                                                                        ) : (
                                                                            <tr>
                                                                                <td colSpan={8} className="px-4 py-3 text-center text-xs text-gray-500 italic">No payments parsed for this student.</td>
                                                                            </tr>
                                                                        )
                                                                    ) : (
                                                                        row.demands && row.demands.length > 0 ? (
                                                                            row.demands.map((d, i) => (
                                                                                <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                                                                                    <td className="px-4 py-2 font-medium text-gray-800">{d.headName}</td>
                                                                                    <td className="px-4 py-2">{d.year}</td>
                                                                                    <td className="px-4 py-2">{d.semester || 1}</td>
                                                                                    <td className="px-4 py-2 text-right font-mono font-bold text-blue-700">
                                                                                        ₹{Number(d.amount || 0).toLocaleString('en-IN')}
                                                                                    </td>
                                                                                    <td className="px-4 py-2 text-xs text-gray-500">{d.remarks || '-'}</td>
                                                                                </tr>
                                                                            ))
                                                                        ) : (
                                                                            <tr>
                                                                                <td colSpan={5} className="px-4 py-3 text-center text-xs text-gray-500 italic">No fee demands parsed for this student.</td>
                                                                            </tr>
                                                                        )
                                                                    )}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Fee Head Mapping Modal */}
                {showMappingModal && mappingSummary && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
                        <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 space-y-6 max-h-[90vh] overflow-y-auto border border-gray-100">
                            <div className="flex items-center justify-between border-b pb-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                        <CheckSquare className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-800">Excel Fee Head Mapping Verification</h2>
                                        <p className="text-xs text-gray-500 mt-0.5">Review mapped columns before proceeding to the student list</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleDownloadMappingExcel}
                                    className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-sm transition"
                                >
                                    <Download size={15} /> Export to Excel
                                </button>
                            </div>

                            {/* All Excel Fee Columns Summary */}
                            <div>
                                <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                    <CheckSquare className="w-4 h-4 text-blue-600" />
                                    Fee Columns Detected in Excel ({mappingSummary.allFeeColumns?.length || mappingSummary.mapped?.length || 0})
                                </h3>
                                
                                {mappingSummary.allFeeColumns && mappingSummary.allFeeColumns.length > 0 ? (
                                    <div className="border rounded-lg overflow-hidden mb-4">
                                        <table className="w-full text-sm text-left">
                                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b">
                                                <tr>
                                                    <th className="px-4 py-2.5">Excel Column</th>
                                                    <th className="px-4 py-2.5">Clean Search Term</th>
                                                    <th className="px-4 py-2.5 text-center">Status</th>
                                                    <th className="px-4 py-2.5">System Fee Head / Detail</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y text-xs">
                                                {mappingSummary.allFeeColumns.map((col, idx) => {
                                                    const isMapped = col.status === 'MAPPED';
                                                    return (
                                                        <tr key={idx} className={isMapped ? 'bg-emerald-50/80 hover:bg-emerald-100/90 transition border-b border-emerald-100' : 'bg-red-50/80 hover:bg-red-100/90 transition border-b border-red-100'}>
                                                            <td className={`px-4 py-2.5 font-medium ${isMapped ? 'text-emerald-950' : 'text-red-950'}`}>
                                                                {col.excelColumn.startsWith('Section: ') ? (
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                        <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-blue-200 uppercase">SECTION</span>
                                                                        <span className="font-bold font-mono">{col.excelColumn.replace('Section: ', '')}</span>
                                                                    </span>
                                                                ) : col.excelColumn.startsWith('Fee Head: ') ? (
                                                                    <span className="inline-flex items-center gap-1.5">
                                                                        <span className="bg-purple-100 text-purple-800 text-[10px] font-bold px-1.5 py-0.5 rounded border border-purple-200 uppercase">FEE HEAD</span>
                                                                        <span className="font-bold font-mono">{col.excelColumn.replace('Fee Head: ', '')}</span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="font-bold font-mono">{col.excelColumn}</span>
                                                                )}
                                                            </td>
                                                            <td className={`px-4 py-2.5 font-mono ${isMapped ? 'text-emerald-900' : 'text-red-900'}`}>{col.cleanedHeader}</td>
                                                            <td className="px-4 py-2.5 text-center">
                                                                {isMapped ? (
                                                                    <span className="bg-emerald-600 text-white font-bold px-2.5 py-0.5 rounded text-[11px] shadow-sm">
                                                                        ✓ MAPPED
                                                                    </span>
                                                                ) : (
                                                                    <span className="bg-red-600 text-white font-bold px-2.5 py-0.5 rounded text-[11px] shadow-sm">
                                                                        ⚠ UNMAPPED
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td className="px-4 py-2.5">
                                                                {isMapped ? (
                                                                    <span className="font-bold text-emerald-900">{col.mappedTo}</span>
                                                                ) : (
                                                                    <span className="text-red-800 font-semibold italic">-</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    mappingSummary.mapped && mappingSummary.mapped.length > 0 ? (
                                        <div className="border rounded-lg overflow-hidden mb-4">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-gray-50 text-xs text-gray-500 uppercase border-b">
                                                    <tr>
                                                        <th className="px-4 py-2.5">Excel Column Header</th>
                                                        <th className="px-4 py-2.5 text-center">Mapping</th>
                                                        <th className="px-4 py-2.5">System Fee Head</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {mappingSummary.mapped.map((item, idx) => (
                                                        <tr key={idx} className="hover:bg-gray-50">
                                                            <td className="px-4 py-2.5 font-semibold text-gray-800">{item.excelColumn}</td>
                                                            <td className="px-4 py-2.5 text-center text-gray-400">➔</td>
                                                            <td className="px-4 py-2.5 font-bold text-green-700">
                                                                <span className="bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded text-xs">
                                                                    {item.feeHeadName}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-gray-50 rounded-lg text-sm text-gray-500 border mb-4">
                                            No columns matched pre-existing system Fee Heads in MongoDB. If you have a general amount column, it will map to Miscellaneous Due.
                                        </div>
                                    )
                                )}

                                {mappingSummary.systemFeeHeads && mappingSummary.systemFeeHeads.length > 0 && (
                                    <div className="p-3 bg-gray-50 border rounded-lg text-xs text-gray-600">
                                        <span className="font-bold text-gray-700">Available System Fee Heads currently in MongoDB: </span>
                                        {mappingSummary.systemFeeHeads.join(', ')}
                                    </div>
                                )}
                            </div>

                            {/* Action Buttons */}
                            <div className="flex justify-between items-center pt-4 border-t">
                                <button
                                    onClick={handleDownloadMappingExcel}
                                    className="flex items-center gap-2 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs border border-emerald-300 rounded-lg transition"
                                >
                                    <Download size={16} /> Download Verification Table (.xlsx)
                                </button>
                                <button
                                    onClick={() => setShowMappingModal(false)}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-sm transition flex items-center gap-2"
                                >
                                    Proceed to Student List <ArrowRight size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default BulkFeeUpload;
