import {
    getAgentStatement,
    listAgreements,
    listWithdrawals,
    type AccountingPage,
    type Agent,
} from './accountingApi';
import { formatDateTime } from './format';
import type { ApiEnvelope } from '@radii/shared';

async function allPages<T>(
    load: (page: number) => Promise<ApiEnvelope<AccountingPage<T>>>,
) {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
        const result = await load(page);
        if (!result.success || !result.data) {
            throw new Error(
                !result.success
                    ? result.message
                    : 'Unable to load export data.',
            );
        }
        items.push(...result.data.items);
        if (items.length >= result.data.total) return items;
        if (!result.data.items.length) {
            throw new Error(
                'Accounting records changed. Please retry the export.',
            );
        }
    }
}

export async function exportAgentAccounting(
    agent: Agent,
    email: string | null,
    format: 'excel' | 'pdf',
) {
    const firstStatement = getAgentStatement(agent.id, 1);
    const [statement, entries, agreements, withdrawals] = await Promise.all([
        firstStatement,
        allPages((page) =>
            page === 1 ? firstStatement : getAgentStatement(agent.id, page),
        ),
        allPages((page) => listAgreements(agent.id, page)),
        allPages((page) => listWithdrawals(agent.id, page)),
    ]);
    if (!statement.success || !statement.data) {
        throw new Error(
            !statement.success ? statement.message : 'Unable to load balances.',
        );
    }
    const sections = [
        {
            title: 'Balances',
            headers: ['Currency', 'Available', 'Reserved', 'Earned', 'Paid'],
            rows: statement.data.balances.map((balance) => [
                balance.currency,
                balance.available,
                balance.reserved,
                balance.earned,
                balance.paid,
            ]),
        },
        {
            title: 'Statement',
            headers: [
                'Recorded',
                'Movement',
                'Amount',
                'Currency',
                'Debit',
                'Credit',
                'Source ID',
            ],
            rows: entries.map((entry) => [
                formatDateTime(entry.createdAt),
                entry.kind,
                entry.amount,
                entry.currency,
                entry.debitAccount,
                entry.creditAccount,
                entry.collectionId ?? entry.withdrawalId ?? '',
            ]),
        },
        {
            title: 'Agreements',
            headers: [
                'Scope',
                'Assigned to',
                'Commission (%)',
                'Effective from',
                'Recorded',
                'Recorded by',
            ],
            rows: agreements.map((agreement) => [
                agreement.scopeType === 'nas'
                    ? 'NAS device'
                    : 'Service account',
                agreement.scopeLabel ?? agreement.scopeId,
                (agreement.rateBps / 100).toFixed(2),
                formatDateTime(agreement.effectiveFrom),
                formatDateTime(agreement.createdAt),
                agreement.actorName ?? agreement.actorEmail ?? '',
            ]),
        },
        {
            title: 'Withdrawals',
            headers: [
                'Requested',
                'Amount',
                'Currency',
                'Status',
                'Reference',
                'Note',
            ],
            rows: withdrawals.map((withdrawal) => [
                formatDateTime(withdrawal.createdAt),
                withdrawal.amount,
                withdrawal.currency,
                withdrawal.status,
                withdrawal.reference ?? '',
                withdrawal.note ?? '',
            ]),
        },
    ];
    const filename = `agent-accounting-${agent.id}`;
    const contact = [agent.phone, email].filter(Boolean).join(' | ');
    if (format === 'excel') {
        const { default: ExcelJS } = await import('exceljs');
        const workbook = new ExcelJS.Workbook();
        for (const section of sections) {
            const sheet = workbook.addWorksheet(section.title);
            sheet.addRow([agent.name]);
            sheet.addRow([contact]);
            sheet.addRow(section.headers);
            sheet.getRow(3).font = { bold: true };
            sheet.addRows(section.rows);
            sheet.columns.forEach((column) => {
                column.width = 26;
            });
            sheet.views = [{ state: 'frozen', ySplit: 3 }];
        }
        const buffer = await workbook.xlsx.writeBuffer();
        const url = URL.createObjectURL(
            new Blob([buffer], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `${filename}.xlsx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
        const [{ jsPDF }, { autoTable }] = await Promise.all([
            import('jspdf'),
            import('jspdf-autotable'),
        ]);
        const doc = new jsPDF({ orientation: 'landscape' });
        sections.forEach((section, index) => {
            if (index) doc.addPage();
            doc.setFontSize(16);
            doc.text(`${agent.name} - ${section.title}`, 14, 18);
            doc.setFontSize(10);
            doc.text(contact, 14, 26);
            autoTable(doc, {
                startY: 32,
                head: [section.headers],
                body: section.rows,
                styles: { fontSize: 8, overflow: 'linebreak' },
            });
        });
        doc.save(`${filename}.pdf`);
    }
}
