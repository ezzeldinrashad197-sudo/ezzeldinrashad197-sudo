import JSZip from 'jszip';
import { parseExcelFile } from './parser';
import { SubmittalRow } from '../types';

export const processMultiUpload = async (files: FileList | File[]): Promise<SubmittalRow[]> => {
    const fileArray = Array.from(files);

    const perFileResults = await Promise.all(
        fileArray.map(async (file): Promise<SubmittalRow[]> => {
            if (file.name.endsWith('.zip')) {
                const zip = new JSZip();
                const contents = await zip.loadAsync(file);
                const entries = Object.entries(contents.files).filter(
                    ([relativePath, zipEntry]) =>
                        !zipEntry.dir &&
                        !relativePath.startsWith('__MACOSX/') &&
                        (relativePath.endsWith('.xlsx') || relativePath.endsWith('.xls'))
                );

                const zipChunks: SubmittalRow[][] = new Array(entries.length);
                let nextIdx = 0;
                const concurrency = Math.min(4, entries.length || 1);
                await Promise.all(
                    Array.from({ length: concurrency }, async () => {
                        while (nextIdx < entries.length) {
                            const currentIdx = nextIdx++;
                            const [, zipEntry] = entries[currentIdx];
                            const blob = await zipEntry.async('blob');
                            const extractedFile = new File([blob], zipEntry.name, {
                                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                            });
                            const rows = await parseExcelFile(extractedFile);
                            for (let i = 0; i < rows.length; i++) {
                                const r = rows[i];
                                if (!r.sourceWorkbookName) r.sourceWorkbookName = extractedFile.name;
                                if (!r.sourceFileName) r.sourceFileName = extractedFile.name;
                                if (!r.registerIdentity) r.registerIdentity = r.documentType || 'UNCLASSIFIED';
                            }
                            zipChunks[currentIdx] = rows;
                        }
                    })
                );

                const zipFlat: SubmittalRow[] = [];
                for (let c = 0; c < zipChunks.length; c++) {
                    const chunk = zipChunks[c];
                    for (let i = 0; i < chunk.length; i++) {
                        zipFlat.push(chunk[i]);
                    }
                }
                return zipFlat;
            } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls') || file.name.endsWith('.csv')) {
                const rows = await parseExcelFile(file);
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    if (!r.sourceWorkbookName) r.sourceWorkbookName = file.name;
                    if (!r.sourceFileName) r.sourceFileName = file.name;
                    if (!r.registerIdentity) r.registerIdentity = r.documentType || 'UNCLASSIFIED';
                }
                return rows;
            }
            return [];
        })
    );

    const allParsed: SubmittalRow[] = [];
    for (let f = 0; f < perFileResults.length; f++) {
        const chunk = perFileResults[f];
        for (let i = 0; i < chunk.length; i++) {
            allParsed.push(chunk[i]);
        }
    }

    return allParsed;
};
