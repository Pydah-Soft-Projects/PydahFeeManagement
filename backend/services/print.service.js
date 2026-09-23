const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

// Initialize Babel Register to support ES6 and JSX compiling on the fly
require('@babel/register')({
    presets: [
        [require.resolve('@babel/preset-env')],
        [require.resolve('@babel/preset-react')]
    ],
    extensions: ['.jsx', '.js', '.ts', '.tsx'],
    ignore: [/node_modules/]
});

const Transaction = require('../models/Transaction');
const Setting = require('../models/Setting');
const db = require('../config/sqlDb');

// Import React components
const ReceiptTemplate = require('../../frontend/src/components/ReceiptTemplate').default;
const ConcessionReportPrint = require('../../frontend/src/components/ConcessionReportPrint').default;
const CashierReportTemplate = require('../../frontend/src/components/CashierReportTemplate').default;
const CollegeReportTemplate = require('../../frontend/src/components/CollegeReportTemplate').default;
const DailyReportTemplate = require('../../frontend/src/components/DailyReportTemplate').default;
const AccountReportTemplate = require('../../frontend/src/components/AccountReportTemplate').default;
const FeeHeadReportTemplate = require('../../frontend/src/components/FeeHeadReportTemplate').default;
const FeeConfigurationPrint = require('../../frontend/src/components/FeeConfigurationPrint').default;
const OverallConcessionRegisterPrint = require('../../frontend/src/components/OverallConcessionRegisterPrint').default;
const ProceedingsPrint = require('../../frontend/src/components/ProceedingsPrint').default;
const StudentStatementTemplate = require('../../frontend/src/components/StudentStatementTemplate').default;
const DueReportPrintTemplate = require('../../frontend/src/components/DueReportPrintTemplate').default;

