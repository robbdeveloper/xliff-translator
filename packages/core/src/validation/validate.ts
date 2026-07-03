import type { TransUnit, ValidationIssue, XliffFileInfo } from '../types.js';
import { verifyProtectedContent } from '../preservation/mask.js';
import { parseXliff } from '../xliff/parser.js';

export function validateTransUnit(
  unit: TransUnit,
  fileName: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const target = unit.translatedTarget ?? unit.target;

  if (unit.skipReason) return issues;

  if (!target.trim() && unit.source.trim()) {
    issues.push({
      unitId: unit.meta.id,
      fileName,
      message: 'Target is empty but source has content',
      severity: 'error',
    });
  }

  if (target === unit.source && unit.source.trim().length > 0) {
    issues.push({
      unitId: unit.meta.id,
      fileName,
      message: 'Target still matches source (possibly untranslated)',
      severity: 'warning',
    });
  }

  const check = verifyProtectedContent(unit.source, target);
  if (!check.valid) {
    issues.push({
      unitId: unit.meta.id,
      fileName,
      message: `Missing protected content: ${check.missing.slice(0, 3).join(', ')}`,
      severity: 'error',
    });
  }

  return issues;
}

export function validateXliffFile(file: XliffFileInfo): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const unit of file.transUnits) {
    issues.push(...validateTransUnit(unit, file.fileName));
  }

  try {
    parseXliff(file.fileName, file.rawContent);
  } catch (error) {
    issues.push({
      unitId: '*',
      fileName: file.fileName,
      message: `XML parse error: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
    });
  }

  return issues;
}

export function validateXliffRoundTrip(
  originalContent: string,
  serializedContent: string,
  fileName: string
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  try {
    const original = parseXliff(fileName, originalContent);
    const roundTrip = parseXliff(fileName, serializedContent);

    if (original.transUnits.length !== roundTrip.transUnits.length) {
      issues.push({
        unitId: '*',
        fileName,
        message: 'Trans-unit count changed after serialization',
        severity: 'error',
      });
    }

    for (const unit of original.transUnits) {
      const match = roundTrip.transUnits.find((u) => u.meta.id === unit.meta.id);
      if (!match) {
        issues.push({
          unitId: unit.meta.id,
          fileName,
          message: 'Trans-unit missing after serialization',
          severity: 'error',
        });
      }
    }
  } catch (error) {
    issues.push({
      unitId: '*',
      fileName,
      message: `Round-trip validation failed: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
    });
  }

  return issues;
}