const renderTemplate = async (templateName, data) => {
    let renderedMarkup = '';
    let pageTitle = 'Document';
    let forceLandscape = false;

    if (templateName === 'fee-receipt') {
        const { receiptId, receiptNumber } = data;
        let query = {};
        if (receiptId) {
            query._id = receiptId;
        } else if (receiptNumber) {
            query.receiptNumber = receiptNumber;
        } else {
            throw new Error('Missing receiptId or receiptNumber in request data');
        }

        const primaryTx = await Transaction.findOne(query).lean();
        if (!primaryTx) {
            throw new Error('Transaction record not found');
        }

        // Fetch related transactions sharing the same receipt number (excluding transferred out items)
        const rNum = primaryTx.receiptNumber;
        let transactionsList = await Transaction.find({ receiptNumber: rNum, status: { $ne: 'transferred' } })
            .populate('feeHead', 'name')
            .sort({ createdAt: 1 })
            .lean();

        if (!transactionsList || transactionsList.length === 0) {
            transactionsList = await Transaction.find({ receiptNumber: rNum })
                .populate('feeHead', 'name')
                .sort({ createdAt: 1 })
                .lean();
        }

        // Fetch student details from SQL
        let studentInfo = null;
        try {
            const [rows] = await db.query('SELECT * FROM students WHERE admission_number = ?', [primaryTx.studentId]);
            if (rows.length > 0) {
                studentInfo = rows[0];
            }
        } catch (sqlErr) {
            console.error('SQL Error fetching student details:', sqlErr);
        }

        if (!studentInfo) {
            studentInfo = {
                admission_number: primaryTx.studentId || '',
                student_name: primaryTx.studentName || '',
                college: primaryTx.college || ''
            };
        }

        const settings = await Setting.findOne().lean();

        // Render React Component to Static Markup
        const element = React.createElement(ReceiptTemplate, {
            transaction: primaryTx,
            transactions: transactionsList,
            relatedTransactions: transactionsList,
            student: studentInfo,
            totalDue: 0,
            settings: settings
        });

        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = `Receipt_${rNum}`;

    } else if (templateName === 'concession-report') {
        const { reportData = [], filters = {} } = data;
        const element = React.createElement(ConcessionReportPrint, {
            data: reportData,
            filters: filters
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Concession_Report';

    } else if (templateName === 'cashier-report') {
        const { cashierData, dateRange, options, hideGeneratedInfo } = data;
        const element = React.createElement(CashierReportTemplate, {
            data: cashierData,
            dateRange: dateRange,
            options: options,
            hideGeneratedInfo: hideGeneratedInfo
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Cashier_Report';

    } else if (templateName === 'college-report') {
        const { displayData, dateRange, options, hideGeneratedInfo } = data;
        const element = React.createElement(CollegeReportTemplate, {
            data: displayData,
            dateRange: dateRange,
            options: options,
            hideGeneratedInfo: hideGeneratedInfo
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'College_Report';

    } else if (templateName === 'account-report') {
        const { displayData, dateRange, options, hideGeneratedInfo } = data;
        const element = React.createElement(AccountReportTemplate, {
            data: displayData,
            dateRange: dateRange,
            options: options,
            hideGeneratedInfo: hideGeneratedInfo
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Account_Report';

    } else if (templateName === 'feehead-report') {
        const { displayData, dateRange, options, hideGeneratedInfo } = data;
        const element = React.createElement(FeeHeadReportTemplate, {
            data: displayData,
            dateRange: dateRange,
            options: options,
            hideGeneratedInfo: hideGeneratedInfo
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'FeeHead_Report';

    } else if (templateName === 'daily-report') {
        const { reportData } = data;
        const element = React.createElement(DailyReportTemplate, {
            data: reportData
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Daily_Report';

    } else if (templateName === 'fee-configuration-report') {
        try {
            delete require.cache[require.resolve('../../frontend/src/components/FeeConfigurationPrint')];
        } catch (e) {}
        const DynamicFeeConfigurationPrint = require('../../frontend/src/components/FeeConfigurationPrint').default;
        const { variant = 'heads', reportData = [], rows = [], tableYears = [1, 2, 3, 4], collegeCodes = {}, filters = {} } = data;
        const element = React.createElement(DynamicFeeConfigurationPrint, {
            variant,
            reportData,
            rows,
            tableYears,
            collegeCodes,
            filters,
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = `Fee_Configuration_${variant}`;

    } else if (templateName === 'overall-concession-register') {
        const { request, generatedOn } = data;
        if (!request) throw new Error('Missing request data for overall-concession-register');
        try { delete require.cache[require.resolve('../../frontend/src/components/OverallConcessionRegisterPrint')]; } catch (e) {}
        const DynamicRegisterPrint = require('../../frontend/src/components/OverallConcessionRegisterPrint').default;
        const element = React.createElement(DynamicRegisterPrint, {
            request,
            generatedOn: generatedOn || null
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = `Concession_Register_${request.admissionNumber || 'Student'}`;

    } else if (templateName === 'overall-concession-list') {
        const { requests = [], filters = {}, generatedOn } = data;
        try { delete require.cache[require.resolve('../../frontend/src/components/OverallConcessionRegisterPrint')]; } catch (e) {}
        const DynamicListPrint = require('../../frontend/src/components/OverallConcessionRegisterPrint').default;
        const element = React.createElement(DynamicListPrint, {
            requests,
            filters,
            generatedOn: generatedOn || null
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Overall_Concession_Register';

    } else if (templateName === 'proceedings-report') {
        const { reportData = [], filters = {}, includeAbstract = true, includeDetailed = false } = data;
        const element = React.createElement(ProceedingsPrint, {
            data: reportData,
            filters: filters,
            includeAbstract,
            includeDetailed
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = 'Proceedings_Report';

    } else if (templateName === 'student-statement') {
        const { student, feeDetails, transactions } = data;
        const element = React.createElement(StudentStatementTemplate, {
            student,
            feeDetails,
            transactions
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = `Fee_Statement_${student?.admission_number || 'Student'}`;

    } else if (templateName === 'due-report') {
        try { delete require.cache[require.resolve('../../frontend/src/components/DueReportPrintTemplate')]; } catch (e) {}
        const DynamicDueReportPrintTemplate = require('../../frontend/src/components/DueReportPrintTemplate').default;
        const { type, reportData, filters, summary, student, includeDetails, printedOn } = data;
        const element = React.createElement(DynamicDueReportPrintTemplate, {
            type,
            reportData,
            filters,
            summary,
            student,
            includeDetails,
            printedOn
        });
        renderedMarkup = ReactDOMServer.renderToStaticMarkup(element);
        pageTitle = type === 'overall' ? 'Overall_Due_Report' : `Due_Report_${student?.admission_number || 'Student'}`;
        forceLandscape = true;

    } else {
        throw new Error(`Unsupported template: ${templateName}`);
    }

    // Wrap in standard HTML template with Tailwind CSS link and print style overrides
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${pageTitle}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        ${forceLandscape ? '@page { size: A4 landscape; margin: 6mm; }' : ''}
        @media print {
            ${forceLandscape ? '@page { size: A4 landscape; margin: 6mm; }' : ''}
            body { 
                -webkit-print-color-adjust: exact; 
                print-color-adjust: exact;
            }
            .no-print { display: none !important; }
        }
        .print-table { width: 100%; border-collapse: collapse; font-size: 11px; border: 2px solid #000; }
        .print-table th, .print-table td { border: 1.5px solid #000; padding: 4px 8px; }
        .print-table th { font-weight: bold; text-align: left; }
        .print-header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; }
        .compact-row { line-height: 1.2; }
    </style>
</head>
<body style="margin: 0; padding: 0; background-color: white;">
    ${renderedMarkup}
</body>
</html>`;
};

module.exports = { renderTemplate };
